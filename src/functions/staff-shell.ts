/** The staff workspace frame: density, saved views, Work counts and global search (staff rework, section 2). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { QUEUE_KINDS } from "@/domain/queue";

const server = () => import("@/server/api");

export const getStaffShell = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staffShell } = await server();
  return run((db, ctx) => staffShell.staffShell(db, ctx));
});

export const setDensity = createServerFn({ method: "POST" })
  .validator(z.object({ density: z.enum(["comfortable", "compact"]) }))
  .handler(async ({ data }) => {
    const { run, staffShell } = await server();
    return run((db, ctx) => staffShell.setDensity(db, ctx, data.density));
  });

export const saveQueueView = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(40), search: z.record(z.string(), z.string().max(100)) }))
  .handler(async ({ data }) => {
    const { run, staffShell } = await server();
    return run((db, ctx) => staffShell.saveQueueView(db, ctx, data));
  });

export const deleteQueueView = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(40) }))
  .handler(async ({ data }) => {
    const { run, staffShell } = await server();
    return run((db, ctx) => staffShell.deleteQueueView(db, ctx, data.name));
  });

export const staffSearch = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().max(80) }))
  .handler(async ({ data }) => {
    const { run, staffShell, accessLog } = await server();
    return run((db, ctx) =>
      accessLog.loggedList(db, ctx, "staff_search", () => staffShell.staffSearch(db, ctx, data.q)),
    );
  });

/* ---------------- queue: detail panel and bulk actions (staff rework, section 3) ---------------- */

export const getQueueDetail = createServerFn({ method: "GET" })
  .validator(
    z.object({
      kind: z.enum(QUEUE_KINDS),
      subjectId: z.string().max(100).nullable(),
      householdId: z.string().max(100),
      key: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, queueDetail, accessLog } = await server();
    return run((db, ctx) =>
      accessLog.loggedRead(
        db,
        ctx,
        "queue_detail",
        () => queueDetail.queueDetail(db, ctx, data),
        () => data.householdId,
      ),
    );
  });

export const bulkEscalations = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ids: z.array(z.string().max(100)).min(1).max(50),
      action: z.enum(["take", "assign"]),
      toActorId: z.string().max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.bulkEscalations(db, ctx, data));
  });

export const getAssignableOwners = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staff } = await server();
  return run((db, ctx) => staff.assignableOwners(db, ctx));
});

/** The care-team first-time guide: what to show this person (tour offer and checklist). */
export const getGuide = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staffGuide } = await server();
  return run((db, ctx) => staffGuide.guideState(db, ctx));
});

/** Finished or skipped the tour, or hid the checklist: this person's own preference. */
export const updateGuide = createServerFn({ method: "POST" })
  .validator(
    z.object({
      tourDone: z.boolean().optional(),
      dismissWelcome: z.boolean().optional(),
      hideChecklist: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, staffGuide } = await server();
    return run((db, ctx) => staffGuide.updateGuide(db, ctx, data));
  });

/* ------------------------------------------------------------------ exceptions (decision 58) */

const key = z.object({ key: z.string().min(1).max(200) });

export const takeException = createServerFn({ method: "POST" })
  .validator(key)
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.takeException(db, ctx, data.key));
  });

export const assignException = createServerFn({ method: "POST" })
  .validator(key.extend({ toActorId: z.string().min(1).max(100), reason: z.string().max(280).optional() }))
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.assignException(db, ctx, data));
  });

export const bulkAssignExceptions = createServerFn({ method: "POST" })
  .validator(
    z.object({
      keys: z.array(z.string().min(1).max(200)).min(1).max(50),
      toActorId: z.string().min(1).max(100),
      reason: z.string().max(280),
    }),
  )
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.bulkAssignExceptions(db, ctx, data));
  });

