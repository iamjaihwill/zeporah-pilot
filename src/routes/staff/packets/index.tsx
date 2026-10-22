import { StaffPending } from "@/components/staff/pending";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { getPacketDraftHouseholds, getPackets } from "@/functions/staff";
import { cx, dateOnly, isDenied, unwrap } from "@/lib/client";
import { Button, ButtonLink, CodeDetails, DeniedView, inputClass } from "@/components/ui";
import { DataTable, SplitPane, StaffPageHeader, StatusChip, ViewTabs, type Column } from "@/components/staff";
import { reasonLabel } from "@/domain/labels";

/**
 * Packets as a list with a detail panel (staff rework, section 3). Release itself stays on the
 * packet's own page, behind its confirmation: never from a list, never in bulk.
 */
const TABS = ["release", "released", "ended"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { release: "To release", released: "Released", ended: "Ended" };

export const Route = createFileRoute("/staff/packets/")({
  validateSearch: z.object({ tab: z.enum(TABS).optional(), sel: z.string().max(100).optional() }),
  loader: async () => {
    const [list, households] = await Promise.all([getPackets(), getPacketDraftHouseholds()]);
    return { list: unwrap(list), households: households.ok ? households.data : [] };
  },
  component: Packets,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

function Packets() {
  const { list, households } = Route.useLoaderData();
  const { tab = "release", sel } = Route.useSearch();
  const navigate = useNavigate({ from: "/staff/packets/" });
  if (isDenied(list)) return <DeniedView d={list} />;
  type Row = (typeof list)[number];
  const statusOf = (p: Row) =>
    p.expired && p.state !== "released" && p.state !== "revoked" ? "expired" : p.state;
  // To release: drafts and held packets still in date. Released: still in date. Ended: expired or withdrawn.
  const tabOf = (p: Row): Tab =>
    p.expired || p.state === "revoked" ? "ended" : p.state === "released" ? "released" : "release";
  const rows = list
    .filter((p) => tabOf(p) === tab)
    .sort((a, b) =>
      tab === "release"
        ? new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
        : tab === "released"
          ? new Date(b.releasedAt ?? 0).getTime() - new Date(a.releasedAt ?? 0).getTime()
          : new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime(),
    );
  const active = list.find((p) => p.id === sel) ?? null;
  const set = (id: string | undefined) =>
    void navigate({ search: (s: { tab?: Tab }) => ({ ...s, sel: id }), replace: true } as never);
  const cols: Column<Row>[] = [
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <span className="inline-flex items-center gap-1">
          <StatusChip domain="packet" value={statusOf(p)} />
          {p.endsSoon && (
            <span
              data-ends-soon
              className="rounded-full border border-clay/40 bg-clay-soft px-2 text-[0.75rem] font-semibold text-ink"
            >
              Ends soon
            </span>
          )}
        </span>
      ),
      // As narrow as its chips, so the recipient keeps the room.
      className: "w-px whitespace-nowrap",
    },
    {
      key: "who",
      header: "Recipient · purpose",
      className: "w-full max-w-0 min-w-40",
      cell: (p) => (
        <span className={cx("block min-w-0", p.expired && "text-ink-soft")}>
          <span className="block truncate font-medium">{p.recipientName || "No recipient"}</span>
          <span className="block truncate text-[0.75rem] text-ink-soft">
            {p.purpose || "No purpose"}
            {/* Below wide screens the household joins this line instead of its own column. */}
            <span className="xl:hidden"> · {p.household}</span>
          </span>
        </span>
      ),
    },
    {
      key: "household",
      header: "Household",
      cell: (p) => p.household,
      className: "whitespace-nowrap",
      hideBelow: "xl",
    },
    tab === "released"
      ? {
          key: "recipient",
          header: "Recipient",
          className: "whitespace-nowrap",
          hideBelow: "md",
          // What the named recipient has done in their portal (decision 45).
          cell: (p) => p.recipient ?? <span className="text-ink-soft">No portal access</span>,
        }
      : {
          key: "check",
          header: "Release check",
          className: "whitespace-nowrap",
          hideBelow: "lg",
          // The packet's own checks, whoever is looking (who may release is said once, above).
          cell: (p) =>
            p.state === "released" && p.releasedAt
              ? `Released ${dateOnly(p.releasedAt)}`
              : p.state === "revoked"
                ? "Access withdrawn"
                : p.expired
                  ? "Packet expired"
                  : p.packetCheck.decision === "allow"
                    ? "Ready to release"
                    : reasonLabel(p.packetCheck.reasonCode),
        },
    { key: "until", header: "Until", className: "whitespace-nowrap", cell: (p) => dateOnly(p.expiresAt) },
  ];
  return (
    <>
      <StaffPageHeader
        title="Packets"
        description={
          list.length && !list[0]!.canRelease
            ? "Minimum-necessary sharing: each names a recipient, a purpose and an end date. Hospice operations or an authority/consent reviewer releases them."
            : "Minimum-necessary sharing: each names a recipient, a purpose and an end date."
        }
        actions={households.length > 0 ? <DraftPacket households={households} /> : undefined}
      />
      <ViewTabs
        label="Packet views"
        className="mb-3"
        items={TABS.map((t) => ({
          key: t,
          label: TAB_LABELS[t],
          count: list.filter((p) => tabOf(p) === t).length,
          active: tab === t,
          render: (cls, children) => (
            <Link
              to="/staff/packets"
              search={{ tab: t }}
              className={cls}
              aria-current={tab === t ? "page" : undefined}
            >
              {children}
            </Link>
          ),
        }))}
      />
      <SplitPane
        open={!!active}
        onClose={() => set(undefined)}
        detailLabel="Packet details"
        list={
          rows.length === 0 ? (
            <p className="rounded-[var(--s-radius)] border bg-surface px-4 py-6 text-ink-soft">
              {tab === "release"
                ? list.length
                  ? "Nothing is waiting to be released."
                  : "No packets yet. Draft one from a household's Packets tab."
                : tab === "released"
                  ? "No packet is currently released."
                  : "No packet has ended yet."}
            </p>
          ) : (
            <DataTable
              rows={rows}
              columns={
                active ? cols.filter((c) => !["household", "check", "recipient"].includes(c.key)) : cols
              }
              caption={
                tab === "release"
                  ? "Packets to release, soonest end date first"
                  : tab === "released"
                    ? "Released packets, most recent first"
                    : "Ended packets"
              }
              activeId={sel}
              onActivate={(p) => set(p.id)}
              openLabel={(p) => `Open the packet for ${p.recipientName || "no recipient"}`}
            />
          )
        }
        detail={
          active && (
            <div className="space-y-3" data-testid="detail-panel">
              <div className="flex items-start justify-between gap-2">
                <h2>{active.recipientName || "No recipient"}</h2>
                <StatusChip domain="packet" value={statusOf(active)} />
              </div>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-ink-soft">Purpose</dt>
                <dd>{active.purpose || "No purpose"}</dd>
                <dt className="text-ink-soft">Household</dt>
                <dd>{active.household}</dd>
                <dt className="text-ink-soft">Includes</dt>
                <dd>
                  {active.manifest.length ? (
                    <ul className="list-disc pl-4">
                      {active.manifest.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-soft">Nothing selected yet</span>
                  )}
                </dd>
                <dt className="text-ink-soft">Until</dt>
                <dd>
                  {dateOnly(active.expiresAt)}
                  {active.endsSoon && <span className="ml-1 font-semibold">· ends soon</span>}
                </dd>
                {active.recipient && (
                  <>
                    <dt className="text-ink-soft">Recipient</dt>
                    <dd>{active.recipient}</dd>
                  </>
                )}
                <dt className="text-ink-soft">
                  {active.state === "released" ? "Released" : "Release check now"}
                </dt>
                <dd>
                  {active.state === "released" && active.releasedAt ? (
                    dateOnly(active.releasedAt)
                  ) : (
                    <>
                      <StatusChip domain="decision" value={active.preview.decision} />{" "}
                      {reasonLabel(active.preview.reasonCode)}
                      <CodeDetails code={active.preview.reasonCode} />
                    </>
                  )}
                </dd>
              </dl>
              <div className="flex flex-wrap gap-2 border-t pt-2">
                <ButtonLink to="/staff/packets/$packetId" params={{ packetId: active.id }} size="sm">
                  {active.state === "draft" || active.state === "held"
                    ? "Open to release…"
                    : "Open the packet"}
                </ButtonLink>
                {active.state === "released" && (
                  <Link
                    to="/staff/packets/$packetId"
                    params={{ packetId: active.id }}
                    hash="receipt"
                    className="self-center text-harbor underline"
                  >
                    Receipt
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => set(undefined)}
                  className="ml-auto text-[0.75rem] text-ink-soft"
                >
                  Close
                </button>
              </div>
            </div>
          )
        }
      />
    </>
  );
}

/**
 * "Draft a packet…": choose the household, then draft on its Packets tab (where the form lives,
 * with that household's consents and authority beside it).
 */
function DraftPacket({ households }: { households: { id: string; name: string }[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Draft a packet…
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (id)
          void navigate({
            to: "/staff/households/$householdId",
            params: { householdId: id },
            search: { tab: "packets" },
          });
      }}
    >
      <label className="text-[0.75rem] text-ink-soft">
        For which household?
        <select
          autoFocus
          required
          className={inputClass + " !min-h-8 !w-52 !py-0.5"}
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">Choose…</option>
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm">
        Continue
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
