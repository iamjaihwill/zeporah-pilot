import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getAuthOptions, whoAmI } from "@/functions/session";
import { getUnreadCount } from "@/functions/notifications";
import { getStaffShell } from "@/functions/staff-shell";
import { StaffShell, type StaffNavItem } from "@/components/staff/shell";
import { StatusLabelsContext } from "@/components/staff/status-chip";

/** The hospice staff workspace (desktop and tablet). Family personas are sent to their own app. */
export const Route = createFileRoute("/staff")({
  // Before any page's own loader runs: signed-out visitors go to the care-team sign-in.
  beforeLoad: async ({ location }) => {
    const me = await whoAmI();
    // Signed out: the care-team sign-in, which brings them back here afterwards.
    if (!me) throw redirect({ to: "/staff-sign-in", search: { next: location.href } });
    if (me.kind !== "staff") throw redirect({ to: "/family" });
  },
  loader: async () => {
    const me = await whoAmI();
    if (!me) throw redirect({ to: "/staff-sign-in" });
    if (me.kind !== "staff") throw redirect({ to: "/family" });
    const [unread, options, shell] = await Promise.all([getUnreadCount(), getAuthOptions(), getStaffShell()]);
    return {
      me,
      unread: unread.ok ? unread.data : 0,
      devTools: options.devSignIn,
      density: shell.ok ? shell.data.density : ("comfortable" as const),
      counts: shell.ok ? shell.data.counts : null,
      savedViews: shell.ok ? shell.data.savedViews : [],
      statusLabels: shell.ok ? shell.data.statusLabels : { task: {}, escalation: {} },
    };
  },
  component: StaffLayout,
});

function StaffLayout() {
  const { me, unread, devTools, density, counts, statusLabels } = Route.useLoaderData();
  const has = (r: string) => me.roleCodes.includes(r);
  // Administrators (decision 39) manage people, settings and access; they don't work on households.
  const works = me.roleCodes.some((r) => r !== "hospice_admin");
  // Grouped Work / Households / Oversight / Admin. Policy scenarios is a testing tool: shown only
  // when development tools are on (the server still allows operations by URL, per decision 21).
  const nav: StaffNavItem[] = [
    ...(works
      ? [
          {
            to: "/staff" as const,
            label: "My work",
            short: "MW",
            group: "Work" as const,
            exact: true,
            count: counts?.mine,
          },
          {
            // Decision 58: one list of exceptions, replacing the queue and escalations.
            to: "/staff/exceptions" as const,
            label: "Exceptions",
            short: "Ex",
            group: "Work" as const,
            count: counts?.exceptions,
            countLabel: "need you or have no owner",
          },
          { to: "/staff/packets" as const, label: "Packets", short: "P", group: "Work" as const },
          ...(has("care_guide")
            ? [
                {
                  to: "/staff/tasks" as const,
                  label: "Care-team tasks",
                  short: "Tk",
                  group: "Work" as const,
                  // Overdue or due today, so they're seen without opening the page.
                  count: counts?.tasksDue,
                  countLabel: "overdue or due today",
                },
              ]
            : []),
        ]
      : []),
    ...(has("privileged_reviewer")
      ? [
          {
            to: "/staff/reviews" as const,
            label: "Reviews",
            short: "R",
            group: "Work" as const,
            count: (counts?.authority ?? 0) + (counts?.consents ?? 0),
          },
        ]
      : []),
    ...(works
      ? [
          { to: "/staff/households" as const, label: "Households", short: "H", group: "Households" as const },
          {
            to: "/staff/sharing" as const,
            label: "Sharing register",
            short: "S",
            group: "Households" as const,
          },
          {
            to: "/staff/bereavement" as const,
            label: "Bereavement follow-up",
            short: "B",
            group: "Households" as const,
            count: counts?.bereavementDue,
            countLabel: "due this week or overdue",
          },
        ]
      : []),
    ...(has("hospice_ops") || has("privileged_reviewer") || has("hospice_admin")
      ? [{ to: "/staff/audit" as const, label: "Audit review", short: "Au", group: "Oversight" as const }]
      : []),
    ...(has("hospice_ops")
      ? [{ to: "/staff/reports" as const, label: "Reports", short: "Rp", group: "Oversight" as const }]
      : []),
    ...(has("hospice_admin")
      ? [{ to: "/staff/admin" as const, label: "Administration", short: "Ad", group: "Admin" as const }]
      : []),
    ...(has("hospice_ops") || has("hospice_admin")
      ? [
          { to: "/staff/team" as const, label: "Team & coverage", short: "T", group: "Admin" as const },
          { to: "/staff/settings" as const, label: "Hospice settings", short: "⚙", group: "Admin" as const },
          { to: "/staff/status" as const, label: "System status", short: "St", group: "Admin" as const },
        ]
      : []),
    ...(devTools
      ? [{ to: "/staff/policy" as const, label: "Policy scenarios", short: "PS", group: "Testing" as const }]
      : []),
    // Notifications live in the top bar's bell (with "See all"), not twice.
  ];
  return (
    <StaffShell
      me={{ name: me.name, roles: me.roles, tenantName: me.tenantName, roleCodes: me.roleCodes }}
      nav={nav}
      unread={unread}
      density={density}
      staffOnlySearch={!works}
    >
      <StatusLabelsContext.Provider value={statusLabels}>
        <Outlet />
      </StatusLabelsContext.Provider>
    </StaffShell>
  );
}
