import { Link, useNavigate, useRouterState, type LinkProps } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { signOut } from "@/functions/session";
import { cx } from "@/lib/client";
import { AppFooter } from "@/components/footer";

export type NavItem = {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  badge?: number | undefined;
  exact?: boolean;
  /** Optional section heading in the sidebar (e.g. "Work", "Oversight"). Items keep their order. */
  group?: string;
  /** A small icon for the phone tab bar (item 14). Decorative: the label always shows. */
  icon?: keyof typeof ICONS;
};

/** Line icons for the phone tab bar, drawn in currentColor. */
const ICONS = {
  home: "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  tasks: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  messages: "M4 5h16v11H8l-4 4z",
  vault: "M4 7h16v13H4zM4 7l2-3h12l2 3M10 12h4",
  people:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .8 3 3 3 6",
  support: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

function TabIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Phone navigation for the family app: a bottom bar plus a "More" sheet. */
export type MobileTabs = { primary: NavItem[]; more: NavItem[] };

/** Moves focus to the page heading region after client-side navigation, so screen-reader users land on the new page. */
function useFocusOnNavigate() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: false });
  }, [path]);
}

function UnreadBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-clay px-1.5 text-xs font-bold text-white"
      data-testid="unread-badge"
    >
      {n}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function NavLink({ n, compact }: { n: NavItem; compact?: boolean }) {
  return (
    <Link
      to={n.to}
      activeOptions={{ exact: n.exact ?? false }}
      className={cx(
        "flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-[0.95rem] whitespace-nowrap text-ink-soft hover:bg-surface hover:text-ink",
        compact && "w-full",
      )}
      activeProps={{
        className: "bg-surface font-semibold !text-ink shadow-[var(--shadow-card)]",
        "aria-current": "page",
      }}
    >
      {n.label}
      {n.badge !== undefined && <UnreadBadge n={n.badge} />}
    </Link>
  );
}

/** Sidebar navigation, in labelled sections when items carry a group. */
function SideNav({ nav, className }: { nav: NavItem[]; className?: string | undefined }) {
  const groups: { label: string | undefined; items: NavItem[] }[] = [];
  for (const n of nav) {
    const last = groups[groups.length - 1];
    if (last && last.label === n.group) last.items.push(n);
    else groups.push({ label: n.group, items: [n] });
  }
  return (
    <nav
      aria-label="Main"
      className={cx("relative overflow-x-auto border-t px-2 py-2 lg:border-t-0 lg:px-3", className)}
    >
      <div className="flex gap-1 lg:block lg:space-y-3">
        {groups.map((g, i) => (
          <div key={i} className="flex gap-1 lg:block">
            {g.label && (
              <p className="sr-only px-3 pt-1 pb-1 text-xs font-semibold tracking-wide text-ink-soft uppercase lg:not-sr-only lg:block">
                {g.label}
              </p>
            )}
            <ul className="flex gap-1 lg:flex-col" aria-label={g.label}>
              {g.items.map((n) => (
                <li key={String(n.to)} className="shrink-0">
                  <NavLink n={n} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** Phone only (below md): a fixed bottom bar with up to five items, the last opening a sheet with the rest. */
function BottomBar({ tabs, onSignOut }: { tabs: MobileTabs; onSignOut: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    ref.current?.close();
  }, [path]);
  const moreUnread = tabs.more.reduce((n, t) => n + (t.badge ?? 0), 0);
  const moreActive = tabs.more.some((t) => path === t.to || path.startsWith(`${String(t.to)}/`));
  const tab =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs text-ink-soft hover:text-ink";
  return (
    <>
      <nav
        aria-label="Main"
        data-bottom-bar
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex">
          {tabs.primary.map((n) => (
            <li key={String(n.to)} className="flex flex-1">
              <Link
                to={n.to}
                activeOptions={{ exact: n.exact ?? false }}
                className={tab}
                activeProps={{ className: "font-semibold !text-harbor", "aria-current": "page" }}
              >
                {n.icon && <TabIcon name={n.icon} />}
                <span>{n.label}</span>
                {n.badge ? <UnreadBadge n={n.badge} /> : null}
              </Link>
            </li>
          ))}
          <li className="flex flex-1">
            <button
              type="button"
              className={cx(tab, moreActive && "font-semibold !text-harbor")}
              aria-haspopup="dialog"
              onClick={() => ref.current?.showModal()}
            >
              <TabIcon name="more" />
              <span>More</span>
              {moreUnread > 0 && (
                <span
                  className="rounded-full bg-clay px-1.5 text-[0.7rem] font-bold text-white"
                  data-testid="unread-badge"
                >
                  {moreUnread}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </button>
          </li>
        </ul>
      </nav>
      <dialog
        ref={ref}
        aria-labelledby="more-title"
        className="mx-auto mt-auto mb-0 w-full max-w-none rounded-t-2xl border bg-surface p-4 text-ink shadow-xl backdrop:bg-ink/30"
      >
        <div className="flex items-center justify-between">
          <h2 id="more-title" className="text-xl">
            More
          </h2>
          <button type="button" className="min-h-11 px-3 text-harbor" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
        <ul className="mt-2 divide-y">
          {tabs.more.map((n) => (
            <li key={String(n.to)}>
              <NavLink n={n} compact />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex min-h-11 w-full items-center px-3 py-2 text-left text-harbor"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </li>
        </ul>
      </dialog>
    </>
  );
}

export function AppShell({
  who,
  context,
  nav,
  mobileTabs,
  wide,
  children,
}: {
  who: { name: string; roles: string[] };
  context: ReactNode;
  nav: NavItem[];
  /** When given, phones get a bottom bar instead of the scrolling top nav. */
  mobileTabs?: MobileTabs;
  wide?: boolean;
  children: ReactNode;
}) {
  useFocusOnNavigate();
  const navigate = useNavigate();
  // On a phone, the family home's heading already names the household: don't repeat it above (item 14).
  const path = useRouterState({ select: (s) => s.location.pathname });
  const hideContextOnPhone = !!mobileTabs && path === "/family";
  const signOutNow = async () => {
    await signOut();
    await navigate({ to: "/" });
  };
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="border-b bg-sunk lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block lg:px-5 lg:py-6">
          <div className="min-w-0">
            <Link to="/" className="font-display text-xl">
              Zeporah<span className="text-clay">.</span>
            </Link>
            <div className={cx("text-sm text-ink-soft lg:mt-3", hideContextOnPhone && "max-md:hidden")}>
              {context}
            </div>
          </div>
          <div className={cx("text-right text-sm lg:mt-4 lg:text-left", mobileTabs && "hidden md:block")}>
            <p className="font-medium">{who.name}</p>
            <p className="text-ink-soft">{who.roles.join(" · ")}</p>
            <button
              type="button"
              className="mt-1 text-harbor underline-offset-2 hover:underline"
              onClick={signOutNow}
            >
              Sign out
            </button>
          </div>
        </div>
        <SideNav nav={nav} className={mobileTabs ? "hidden md:block" : undefined} />
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className={cx(
          "mx-auto w-full min-w-0 px-4 pt-6 focus:outline-none sm:px-8 lg:pt-10",
          mobileTabs ? "pb-28 md:pb-16" : "pb-16",
          wide ? "max-w-7xl" : "max-w-5xl",
        )}
      >
        {children}
        <AppFooter />
      </main>
      {mobileTabs && <BottomBar tabs={mobileTabs} onSignOut={signOutNow} />}
    </div>
  );
}
