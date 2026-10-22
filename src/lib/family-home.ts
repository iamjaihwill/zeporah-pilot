import { getRouteApi } from "@tanstack/react-router";
import { isDenied } from "./client";

const parent = getRouteApi("/family");

/** The household dashboard data loaded by the /family layout (refreshed after every action). */
export function useHome() {
  const h = parent.useLoaderData();
  if (isDenied(h)) throw new Error("unreachable: the layout renders denials");
  return h;
}
