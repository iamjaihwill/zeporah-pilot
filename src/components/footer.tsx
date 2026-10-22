import { Link } from "@tanstack/react-router";

/**
 * Shared footer for the sign-in page and every signed-in layout. The linked pages are honest
 * placeholders until the real policies are written (see docs/pre-pilot-plan.md, policy register).
 */
export function AppFooter({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  // onDark: light text for a dark background (the care-team sign-in's photo).
  const link = onDark
    ? "text-paper underline underline-offset-2 hover:no-underline"
    : "text-harbor underline-offset-2 hover:underline";
  // Compact: the sign-in page's single centred row, right under the form.
  return (
    <footer
      className={
        onDark
          ? "text-center text-sm text-paper"
          : compact
            ? "mt-4 text-center text-sm text-ink-soft"
            : "mt-16 border-t pt-6 text-sm text-ink-soft"
      }
    >
      <p>Using a shared computer? Sign out when you're done.</p>
      <nav aria-label="About Zeporah" className="mt-3">
        <ul
          className={
            compact || onDark
              ? "flex flex-wrap justify-center gap-x-5 gap-y-2"
              : "flex flex-wrap gap-x-5 gap-y-2"
          }
        >
          <li>
            <Link to="/info/$page" params={{ page: "privacy" }} className={link}>
              Privacy
            </Link>
          </li>
          <li>
            <Link to="/info/$page" params={{ page: "terms" }} className={link}>
              Terms
            </Link>
          </li>
          <li>
            <Link to="/info/$page" params={{ page: "accessibility" }} className={link}>
              Accessibility
            </Link>
          </li>
          <li>
            <Link to="/info/$page" params={{ page: "support" }} className={link}>
              Support
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
