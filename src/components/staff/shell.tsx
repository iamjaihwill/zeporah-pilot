import { Link, useNavigate, useRouter, useRouterState, type LinkProps } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/functions/session";
import { NavIcon } from "./nav-icons";
import { setDensity, staffSearch } from "@/functions/staff-shell";
import { getNotifications, markNotificationsRead } from "@/functions/notifications";
import { cx } from "@/lib/client";
import { Kbd, Popover } from "@/components/staff";
import { GuideTour } from "./guide";
import { guideRole, startTour, type GuideRole } from "@/domain/staff-guide";

export type StaffNavItem = {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  short: string;
  group: "Work" | "Households" | "Oversight" | "Admin" | "Testing" | "Notifications";
  count?: number | undefined;
  /** What the count means, for screen readers ("waiting" unless said otherwise). */
  countLabel?: string;
  exact?: boolean;
};

type Me = { name: string; roles: string[]; tenantName: string; roleCodes: string[] };

/** True when a key press shouldn't trigger a shortcut (typing in a field, or with a modifier). */
export function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
      !!t.closest("[role=dialog] input"))
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl+K", "Search households, people, packets, consents and escalations"],
  ["J / ↓", "Next item in a list"],
  ["K / ↑", "Previous item"],
  ["Enter", "Open the selected item"],
  ["Esc", "Close the detail panel or a menu"],
  ["T", "Take ownership (where you can)"],
  ["A", "Assign to… (operations)"],
  ["R", "Reply to the household (where relevant)"],
  ["?", "Show these shortcuts"],
];

/**
 * The staff workspace frame (staff rework, section 2). A stable header (search, notifications,
 * help, who you are) and a grouped sidebar that collapses to icons. Everything inside carries
 * data-surface="staff", which is what scopes the staff design system; the family app never does.
 */
