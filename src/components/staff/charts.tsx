import { Link } from "@tanstack/react-router";
import { useId, useState, type ReactNode } from "react";

/**
 * Small single-series charts for Reports (staff rework, section 6), following the dataviz method:
 * one hue (Zeporah teal, contrast-checked against the surface), thin marks with 4px rounded data
 * ends, a hairline baseline, selective labels, a hover/focus tooltip on every mark, and a table
 * view so no value depends on hovering. Text uses text colors, never the series color.
 */
const ACCENT = "var(--color-harbor)";
const GRID = "var(--color-line)";

type Point = { label: string; value: number | null; detail?: string };

function fmt(v: number | null, unit?: string) {
  if (v === null) return "—";
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return unit ? `${n} ${unit}` : String(n);
}

function Tooltip({
  p,
  unit,
}: {
  p: { label: string; value: number | null; x: string; y: number };
  unit?: string | undefined;
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-surface px-2 py-1 text-[0.75rem] whitespace-nowrap shadow-md"
      style={{ left: p.x, top: p.y - 6 }}
    >
      <span className="block font-semibold text-ink">{fmt(p.value, unit)}</span>
      <span className="block text-ink-soft">{p.label}</span>
    </div>
  );
}

/**
 * One label per period under the plot, spread evenly; with many periods, every other one (the
 * table view and the tooltips still name each).
 */
function AxisLabels({ points, align = "slot" }: { points: Point[]; align?: "slot" | "edge" }) {
  const step = points.length > 8 ? 2 : 1;
  return (
    <div
      className="grid text-center text-[0.6875rem] text-ink-soft"
      style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {points.map((p, i) => (
        <span
          key={p.label}
          className={
            align === "edge" ? (i === 0 ? "text-left" : i === points.length - 1 ? "text-right" : "") : ""
          }
        >
          {i % step === 0 || i === points.length - 1 ? p.label : ""}
        </span>
      ))}
    </div>
  );
}

/** Nothing to plot: a sentence in place of an empty frame. */
function EmptyChart({ text }: { text: string }) {
  return <p className="py-6 text-[0.8125rem] text-ink-soft">{text}</p>;
}

