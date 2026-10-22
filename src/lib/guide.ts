import { isDenied } from "@/lib/client";
import type { getGuide } from "@/functions/staff-shell";

type GuideResult = Awaited<ReturnType<typeof getGuide>>;
type Guide = Extract<GuideResult, { ok: true }> extends { data: infer D } ? D : never;

/**
 * Adds the first-time guide to a landing page's data (My work, Administration). If the guide can't
 * load, the page still does, without it.
 */
export function withGuide<T extends object>(page: T, guide: GuideResult): T & { guide: Guide | null } {
  if (isDenied(page as never)) return page as T & { guide: null };
  return { ...page, guide: guide.ok ? (guide as Extract<GuideResult, { ok: true }>).data : null };
}
