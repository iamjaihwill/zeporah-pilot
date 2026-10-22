import { StaffPageHeader } from "@/components/staff";
import { createFileRoute } from "@tanstack/react-router";
import { getNotifications } from "@/functions/notifications";
import { isDenied, unwrap } from "@/lib/client";
import { DeniedView, PageHeader } from "@/components/ui";
import { NotificationList } from "@/components/notification-list";

export const Route = createFileRoute("/staff/notifications")({
  loader: async () => unwrap(await getNotifications()),
  component: () => {
    const items = Route.useLoaderData();
    if (isDenied(items)) return <DeniedView d={items} />;
    return (
      <>
        <StaffPageHeader title="Notifications" />
        <NotificationList items={items} />
      </>
    );
  },
});
