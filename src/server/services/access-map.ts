/**
 * "Who can see what" for one household (decision 58; spec section 2.5). Every cell is computed from
 * the same rules the app enforces — the permission matrix (`can`), the protected-access rule,
 * each vault item's audience (decision 43), cover end times (decision 59) and outside recipients'
 * packet access (decision 45) — never written by hand. It shows rules, not content, so opening it
 * isn't audited. Administrators can't open it, as they can't open household records (decision 39).
 */
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { staffScope, type ActorContext } from "../context";
import { activeAuthorityByActor, actorNames, staffMaySeeVaultItem } from "./common";
import { maySeeVaultItem } from "./family";
import { recordContext } from "./record";
import { can, type Permission } from "@/domain/permissions";
import { hasProtectedAccess } from "@/domain/lifecycle";
import {
  AUTHORITY_TYPE_LABELS,
  ROLE_LABELS,
  SHARE_CATEGORY_LABELS,
  type AuthorityType,
  type HouseholdRole,
  type ShareCategory,
  type StaffRole,
} from "@/domain/model";

export const ACCESS_COLUMNS = [
  ["updates", "Updates"],
  ["messages", "Messages"],
  ["tasks", "Tasks"],
  ["vault", "Vault"],
  ["protected", "Protected items"],
  ["sharing", "Sharing"],
  ["notes", "Internal notes"],
  ["private", "Patient's private notes"],
] as const;
export type AccessColumn = (typeof ACCESS_COLUMNS)[number][0];
export type AccessCell = { level: "yes" | "some" | "no"; text: string; why: string };
export type AccessRow = {
  key: string;
  who: string;
  /** How they come to have access, in plain words. */
  basis: string;
  /** Time-limited access ends at this exact time (cover, helpers). */
  until: Date | null;
  /** Accepted cover that hasn't started yet: access begins at this exact time, and nothing before. */
  from?: Date | null;
  temporary: boolean;
  group: "household" | "care_team" | "hospice";
  cells: Record<AccessColumn, AccessCell>;
};

const yes = (text: string, why: string): AccessCell => ({ level: "yes", text, why });
const some = (text: string, why: string): AccessCell => ({ level: "some", text, why });
const no = (why: string): AccessCell => ({ level: "no", text: "No", why });

