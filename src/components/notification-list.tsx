import { useRouter } from "@tanstack/react-router";
import { markNotificationsRead } from "@/functions/notifications";
import { cx, useAction } from "@/lib/client";
import { Stamp, Button, EmptyState, ErrorText } from "@/components/ui";

type N = { id: string; title: string; link: string; readAt: Date | null; createdAt: Date; kind: string };

/** Shared by both sides. Opening one marks it read; the unread count updates everywhere. */
export function NotificationList({
  items,
  email,
}: {
  items: N[];
  email?: { available: boolean; on: boolean } | undefined;
}) {
  const router = useRouter();
  const { act, pending, error } = useAction();
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-soft" aria-live="polite">
          {unread ? `${unread} unread` : "You're all caught up."}
        </p>
        {unread > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              act(() => markNotificationsRead({ data: { ids: "all" } }), "All notifications marked as read.")
            }
          >
            Mark all as read
          </Button>
        )}
      </div>
      <ErrorText error={error} />
      {items.length === 0 ? (
        <EmptyState title="No notifications">
          When something changes that's relevant to you, it will show up here.
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-[var(--radius-card)] border bg-surface">
          {items.map((n) => (
            <li key={n.id}>
              <a
                href={n.link}
                className={cx(
                  "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunk",
                  !n.readAt && "bg-harbor-soft/50",
                )}
                onClick={async (e) => {
                  // A plain link, so it can be opened in a new tab; a normal click marks it read first.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  if (!n.readAt) await act(() => markNotificationsRead({ data: { ids: [n.id] } }));
                  router.history.push(n.link);
                }}
              >
                <span
                  aria-hidden
                  className={cx("mt-2 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-clay")}
                />
                <span className="min-w-0 flex-1">
                  <span className={cx("block", !n.readAt && "font-semibold")}>
                    {!n.readAt && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </span>
                  <span className="block text-sm text-ink-soft">
                    <Stamp at={n.createdAt} />
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-ink-soft">
        {email?.on
          ? "You also get a short email when there's something new. Neither the email nor these notifications include names, health details or message text."
          : email?.available
            ? "You can also get a short email when there's something new: turn it on in Settings. Notifications never include names, health details or message text."
            : "Notifications stay inside Zeporah. They never include names, health details or message text."}
      </p>
    </>
  );
}
