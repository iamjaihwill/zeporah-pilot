import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/lib/client";
import { Skeleton } from "./page";

export type SortDir = "asc" | "desc";
export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sortable by this key. */
  sort?: string;
  className?: string;
  /** Hide on narrower screens (less important columns). */
  hideBelow?: "md" | "lg" | "xl";
  /** This column's cell holds the row's open button (default: the first column). */
  opens?: boolean;
};

const HIDE = { md: "max-md:hidden", lg: "max-lg:hidden", xl: "max-xl:hidden" } as const;

/**
 * The staff table (staff rework, section 1): sticky header, sortable columns (aria-sort), optional
 * row selection, row hover actions, an active row (shown in a detail panel), and empty and loading
 * states. Row height follows the density setting. Scrolls inside its own box, never the page.
 *
 * Keyboard: each row's first cell (or the column marked `opens`) holds a real button that opens it, so the table works without a
 * mouse; clicking anywhere else on a row does the same for pointer users.
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  caption,
  sort,
  onSort,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  activeId,
  onActivate,
  openLabel,
  rowActions,
  empty,
  loading,
  className,
  maxHeight,
  selectAllLabel = "Select all that can be selected",
}: {
  rows: T[];
  columns: Column<T>[];
  caption: string;
  sort?: { key: string; dir: SortDir } | undefined;
  onSort?: (key: string) => void;
  selectable?: (row: T) => boolean;
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: (ids: string[], on: boolean) => void;
  activeId?: string | null | undefined;
  onActivate?: (row: T) => void;
  /** The accessible name for opening a row, e.g. (r) => `Open ${r.title}`. */
  openLabel?: (row: T) => string;
  rowActions?: ((row: T) => ReactNode) | undefined;
  empty?: ReactNode;
  loading?: boolean;
  className?: string;
  maxHeight?: string;
  /** The select-all checkbox's name, saying which rows it selects. */
  selectAllLabel?: string;
}) {
  const activeRef = useRef<HTMLTableRowElement>(null);
  // A scrolling table fades its bottom edge while more rows are below, so a cut-off row reads as "more".
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !maxHeight) return;
    const update = () => {
      el.dataset["moreBelow"] = String(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [maxHeight, rows.length]);
  // Keep the active row in view when it changes (keyboard J/K).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const opensAt = Math.max(
    0,
    columns.findIndex((c) => c.opens),
  );
  const selectableIds = selectable ? rows.filter(selectable).map((r) => r.id) : [];
  const allOn = selectableIds.length > 0 && selectableIds.every((id) => selected?.has(id));
  if (loading) return <Skeleton rows={8} />;
  return (
    <div
      ref={boxRef}
      data-scroll-fade-y={maxHeight ? "" : undefined}
      className={cx("relative overflow-auto rounded-[var(--s-radius)] border bg-surface", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-separate border-spacing-0 text-left text-[0.8125rem]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-sunk text-[0.75rem] text-ink-soft">
          <tr>
            {selectable && (
              <th scope="col" className="w-10 border-b px-2">
                {/* 24px, so adjacent checkboxes meet the minimum target size. */}
                <input
                  type="checkbox"
                  className="h-[24px] w-[24px] align-middle"
                  aria-label={selectAllLabel}
                  title={selectAllLabel}
                  checked={allOn}
                  disabled={!selectableIds.length}
                  onChange={(e) => onToggleAll?.(selectableIds, e.target.checked)}
                />
              </th>
            )}
            {columns.map((c) => {
              const active = sort?.key === c.sort;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    c.sort
                      ? active
                        ? sort!.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  className={cx(
                    "h-8 border-b px-2.5 font-semibold whitespace-nowrap",
                    c.hideBelow && HIDE[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.sort && onSort ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-ink"
                      onClick={() => onSort(c.sort!)}
                    >
                      {c.header}
                      <span aria-hidden>{active ? (sort!.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {rowActions && (
              <th scope="col" className="border-b px-2">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                className="px-4 py-8 text-center text-ink-soft"
              >
                {empty ?? "Nothing here."}
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const isActive = r.id === activeId;
              return (
                <tr
                  key={r.id}
                  ref={isActive ? activeRef : undefined}
                  data-row-id={r.id}
                  aria-selected={onActivate ? isActive : undefined}
                  onClick={(e) => {
                    if (!onActivate) return;
                    // Clicks on the row's own controls do their own thing.
                    if ((e.target as HTMLElement).closest("button, a, input, select, label")) return;
                    onActivate(r);
                  }}
                  className={cx(
                    "group h-[var(--s-row)] align-middle",
                    onActivate && "cursor-pointer",
                    isActive ? "bg-harbor-soft" : "hover:bg-sunk/70",
                  )}
                >
                  {selectable && (
                    <td className="border-b px-2">
                      {selectable(r) && (
                        <input
                          type="checkbox"
                          className="h-[24px] w-[24px] align-middle"
                          aria-label={`Select ${openLabel ? openLabel(r).replace(/^Open /, "") : r.id}`}
                          checked={selected?.has(r.id) ?? false}
                          onChange={() => onToggle?.(r.id)}
                        />
                      )}
                    </td>
                  )}
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx("border-b px-2.5 py-1", c.hideBelow && HIDE[c.hideBelow], c.className)}
                    >
                      {i === opensAt && onActivate ? (
                        <button
                          type="button"
                          data-row-action
                          className="w-full text-left"
                          aria-label={openLabel?.(r)}
                          aria-current={isActive ? "true" : undefined}
                          onClick={() => onActivate(r)}
                        >
                          {c.cell(r)}
                        </button>
                      ) : (
                        c.cell(r)
                      )}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="border-b px-2 text-right whitespace-nowrap">
                      {/* Visible on hover/focus with a mouse; always visible on touch screens. */}
                      <div className="flex justify-end gap-1 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                        {rowActions(r)}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
