/**
 * Simple line icons for the staff sidebar (replacing letter badges). Decorative: each link is
 * named by its text, which stays available to screen readers when the sidebar is collapsed.
 */
const P: Record<string, string[]> = {
  "/staff": ["M4 12l8-8 8 8", "M6 10v10h12V10"],
  "/staff/exceptions": ["M12 4l9 16H3z", "M12 10v4", "M12 17h.01"],
  "/staff/packets": ["M4 8l8-4 8 4v8l-8 4-8-4z", "M4 8l8 4 8-4", "M12 12v8"],
  "/staff/tasks": ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6l1 1 2-2", "M4 12l1 1 2-2", "M4 18l1 1 2-2"],
  "/staff/reviews": ["M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z", "M9 12l2 2 4-4"],
  "/staff/households": ["M3 11l9-7 9 7", "M5 10v10h14V10", "M10 20v-5h4v5"],
  "/staff/sharing": [
    "M7 12a3 3 0 1 0 0 .01",
    "M17 6a3 3 0 1 0 0 .01",
    "M17 18a3 3 0 1 0 0 .01",
    "M9.6 10.6l4.8-3",
    "M9.6 13.4l4.8 3",
  ],
  "/staff/bereavement": ["M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"],
  "/staff/audit": ["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 13h7", "M9 17h7"],
  "/staff/reports": ["M4 20V10", "M10 20V4", "M16 20v-7", "M3 20h18"],
  "/staff/admin": [
    "M12 15a3 3 0 1 0 0-.01",
    "M4 12h2",
    "M18 12h2",
    "M12 4v2",
    "M12 18v2",
    "M6.3 6.3l1.4 1.4",
    "M16.3 16.3l1.4 1.4",
    "M6.3 17.7l1.4-1.4",
    "M16.3 7.7l1.4-1.4",
  ],
  "/staff/team": [
    "M9 11a3 3 0 1 0 0-.01",
    "M17 11a2.5 2.5 0 1 0 0-.01",
    "M3 20c0-3 3-5 6-5s6 2 6 5",
    "M15 15.5c2.5 0 6 1 6 4.5",
  ],
  "/staff/settings": ["M4 7h10", "M18 7h2", "M16 5v4", "M4 17h4", "M12 17h8", "M10 15v4"],
  "/staff/status": ["M3 12h4l3-7 4 14 3-7h4"],
  "/staff/policy": ["M9 3h6", "M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"],
  "/staff/notifications": ["M6 16V11a6 6 0 0 1 12 0v5l2 2H4z", "M10 20a2 2 0 0 0 4 0"],
};

export function NavIcon({ path }: { path: string }) {
  const d = P[path] ?? ["M5 12h14"];
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.map((x, i) => (
        <path key={i} d={x} />
      ))}
    </svg>
  );
}
