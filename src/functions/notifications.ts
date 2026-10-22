/** Notifications are shared by both sides of the app: each person only ever sees their own. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const server = () => import("@/server/api");

export const getNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const { run, notifications } = await server();
  return run((db, ctx) => notifications.listNotifications(db, ctx));
});

export const getEmailNoticeState = createServerFn({ method: "GET" }).handler(async () => {
  const { run, notifications } = await server();
  return run((db, ctx) => notifications.emailNoticeState(db, ctx));
});

export const getUnreadCount = createServerFn({ method: "GET" }).handler(async () => {
  const { run, notifications } = await server();
  return run((db, ctx) => notifications.unreadCount(db, ctx));
});

export const markNotificationsRead = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.union([z.array(z.string()).max(200), z.literal("all")]) }))
  .handler(async ({ data }) => {
    const { run, notifications } = await server();
    return run((db, ctx) => notifications.markRead(db, ctx, data.ids));
  });