export async function householdAccessMap(db: DB, ctx: ActorContext, householdId: string) {
  const scope = await staffScope(db, ctx, householdId, "staff.household.view");
  const T = ctx.tenantId;
  const H = scope.householdId;
  const life = scope.lifecycle;
  const context = await recordContext(db, ctx, scope);
  const authority = await activeAuthorityByActor(db, T, H);
  const vault = await db
    .select()
    .from(s.vaultItems)
    .where(and(eq(s.vaultItems.tenantId, T), eq(s.vaultItems.householdId, H)));
  const standard = vault.filter((v) => v.sensitivity !== "protected");
  const prot = vault.filter((v) => v.sensitivity === "protected");
  const count = (seen: number, total: number, what: string, why: string): AccessCell =>
    total === 0
      ? { level: "no", text: "—", why: `This household has no ${what} yet.` }
      : seen === total
        ? yes(total === 1 ? "The 1 item" : `All ${total}`, why)
        : seen === 0
          ? no(why)
          : some(`${seen} of ${total}`, why);

  // ------------------------------------------------------------ household members
  const household: AccessRow[] = context.participants.map((p) => {
    const roles = p.roles;
    const label = p.roleLabels.join(", ").toLowerCase();
    const allow = (perm: Permission) => can(roles, perm, life);
    const via = (perm: Permission, what: string) =>
      allow(perm) ? yes("Yes", `As ${label}.`) : no(`${cap(label)}s don't see ${what}.`);
    const types = (authority.get(p.actorId) ?? []) as AuthorityType[];
    const protectedOk = hasProtectedAccess({ roles, lifecycle: life, activeAuthorityTypes: types });
    const onlyHelper = roles.every((r) => r === "helper");
    const seen = (items: typeof vault) =>
      items.filter((v) => maySeeVaultItem(v, p.actorId, roles, life, protectedOk)).length;
    return {
      key: p.actorId,
      who: p.name,
      basis: [
        cap(label),
        ...p.authority.map((a) => `${a} (active workflow)`),
        p.taskOnly ? "for one task" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      until: p.until,
      temporary: !!p.until,
      group: "household",
      cells: {
        updates: via("updates.view", "updates"),
        messages: via("thread.view", "the household's messages"),
        tasks: onlyHelper
          ? some("One task", "A helper sees only the task they were asked to help with (decision 42).")
          : allow("tasks.view")
            ? yes("Yes", `As ${label}: household tasks, and limited ones shared with them.`)
            : no(`${cap(label)}s don't see tasks.`),
        vault: count(
          seen(standard),
          standard.length,
          "vault items",
          "Each item's own audience decides (decision 43): household, the vault keepers, selected people or private.",
        ),
        protected:
          prot.length === 0
            ? { level: "no", text: "—", why: "This household has no protected items." }
            : protectedOk
              ? count(
                  seen(prot),
                  prot.length,
                  "protected items",
                  roles.includes("patient") && life !== "bereavement"
                    ? "The patient sees their own protected items."
                    : `Through an active ${types.map((t) => AUTHORITY_TYPE_LABELS[t]).join(" and ")} workflow.`,
                )
              : no("Protected items need the patient's own access or an active authority workflow."),
        sharing: via("consent.view", "sharing"),
        notes: no("Internal notes are never shown to the household."),
        private:
          roles.includes("patient") && life !== "bereavement"
            ? yes("Their own", "The patient's private notes are theirs alone.")
            : no("Only the patient sees their private notes."),
      },
    };
  });

  // ------------------------------------------------------------ care team and hospice roles
  const staffSeen = (items: typeof vault) => items.filter(staffMaySeeVaultItem).length;
  const staffRow = (
    role: StaffRole,
    key: string,
    who: string,
    basis: string,
    group: AccessRow["group"],
    until: Date | null = null,
  ): AccessRow => {
    const allow = (perm: Permission) => can([role], perm, life);
    if (!allow("staff.household.view")) {
      const why =
        role === "hospice_admin"
          ? "Administrators manage roles, settings and access without opening household records (decision 39)."
          : "This role doesn't open household records.";
      return {
        key,
        who,
        basis,
        until,
        temporary: !!until,
        group,
        cells: Object.fromEntries(ACCESS_COLUMNS.map(([c]) => [c, no(why)])) as AccessRow["cells"],
      };
    }
    const staffVault = (items: typeof vault, what: string) =>
      count(
        staffSeen(items),
        items.length,
        what,
        "The care team sees items shared with staff or the household, never ones kept private or shared only with selected people (decision 43).",
      );
    const as = `As ${ROLE_LABELS[role].toLowerCase()}${until ? ", until cover ends" : ""}.`;
    return {
      key,
      who,
      basis,
      until,
      temporary: !!until,
      group,
      cells: {
        updates: yes("Yes", as),
        messages: yes("Yes", as),
        tasks: yes("Yes", as),
        vault: staffVault(standard, "vault items"),
        protected: staffVault(prot, "protected items"),
        sharing: yes("Yes", as),
        notes: allow("staff.note.view") ? yes("Yes", as) : no("This role doesn't read internal notes."),
        private: no("Only the patient sees their private notes."),
      },
    };
  };
  const careTeam = context.careTeam.current.map((g) =>
    staffRow(
      "care_guide",
      g.membershipId,
      g.name,
      g.coverFor ? `Care guide, covering for ${g.coverFor}` : "Care guide, assigned",
      "care_team",
      g.until,
    ),
  );
  // Cover that's accepted but hasn't started: listed so the team can see it's arranged, with nothing
  // visible to them until the start time (decision 59).
  const upcoming = context.careTeam.upcoming.map((g): AccessRow => {
    const why = "Cover hasn't started. Nothing is visible to them until it does (decision 59).";
    return {
      key: g.membershipId,
      who: g.name,
      basis: `Care guide, covering for ${g.coverFor ?? "someone"}, not started yet`,
      until: g.until,
      from: g.from,
      temporary: true,
      group: "care_team",
      cells: Object.fromEntries(
        ACCESS_COLUMNS.map(([c]) => [c, { level: "no", text: "Not yet", why }]),
      ) as AccessRow["cells"],
    };
  });
  const hospice = [
    staffRow(
      "hospice_ops",
      "role:hospice_ops",
      "Hospice operations",
      "Everyone in this role, by role",
      "hospice",
    ),
    staffRow(
      "privileged_reviewer",
      "role:privileged_reviewer",
      "Authority/consent reviewers",
      "Everyone in this role, for review",
      "hospice",
    ),
    staffRow(
      "hospice_admin",
      "role:hospice_admin",
      "Hospice administrators",
      "Everyone in this role",
      "hospice",
    ),
  ];

  // ------------------------------------------------------------ outside recipients (decision 45)
  const now = new Date();
  const packets = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, T), eq(s.packets.householdId, H)));
  const access = packets.length
    ? await db
        .select()
        .from(s.packetRecipientAccess)
        .where(
          and(
            eq(s.packetRecipientAccess.tenantId, T),
            inArray(
              s.packetRecipientAccess.packetId,
              packets.map((p) => p.id),
            ),
            isNull(s.packetRecipientAccess.revokedAt),
            gt(s.packetRecipientAccess.expiresAt, now),
          ),
        )
    : [];
  const manifest = access.length
    ? await db
        .select()
        .from(s.packetManifestItems)
        .where(
          and(
            eq(s.packetManifestItems.tenantId, T),
            inArray(
              s.packetManifestItems.packetId,
              access.map((a) => a.packetId),
            ),
          ),
        )
    : [];
  const names = await actorNames(
    db,
    T,
    access.map((a) => a.recipientActorId),
  );
  const outside = access.map((a) => {
    const p = packets.find((x) => x.id === a.packetId)!;
    return {
      key: a.id,
      who: names.get(a.recipientActorId) ?? "The named recipient",
      organization: p.recipientName,
      packetId: p.id,
      purpose: p.purpose,
      includes: manifest
        .filter((m) => m.packetId === p.id)
        .map((m) => SHARE_CATEGORY_LABELS[m.category as ShareCategory] ?? m.category),
      until: a.expiresAt,
    };
  });

  return {
    household: { id: H, name: scope.householdName, lifecycle: life },
    columns: ACCESS_COLUMNS.map(([key, label]) => ({ key, label })),
    rows: [...household, ...careTeam, ...upcoming, ...hospice],
    outside,
    generatedAt: now,
  };
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export type { HouseholdRole };
