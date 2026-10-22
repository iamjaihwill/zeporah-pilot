import { useRef } from "react";

/**
 * Keep a list in the order it had when the page opened, even when an action re-sorts it on the
 * server (interaction review, item 5: a card mustn't jump from under the cursor or focus after
 * the person acts on it). New items go at the end; removed ones drop out. The fresh order applies
 * on the next page load or navigation, when the component mounts again.
 */
export function useStableOrder<T extends { id: string }>(items: readonly T[]): T[] {
  const order = useRef<string[] | null>(null);
  order.current ??= items.map((i) => i.id);
  for (const i of items) if (!order.current.includes(i.id)) order.current.push(i.id);
  const pos = new Map(order.current.map((id, n) => [id, n]));
  return [...items].sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
}