export const markExceptionWaiting = createServerFn({ method: "POST" })
  .validator(key.extend({ on: z.enum(["family", "partner", "staff"]), note: z.string().max(140).optional() }))
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.markWaiting(db, ctx, data));
  });

export const releaseException = createServerFn({ method: "POST" })
  .validator(key)
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.releaseException(db, ctx, data.key));
  });

export const dismissException = createServerFn({ method: "POST" })
  .validator(key.extend({ reason: z.string().max(280) }))
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.dismissException(db, ctx, data));
  });

export const recordReachedByPhone = createServerFn({ method: "POST" })
  .validator(z.object({ updateId: z.string().min(1).max(100), personActorId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, exceptions } = await server();
    return run((db, ctx) => exceptions.reachedByPhone(db, ctx, data));
  });

export const getResolvedExceptions = createServerFn({ method: "GET" }).handler(async () => {
  const { run, exceptions, accessLog } = await server();
  return run((db, ctx) =>
    accessLog.loggedList(db, ctx, "resolved_exceptions", () => exceptions.resolvedExceptions(db, ctx)),
  );
});

/* ------------------------------------------------------------------ coverage and handoffs (decisions 59–61) */

const when = z.string().datetime();

export const getCoverageBoard = createServerFn({ method: "GET" }).handler(async () => {
  const { run, coverage, accessLog } = await server();
  return run((db, ctx) =>
    accessLog.loggedList(db, ctx, "coverage_board", () => coverage.coverageBoard(db, ctx)),
  );
});

export const recordAbsence = createServerFn({ method: "POST" })
  .validator(
    z.object({
      actorId: z.string().min(1).max(100),
      startsAt: when,
      endsAt: when,
      reason: z.string().max(200),
    }),
  )
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) =>
      coverage.recordAbsence(db, ctx, {
        ...data,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
      }),
    );
  });

export const cancelAbsence = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) => coverage.cancelAbsence(db, ctx, data.id));
  });

export const offerCover = createServerFn({ method: "POST" })
  .validator(
    z.object({
      absenceId: z.string().min(1).max(100),
      householdId: z.string().min(1).max(100),
      toActorId: z.string().min(1).max(100),
      note: z.string().max(500),
      prepared: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) => coverage.offerCover(db, ctx, data));
  });

export const offerTransfer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      householdId: z.string().min(1).max(100),
      fromActorId: z.string().min(1).max(100),
      toActorId: z.string().min(1).max(100),
      note: z.string().max(500),
    }),
  )
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) => coverage.offerTransfer(db, ctx, data));
  });

export const withdrawHandoff = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) => coverage.withdrawHandoff(db, ctx, data.id));
  });

export const getMyHandoffs = createServerFn({ method: "GET" }).handler(async () => {
  const { run, coverage, accessLog } = await server();
  return run((db, ctx) => accessLog.loggedList(db, ctx, "my_handoffs", () => coverage.myHandoffs(db, ctx)));
});

export const acceptHandoff = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) => coverage.acceptHandoff(db, ctx, data.id));
  });

export const declineHandoff = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100), reason: z.string().max(280) }))
  .handler(async ({ data }) => {
    const { run, coverage } = await server();
    return run((db, ctx) => coverage.declineHandoff(db, ctx, { handoffId: data.id, reason: data.reason }));
  });

/* ------------------------------------------------------------------ prepared content (decision 58, workstream 5) */

export const getCatchMeUp = createServerFn({ method: "POST" })
  .validator(z.object({ householdId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, prepared } = await server();
    return run((db, ctx) => prepared.catchMeUp(db, ctx, data.householdId));
  });

export const getPreparedDrafts = createServerFn({ method: "GET" })
  .validator(z.object({ householdId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, prepared, accessLog } = await server();
    return run((db, ctx) =>
      accessLog.loggedRead(
        db,
        ctx,
        "prepared_drafts",
        () => prepared.preparedDrafts(db, ctx, data.householdId),
        () => data.householdId,
      ),
    );
  });
