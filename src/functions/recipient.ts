import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Packet recipients (founder decision 45). Every check is on the server, in services/recipient.ts. */
const server = () => import("@/server/api");
const packet = z.object({ packetId: z.string().min(1).max(100) });

export const getRecipientPackets = createServerFn({ method: "GET" }).handler(async () => {
  const { run, recipient } = await server();
  return run((db, ctx) => recipient.recipientPackets(db, ctx));
});

export const getRecipientPacket = createServerFn({ method: "GET" })
  .validator(packet)
  .handler(async ({ data }) => {
    const { run, recipient } = await server();
    return run((db, ctx) => recipient.recipientPacket(db, ctx, data.packetId));
  });

export const acknowledgePacket = createServerFn({ method: "POST" })
  .validator(packet)
  .handler(async ({ data }) => {
    const { run, recipient } = await server();
    return run((db, ctx) => recipient.acknowledgePacket(db, ctx, data.packetId));
  });

export const requestClarification = createServerFn({ method: "POST" })
  .validator(packet.extend({ question: z.string().max(2000) }))
  .handler(async ({ data }) => {
    const { run, recipient } = await server();
    return run((db, ctx) => recipient.requestClarification(db, ctx, data));
  });

/** Before sign-in: the name and email a first-time recipient's link is for, or a refusal. */
export const previewRecipientSetup = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().max(200) }))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/server/db/client");
    const { previewRecipientSetup } = await import("@/server/services/recipient");
    try {
      return { ok: true as const, data: await previewRecipientSetup(await getDb(), data.token) };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  });

export const completeRecipientSetup = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().max(200), password: z.string().max(200) }))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/server/db/client");
    const { startSession } = await import("@/server/session");
    const { completeRecipientSetup } = await import("@/server/services/recipient");
    const { AccessError } = await import("@/server/context");
    try {
      const r = await completeRecipientSetup(await getDb(), data);
      await startSession({ tenantId: r.tenantId, actorId: r.actorId, userId: r.userId, method: "password" });
      return { ok: true as const };
    } catch (e) {
      if (e instanceof AccessError) return { ok: false as const, message: e.message };
      return {
        ok: false as const,
        message: "That didn't go through. Please try again — nothing was changed.",
      };
    }
  });