function TableView({ title, points, unit }: { title: string; points: Point[]; unit?: string | undefined }) {
  return (
    <details className="mt-1 text-[0.75rem]">
      <summary className="cursor-pointer text-ink-soft">Show as a table</summary>
      <table className="mt-1 w-full text-left">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="text-ink-soft">
            <th scope="col" className="py-0.5 font-medium">
              Period
            </th>
            <th scope="col" className="py-0.5 text-right font-medium">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {points.map((p) => (
            <tr key={p.label} className="border-t">
              <td className="py-0.5">{p.label}</td>
              <td className="py-0.5 text-right">{fmt(p.value, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Columns over time (or categories). Each column is a focusable hit target with a tooltip. */
export function ColumnChart({
  title,
  points,
  unit,
  height = 140,
  empty,
}: {
  title: string;
  points: Point[];
  unit?: string;
  height?: number;
  /** Said instead of the chart when every period is empty. */
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 100 * Math.max(points.length, 1);
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  const slot = W / Math.max(points.length, 1);
  // Thin columns (about a third of each period's slot).
  const bw = Math.min(40, slot * 0.34);
  const top = 14;
  const h = height - 20;
  const y = (v: number) => top + (h - top) * (1 - v / max);
  if (empty && points.every((p) => !p.value)) return <EmptyChart text={empty} />;
  return (
    <figure aria-labelledby={id} className="relative">
      <figcaption id={id} className="sr-only">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        <line x1={0} x2={W} y1={h} y2={h} stroke={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const v = p.value ?? 0;
          const x = i * slot + (slot - bw) / 2;
          const yy = y(v);
          const r = Math.min(4 * 4, (h - yy) / 2);
          return (
            <g
              key={p.label}
              tabIndex={0}
              role="img"
              aria-label={`${p.label}: ${fmt(p.value, unit)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="chart-mark outline-none"
            >
              {/* Hit target: the whole slot, not just the painted bar. */}
              <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
              {/* The keyboard focus ring (styles.css, .chart-mark): the SVG group can't show an outline. */}
              <rect
                className="chart-mark-ring"
                x={i * slot + 1.5}
                y={1.5}
                width={slot - 3}
                height={h - 3}
                rx={4}
                fill="none"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
              {/* An empty period still shows, as a short mark on the baseline. */}
              {v === 0 && <rect x={x} y={h - 1.5} width={bw} height={1.5} fill="var(--color-line-strong)" />}
              {v > 0 && (
                <path
                  d={`M${x},${h} L${x},${yy + r} Q${x},${yy} ${x + r},${yy} L${x + bw - r},${yy} Q${x + bw},${yy} ${x + bw},${yy + r} L${x + bw},${h} Z`}
                  fill={ACCENT}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
            </g>
          );
        })}
      </svg>
      {/* Values on the columns (text colour, not the series colour), then each period's name. */}
      <div
        className="grid text-center text-[0.6875rem] font-semibold text-ink tabular-nums"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {points.map((p) => (
          <span key={p.label}>{fmt(p.value, unit)}</span>
        ))}
      </div>
      <AxisLabels points={points} />
      {hover !== null && points[hover] && (
        <Tooltip
          unit={unit}
          p={{
            label: points[hover]!.label,
            value: points[hover]!.value,
            x: `calc(${((hover + 0.5) / points.length) * 100}%)`,
            y: 0,
          }}
        />
      )}
      <TableView title={title} points={points} unit={unit} />
    </figure>
  );
}

/** Horizontal bars for a handful of categories, value at the tip. */
export function BarList({ title, points }: { title: string; points: Point[] }) {
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="space-y-1.5">
        {points.map((p) => (
          <li key={p.label} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-[0.8125rem]">
            <span className="truncate text-ink-soft">{p.label}</span>
            <span className="h-3" aria-hidden>
              <span
                className="block h-3 rounded-r-[4px]"
                style={{
                  width: `${((p.value ?? 0) / max) * 100}%`,
                  background: ACCENT,
                  minWidth: p.value ? 2 : 0,
                }}
              />
            </span>
            <span className="text-right font-semibold tabular-nums">{p.value ?? "—"}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A single-series line over time with a crosshair that snaps to the nearest period. */
export function LineChart({
  title,
  points,
  unit,
  height = 140,
  empty,
}: {
  title: string;
  points: Point[];
  unit?: string;
  height?: number;
  /** Said instead of the chart when no period has a value. */
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const h = height - 20;
  const top = 12;
  const vals = points.map((p) => p.value);
  const max = Math.max(1, ...vals.map((v) => v ?? 0));
  const x = (i: number) => (points.length <= 1 ? W / 2 : (i / (points.length - 1)) * (W - 16) + 8);
  const y = (v: number) => top + (h - top) * (1 - v / max);
  const segs: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur) segs.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i)},${y(p.value)} `;
  });
  if (cur) segs.push(cur);
  const last = [...points.keys()].reverse().find((i) => points[i]!.value !== null);
  if (empty && last === undefined) return <EmptyChart text={empty} />;
  return (
    <figure className="relative">
      <figcaption className="sr-only">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={title}
        tabIndex={0}
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          let best = 0;
          points.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(last ?? 0)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((hh) => Math.max(0, (hh ?? 0) - 1));
          if (e.key === "ArrowRight") setHover((hh) => Math.min(points.length - 1, (hh ?? 0) + 1));
        }}
      >
        <line x1={0} x2={W} y1={h} y2={h} stroke={GRID} strokeWidth={1} />
        {segs.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={h} stroke={GRID} strokeWidth={1} />}
        {last !== undefined && (
          <circle
            cx={x(last)}
            cy={y(points[last]!.value!)}
            r={4}
            fill={ACCENT}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        )}
        {hover !== null && points[hover]!.value !== null && (
          <circle
            cx={x(hover)}
            cy={y(points[hover]!.value!)}
            r={4}
            fill={ACCENT}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        )}
      </svg>
      <AxisLabels points={points} align="edge" />
      {last !== undefined && (
        <p className="text-right text-[0.6875rem] text-ink-soft">
          Latest ({points[last]!.label}):{" "}
          <span className="font-semibold text-ink">{fmt(points[last]!.value, unit)}</span>
        </p>
      )}
      {hover !== null && points[hover] && (
        <Tooltip
          unit={unit}
          p={{
            label: points[hover]!.label,
            value: points[hover]!.value,
            x: `calc(${(x(hover) / W) * 100}%)`,
            y: 0,
          }}
        />
      )}
      <TableView title={title} points={points} unit={unit} />
    </figure>
  );
}

/** Stat tile: value, and the change against the previous period, named. */
export function StatTile({
  label,
  value,
  previous,
  unit,
  upIsGood,
  days,
  link,
}: {
  label: string;
  value: number | null;
  previous: number | null;
  unit?: string;
  upIsGood: boolean | null;
  days: number;
  /** Where the number comes from (the list behind it), if there's a page for it. */
  link?: { to: string; search?: Record<string, string> } | undefined;
}) {
  const delta = value !== null && previous !== null ? value - previous : null;
  const good = delta === null || delta === 0 || upIsGood === null ? null : delta > 0 === upIsGood;
  const Wrap = ({ children }: { children: ReactNode }) =>
    link ? (
      <Link
        {...(link as { to: "/staff" })}
        className="block rounded-[var(--s-radius)] border bg-surface px-3 py-2 hover:border-harbor"
      >
        {children}
      </Link>
    ) : (
      <div className="rounded-[var(--s-radius)] border bg-surface px-3 py-2">{children}</div>
    );
  return (
    <Wrap>
      <p className="text-[0.875rem] font-medium text-ink">{label}</p>
      <p className="my-1 text-[2rem] leading-none font-semibold tracking-tight">{fmt(value, unit)}</p>
      <p className="text-[0.75rem] text-ink-soft">
        {delta === null ? (
          "No earlier period to compare"
        ) : (
          <>
            <span
              className={good === null ? "" : good ? "font-semibold text-moss" : "font-semibold text-rose"}
            >
              {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "■ "}
              {fmt(delta, unit)}
            </span>{" "}
            vs the previous {days} days
          </>
        )}
      </p>
    </Wrap>
  );
}
