import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * The coordination queue became Exceptions (decision 58). Old links and saved bookmarks land on the
 * same view with the same filters; nothing is shown here.
 */
export const Route = createFileRoute("/staff/queue")({
  validateSearch: z.record(z.string(), z.string()).catch({}),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/staff/exceptions", search: search as never, replace: true });
  },
});
