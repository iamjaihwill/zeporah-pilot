import { createFileRoute } from "@tanstack/react-router";
import { getEmailNoticeState, getNotifications } from "@/functions/notifications";
import { isDenied, unwrap } from "@/lib/client";
import { DeniedView, PageHeader } from "@/components/ui";
import { NotificationList } from "@/components/notification-list";

export const Route = createFileRoute("/family/notifications")({
  loader: async () => {
    const [items, email] = await Promise.all([getNotifications(), getEmailNoticeState()]);
    return { items: unwrap(items), email: unwrap(email) };
  },
  component: () => {
    const { items, email } = Route.useLoaderData();
    if (isDenied(items)) return <DeniedView d={items} />;
    return (
      <>
        <PageHeader eyebrow="Notifications" title="What's changed" />
        <NotificationList items={items} email={isDenied(email) ? undefined : email} />
      </>
    );
  },
});
