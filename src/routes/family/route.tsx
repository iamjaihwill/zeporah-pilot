import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { getFamilyHome, getHelperView } from "@/functions/family";
import { whoAmI } from "@/functions/session";
import { isDenied, unwrap } from "@/lib/client";
import { AppShell, type NavItem } from "@/components/shell";
import { ButtonLink, DeniedView } from "@/components/ui";
import { ConnectionStatus } from "@/components/offline";

/**
 * The household app's layout. Its loader re-runs after every action and navigation, so the unread
 * badge, setup progress and available sections are always current everywhere.
 */
export const Route = createFileRoute("/family")({
  // Signed out: the family sign-in, which brings them back here afterwards.
  beforeLoad: async ({ location }) => {
    if (!(await whoAmI())) throw redirect({ to: "/", search: { next: location.href } });
  },
  loader: async () => {
    const r = await getFamilyHome();
    // Staff who open the family app go to their own workspace instead of a refusal (item 8),
    // the same way the staff layout sends family accounts here.
    if (!r.ok && r.code === "NOT_PERMITTED") {
      const me = await whoAmI();
      if (me?.kind === "staff") throw redirect({ to: "/staff" });
      if (me?.kind === "recipient") throw redirect({ to: "/recipient" });
      // Task-only helpers (decision 42) have their own page and nothing else.
      if (me?.kind === "family") {
        const h = await getHelperView();
        if (h.ok && h.data.tasks.length) throw redirect({ to: "/helper" });
      }
    }
    return unwrap(r);
  },
  component: FamilyLayout,
});

function FamilyLayout() {
  const home = Route.useLoaderData();
  const textSize = isDenied(home) ? "standard" : home.textSize;
  useEffect(() => {
    document.documentElement.dataset["text"] = textSize;
    return () => void delete document.documentElement.dataset["text"];
  }, [textSize]);
  if (isDenied(home))
    return (
      <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-12">
        <DeniedView d={home} back={<ButtonLink to="/">Back to sign in</ButtonLink>} />
      </main>
    );
  const f = home.flags;
  const bereaved = home.household.lifecycle === "bereavement";
  const nav: NavItem[] = [
    // In bereavement support, Continuing support is the landing page (item 13).
    bereaved
      ? { to: "/family/bereavement", label: "Continuing support", icon: "home" }
      : { to: "/family", label: "Home", exact: true, icon: "home" },
    // Decision 46: the patient's own view.
    ...(home.isPatient ? [{ to: "/family/me" as const, label: "My care" }] : []),
    ...(!home.onboarding.complete && f.onboarding
      ? [{ to: "/family/onboarding" as const, label: "Setup" }]
      : []),
    { to: "/family/tasks", label: "Tasks", icon: "tasks" },
    { to: "/family/messages", label: f.thread ? "Updates & messages" : "Updates", icon: "messages" },
    ...(f.vaultNav ? [{ to: "/family/vault" as const, label: "Vault", icon: "vault" as const }] : []),
    { to: "/family/people", label: "People", icon: "people" },
    ...(f.consent ? [{ to: "/family/sharing" as const, label: "Sharing" }] : []),
    // Someone without the Sharing page still sees the consents that name them, and only those.
    ...(!f.consent && home.namedConsents.open > 0
      ? [{ to: "/family/consents" as const, label: "Consents for you" }]
      : []),
    { to: "/family/support", label: "Support", icon: "support" },
    { to: "/family/notifications", label: "Notifications", badge: home.unread },
    { to: "/family/settings", label: "Settings" },
  ];
  // Phones get a bottom bar: four everyday destinations plus "More" for the rest.
  const primaryPaths = [
    bereaved ? "/family/bereavement" : "/family",
    "/family/tasks",
    "/family/messages",
    f.vaultNav ? "/family/vault" : "/family/people",
  ];
  // Short tab labels. "Messages" only for people who have the message thread; others see "Updates".
  const short: Record<string, string> = {
    "/family/messages": f.thread ? "Messages" : "Updates",
    "/family/bereavement": "Support",
  };
  const mobileTabs = {
    primary: primaryPaths
      .map((p) => nav.find((n) => n.to === p))
      .filter((n): n is NavItem => !!n)
      .map((n) => ({ ...n, label: short[String(n.to)] ?? n.label })),
    more: nav.filter((n) => !primaryPaths.includes(String(n.to))),
  };
  return (
    <AppShell
      who={home.me}
      nav={nav}
      mobileTabs={mobileTabs}
      context={
        <>
          {home.household.name}
          <span className="block text-xs">{home.household.lifecycleLabel}</span>
        </>
      }
    >
      <ConnectionStatus line={home.hotline} />
      <Outlet />
    </AppShell>
  );
}