export function StaffShell({
  me,
  nav,
  unread,
  density,
  children,
  staffOnlySearch = false,
}: {
  me: Me;
  nav: StaffNavItem[];
  unread: number;
  density: "comfortable" | "compact";
  children: ReactNode;
  /** Administrators see no households, so search looks for staff only (and says so). */
  staffOnlySearch?: boolean;
}) {
  const searchName = staffOnlySearch
    ? "Search staff"
    : "Search households, people, packets, consents and escalations";
  const navigate = useNavigate();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Density applies at once; the saved preference follows (and wins on the next load).
  const [shown, setShown] = useState(density);
  useEffect(() => setShown(density), [density]);
  const shortcuts = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("zeporah.staff.sidebar") === "collapsed");
    } catch {
      /* storage unavailable: start expanded */
    }
  }, []);
  // Focus moves to the page after navigation (screen-reader users land on the new page).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [path]);
  // Global shortcuts: ⌘K / Ctrl+K search; "?" lists shortcuts (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "?" && !typing(e) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        shortcuts.current?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("zeporah.staff.sidebar", next ? "collapsed" : "expanded");
    } catch {
      /* not saved: fine */
    }
  };
  const signOutNow = async () => {
    await signOut();
    await navigate({ to: "/staff-sign-in" });
  };
  const groups = ["Work", "Households", "Oversight", "Admin", "Testing", "Notifications"] as const;

  const sidebarNav = (
    <nav aria-label="Main" className="flex flex-wrap gap-1 px-3 pb-4 md:block md:space-y-5">
      {groups.map((g) => {
        const items = nav.filter((n) => n.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="flex flex-wrap gap-1 md:block">
            {g !== "Notifications" && (
              <p
                className={cx(
                  "sr-only px-2.5 pb-1.5 text-[0.6875rem] font-medium tracking-[0.06em] text-ink-soft uppercase",
                  !collapsed && "md:not-sr-only md:block",
                )}
              >
                {g}
              </p>
            )}
            <ul className="flex flex-wrap gap-1 md:flex-col md:gap-0.5" aria-label={g}>
              {items.map((n) => (
                <li key={String(n.to)} className="shrink-0">
                  <Link
                    to={n.to}
                    activeOptions={{ exact: n.exact ?? false }}
                    title={collapsed ? n.label : undefined}
                    className="flex h-9 items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-[0.875rem] font-medium whitespace-nowrap text-ink/80 hover:bg-surface/70 hover:text-ink"
                    activeProps={{
                      className:
                        "!border-line bg-surface font-semibold !text-ink shadow-[0_1px_2px_oklch(0.2_0.01_265/0.06)]",
                      "aria-current": "page",
                    }}
                  >
                    <NavIcon path={String(n.to)} />
                    <span className={cx(collapsed && "md:sr-only")}>{n.label}</span>
                    {n.count !== undefined && n.count > 0 && (
                      <span
                        className={cx(
                          "ml-auto rounded-full border bg-surface px-1.5 text-[0.6875rem] font-semibold text-ink-soft",
                          collapsed && "md:hidden",
                        )}
                      >
                        {n.count}
                        <span className="sr-only"> {n.countLabel ?? "waiting"}</span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={collapsed}
        className="hidden h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[0.8125rem] text-ink-soft hover:bg-surface/70 md:flex"
      >
        <span aria-hidden>{collapsed ? "»" : "«"}</span>
        <span className={cx(collapsed && "sr-only")}>Collapse sidebar</span>
      </button>
    </nav>
  );

  return (
    // Enterprise skin (2026-10-21): the wordmark heads a full-height sidebar on a grey canvas; the
    // search and account controls sit above a white content panel. Same navigation and controls.
    <div
      data-surface="staff"
      data-density={shown}
      className={cx(
        "min-h-screen bg-paper md:grid",
        collapsed ? "md:grid-cols-[3.75rem_minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)]",
      )}
    >
      {/* Wide screens only; phones and small tablets use the bottom bar and Menu below. */}
      <aside className="bg-paper max-md:hidden md:sticky md:top-0 md:h-dvh md:overflow-y-auto">
        <div className="flex h-16 items-center px-4">
          <Link to="/staff" className="wordmark font-display text-[1.375rem] text-ink">
            {collapsed ? (
              <span className="max-md:hidden" aria-label="Zeporah">
                Z<span className="text-clay">.</span>
              </span>
            ) : null}
            <span className={cx(collapsed && "md:hidden")}>
              Zeporah<span className="text-clay">.</span>
            </span>
          </Link>
        </div>
        {sidebarNav}
      </aside>
      <div className="min-w-0">
        <header
          data-topbar
          className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-paper px-3 md:h-16 md:border-b-0 md:px-4 lg:px-6"
        >
          {/* Phones: the wordmark lives here (the sidebar is hidden). */}
          <Link to="/staff" className="wordmark mr-auto font-display text-[1.25rem] text-ink md:hidden">
            Zeporah<span className="text-clay">.</span>
          </Link>
          <span className="hidden truncate text-[0.8125rem] text-ink-soft lg:inline">{me.tenantName}</span>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={searchName}
            data-tour="search"
            className="mx-auto flex h-10 w-full min-w-0 max-w-xl items-center gap-2 rounded-xl border bg-surface px-3.5 text-left text-[0.875rem] text-ink-soft hover:border-line-strong max-sm:mx-0 max-sm:w-10 max-sm:flex-none max-sm:justify-center max-sm:px-0"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="size-[1.0625rem] shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {/* Phones show just the icon in a square button; the button keeps its name. */}
            <span aria-hidden className="min-w-0 flex-1 truncate max-sm:hidden">
              {staffOnlySearch ? "Search staff…" : "Search households, people, packets…"}
            </span>
            <span className="hidden lg:inline">
              <Kbd>⌘K</Kbd>
            </span>
          </button>
          <NotificationsMenu unread={unread} onChange={() => router.invalidate()} />
          <Popover label="Help" button={<span className="font-semibold">?</span>}>
            {(close) => (
              <ul className="space-y-1">
                {(
                  [
                    ["statuses", "What each status means"],
                    ["queue", "How the queue is ordered"],
                    ["consent", "Consent: record, confirm, activate"],
                    ["release", "Releasing a packet"],
                    ["triage", "Not clinical triage"],
                    ["authority", "Workflow state, not a legal determination"],
                  ] as const
                ).map(([h, l]) => (
                  <li key={h}>
                    <Link
                      to="/staff/help"
                      hash={h!}
                      onClick={close}
                      className="block rounded px-2 py-1.5 hover:bg-sunk"
                    >
                      {l}
                    </Link>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left hover:bg-sunk"
                    onClick={() => {
                      close();
                      shortcuts.current?.showModal();
                    }}
                  >
                    Keyboard shortcuts <Kbd>?</Kbd>
                  </button>
                </li>
                <li>
                  {/* The first-time guide's tour, any time. */}
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left hover:bg-sunk"
                    onClick={() => {
                      close();
                      startTour();
                    }}
                  >
                    Take the tour
                  </button>
                </li>
              </ul>
            )}
          </Popover>
          <Popover
            label={`Account: ${me.name}`}
            button={
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-harbor-soft text-[0.75rem] font-semibold text-harbor-strong">
                {me.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
            }
          >
            {(close) => (
              <div className="space-y-3">
                <div className="px-2 pt-1">
                  <p className="font-semibold">{me.name}</p>
                  <p className="text-ink-soft">{me.roles.join(" · ")}</p>
                  <p className="text-ink-soft">{me.tenantName}</p>
                </div>
                <fieldset className="px-2">
                  <legend className="mb-1 text-[0.75rem] font-semibold text-ink-soft">Density</legend>
                  {(["comfortable", "compact"] as const).map((d) => (
                    <label key={d} className="mr-3 inline-flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="density"
                        checked={shown === d}
                        onChange={async () => {
                          setShown(d);
                          await setDensity({ data: { density: d } });
                          await router.invalidate();
                        }}
                      />
                      {d === "comfortable" ? "Comfortable" : "Compact"}
                    </label>
                  ))}
                </fieldset>
                <div className="border-t pt-2">
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left hover:bg-sunk"
                    onClick={() => {
                      close();
                      shortcuts.current?.showModal();
                    }}
                  >
                    Keyboard shortcuts
                  </button>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left text-harbor hover:bg-sunk"
                    onClick={signOutNow}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </Popover>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="min-h-[calc(100dvh-4rem)] min-w-0 bg-surface px-4 py-6 focus:outline-none max-md:pb-28 md:rounded-tl-2xl md:border-t md:border-l lg:px-8"
        >
          {children}
          <footer className="mt-10 border-t pt-3 text-[0.75rem] text-ink-soft">
            Using a shared computer? Sign out when you're done. ·{" "}
            <Link to="/info/$page" params={{ page: "privacy" }} className="underline">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link to="/info/$page" params={{ page: "accessibility" }} className="underline">
              Accessibility
            </Link>
          </footer>
        </main>
      </div>
      <MobileNav nav={nav} roles={me.roleCodes} groups={groups} />
      <GuideTour roles={me.roleCodes} />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} label={searchName} />

      <dialog
        ref={shortcuts}
        aria-labelledby="shortcuts-title"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border bg-surface p-4 text-ink"
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <p className="mt-1 text-[0.75rem] text-ink-soft">Shortcuts never fire while you're typing.</p>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <Kbd>{k}</Kbd>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog" className="mt-4 text-right">
          <button className="rounded-lg border px-3 py-1.5 text-[0.8125rem]">Close</button>
        </form>
      </dialog>
    </div>
  );
}

/** Notifications popover: unread state, and every item opens the exact object. */
function NotificationsMenu({ unread, onChange }: { unread: number; onChange: () => void }) {
  const [items, setItems] = useState<
    { id: string; title: string; link: string; readAt: Date | null }[] | null
  >(null);
  const navigate = useNavigate();
  return (
    <Popover
      label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      button={
        <span className="relative inline-flex">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="size-[1.125rem]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {unread > 0 && (
            <span
              data-testid="unread-badge"
              className="absolute -top-1.5 -right-2 rounded-full bg-clay px-1 text-[0.625rem] font-bold text-white"
            >
              {unread}
            </span>
          )}
        </span>
      }
      panelClassName="w-80"
    >
      {(close) => (
        <NotificationsPanel
          items={items}
          load={async () => {
            const r = await getNotifications();
            setItems(r.ok ? r.data.slice(0, 12) : []);
          }}
          open={async (n) => {
            close();
            if (!n.readAt) await markNotificationsRead({ data: { ids: [n.id] } });
            onChange();
            const [to, hash] = n.link.split("#");
            await navigate({ to: to!, ...(hash ? { hash } : {}) } as never);
          }}
        />
      )}
    </Popover>
  );
}

function NotificationsPanel({
  items,
  load,
  open,
}: {
  items: { id: string; title: string; link: string; readAt: Date | null }[] | null;
  load: () => Promise<void>;
  open: (n: { id: string; title: string; link: string; readAt: Date | null }) => Promise<void>;
}) {
  useEffect(() => {
    void load();
  }, []);
  if (!items) return <p className="px-2 py-3 text-ink-soft">Loading…</p>;
  return (
    <div>
      {items.length === 0 ? (
        <p className="px-2 py-3 text-ink-soft">Nothing new.</p>
      ) : (
        <ul className="max-h-80 divide-y overflow-y-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                className="flex w-full items-start gap-2 px-2 py-2 text-left hover:bg-sunk"
              >
                <span
                  aria-hidden
                  className={cx(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    n.readAt ? "bg-transparent" : "bg-clay",
                  )}
                />
                <span className={cx(!n.readAt && "font-semibold")}>
                  {!n.readAt && <span className="sr-only">Unread: </span>}
                  {n.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link to="/staff/notifications" className="mt-1 block rounded px-2 py-1.5 text-harbor hover:bg-sunk">
        All notifications
      </Link>
    </div>
  );
}

/** ⌘K search. Results come from the server, scoped to what this person can already see. */
function SearchDialog({ open, onClose, label }: { open: boolean; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<
    { type: string; id: string; title: string; detail: string; link: string }[]
  >([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await staffSearch({ data: { q } });
      setHits(r.ok ? r.data : []);
      setActive(0);
      setBusy(false);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const go = async (h: { link: string }) => {
    onClose();
    setQ("");
    const [to, rest] = h.link.split("?");
    const search = Object.fromEntries(new URLSearchParams(rest ?? ""));
    await navigate({ to: to!, search } as never);
  };
  const TYPE: Record<string, string> = {
    household: "Household",
    person: "Person",
    packet: "Packet",
    consent: "Consent",
    escalation: "Escalation",
    staff: "Staff",
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="search-title"
      onClose={onClose}
      className="mx-auto mt-[10vh] w-[min(36rem,calc(100vw-2rem))] rounded-xl border bg-surface p-0 text-ink"
    >
      <h2 id="search-title" className="sr-only">
        Search
      </h2>
      <div className="border-b p-2">
        <input
          autoFocus
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="search-results"
          aria-activedescendant={hits[active] ? `hit-${active}` : undefined}
          aria-label={label}
          placeholder={label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && hits[active]) {
              e.preventDefault();
              void go(hits[active]);
            }
          }}
          className="w-full border-0 bg-transparent px-2 py-1.5 text-[0.875rem] focus:outline-none"
        />
      </div>
      <ul
        id="search-results"
        role="listbox"
        aria-label="Results"
        className="max-h-[50vh] overflow-y-auto p-1"
      >
        {hits.map((h, i) => (
          <li
            key={`${h.type}-${h.id}`}
            id={`hit-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => void go(h)}
            className={cx(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
              i === active && "bg-harbor-soft",
            )}
          >
            <span className="w-20 shrink-0 text-[0.6875rem] font-semibold text-ink-soft uppercase">
              {TYPE[h.type]}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{h.title}</span>
              <span className="block truncate text-[0.75rem] text-ink-soft">{h.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t px-3 py-2 text-[0.75rem] text-ink-soft" aria-live="polite">
        {q.trim().length < 2
          ? "Type at least two letters."
          : busy
            ? "Searching…"
            : hits.length
              ? `${hits.length} result${hits.length === 1 ? "" : "s"}. ↑↓ to move, Enter to open, Esc to close.`
              : "Nothing matches in the households you can see."}
      </p>
    </dialog>
  );
}

/**
 * Phones and small tablets (under 768px): a fixed bottom bar with the four pages each role uses
 * most, with their counts, and "Menu", which opens every page grouped as on the sidebar. Same
 * pages, labels and counts as the sidebar; only where they sit changes.
 */
const PRIMARY: Record<GuideRole, string[]> = {
  care_guide: ["/staff", "/staff/exceptions", "/staff/households", "/staff/tasks"],
  hospice_ops: ["/staff", "/staff/exceptions", "/staff/households", "/staff/team"],
  privileged_reviewer: ["/staff", "/staff/reviews", "/staff/exceptions", "/staff/sharing"],
  hospice_admin: ["/staff/admin", "/staff/team", "/staff/settings", "/staff/audit"],
};
/** Short names for the bar (the full name is still the link's accessible name). */
const SHORT: Record<string, string> = {
  "/staff": "My work",
  "/staff/exceptions": "Exceptions",
  "/staff/households": "Households",
  "/staff/tasks": "Tasks",
  "/staff/team": "Team",
  "/staff/reviews": "Reviews",
  "/staff/sharing": "Sharing",
  "/staff/admin": "Admin",
  "/staff/settings": "Settings",
  "/staff/audit": "Audit",
};

function MobileNav({
  nav,
  roles,
  groups,
}: {
  nav: StaffNavItem[];
  roles: string[];
  groups: readonly string[];
}) {
  const menu = useRef<HTMLDialogElement>(null);
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Close the menu whenever the page changes.
  useEffect(() => {
    if (menu.current?.open) menu.current.close();
  }, [path]);
  const primary = PRIMARY[guideRole(roles)]
    .map((to) => nav.find((n) => String(n.to) === to))
    .filter((n): n is StaffNavItem => !!n);
  const inBar = new Set(primary.map((n) => String(n.to)));
  const elsewhereActive = nav.some(
    (n) =>
      !inBar.has(String(n.to)) &&
      (n.exact ? path === n.to : path.startsWith(String(n.to)) && n.to !== "/staff"),
  );
  return (
    <>
      <nav
        aria-label="Main"
        data-bottom-bar
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {primary.map((n) => (
            <li key={String(n.to)}>
              <Link
                to={n.to}
                activeOptions={{ exact: n.exact ?? false }}
                aria-label={n.count ? `${n.label}, ${n.count} ${n.countLabel ?? "waiting"}` : n.label}
                className="relative flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-ink-soft"
                activeProps={{ className: "!text-harbor font-semibold", "aria-current": "page" }}
              >
                <span className="relative">
                  <NavIcon path={String(n.to)} />
                  {n.count !== undefined && n.count > 0 && (
                    <span
                      aria-hidden
                      className="absolute -top-2 left-3 min-w-4 rounded-full bg-harbor px-1 text-center text-[0.625rem] leading-4 font-bold text-white"
                    >
                      {n.count}
                    </span>
                  )}
                </span>
                <span aria-hidden>{SHORT[String(n.to)] ?? n.label}</span>
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => menu.current?.showModal()}
              className={cx(
                "flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium",
                elsewhereActive ? "font-semibold text-harbor" : "text-ink-soft",
              )}
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              Menu
            </button>
          </li>
        </ul>
      </nav>
      {/* Every page, grouped as on the sidebar, as a sheet from the bottom. */}
      <dialog
        ref={menu}
        aria-label="Menu"
        className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border bg-surface p-0 backdrop:bg-[oklch(0.2_0.01_265/0.45)] md:hidden"
        onClick={(e) => {
          if (e.target === menu.current) menu.current.close();
        }}
      >
        <div className="sticky top-0 flex items-center justify-between border-b bg-surface px-4 py-3">
          <h2 className="text-[1rem]">Menu</h2>
          <button
            type="button"
            onClick={() => menu.current?.close()}
            className="rounded-lg px-3 py-2 text-[0.875rem] text-harbor"
          >
            Close
          </button>
        </div>
        <nav
          aria-label="All pages"
          className="space-y-4 px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          {groups.map((g) => {
            const items = nav.filter((n) => n.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <p className="px-2.5 pb-1 text-[0.6875rem] font-medium tracking-[0.06em] text-ink-soft uppercase">
                  {g}
                </p>
                <ul aria-label={g}>
                  {items.map((n) => (
                    <li key={String(n.to)}>
                      <Link
                        to={n.to}
                        activeOptions={{ exact: n.exact ?? false }}
                        className="flex h-11 items-center gap-3 rounded-lg px-2.5 text-[0.9375rem] font-medium text-ink"
                        activeProps={{ className: "bg-harbor-soft font-semibold", "aria-current": "page" }}
                      >
                        <NavIcon path={String(n.to)} />
                        <span>{n.label}</span>
                        {n.count !== undefined && n.count > 0 && (
                          <span className="ml-auto rounded-full border px-1.5 text-[0.75rem] font-semibold text-ink-soft">
                            {n.count}
                            <span className="sr-only"> {n.countLabel ?? "waiting"}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </dialog>
    </>
  );
}
