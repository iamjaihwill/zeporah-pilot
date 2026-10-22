import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Escalations are one kind of exception now (decision 58). Old links — including the ones already
 * in people's notifications — open Exceptions filtered to escalations, with the same item selected.
 */
export const Route = createFileRoute("/staff/escalations")({
  validateSearch: z.object({ sel: z.string().max(100).optional(), tab: z.string().optional() }).catch({}),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/staff/exceptions",
      search: (search.tab === "resolved"
        ? { view: "resolved" }
        : {
            view: "all",
            kind: "escalation",
            ...(search.sel ? { sel: `escalation:${search.sel}` } : {}),
          }) as never,
      replace: true,
    });
  },
});
