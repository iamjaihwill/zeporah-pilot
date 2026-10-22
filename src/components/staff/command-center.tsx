/**
 * The role home's widgets (decision 58, workstream 4): a number that opens the list behind it, and
 * the three oldest items, each opening that item. Read-only: nothing is done from here.
 */
import { Link } from "@tanstack/react-router";
import { cx, stamp } from "@/lib/client";

type Item = {
  id: string;
  label: string;
  household: string;
  since: Date;
  age: string;
  endsAt?: Date | null;
  link: string;
};
export type HomeWidget = {
  key: string;
  title: string;
  count: number;
  countLabel: string;
  link: { to: string; search?: Record<string, string> };
  items: Item[];
  empty: string;
  note?: string;
};

export function WidgetGrid({ widgets, label }: { widgets: HomeWidget[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="command-center">
      {widgets.map((w) => (
        <li key={w.key}>
          <Widget w={w} />
        </li>
      ))}
    </ul>
  );
}

function Widget({ w }: { w: HomeWidget }) {
  const titleId = `w-${w.key}`;
  return (
    <section
      aria-labelledby={titleId}
      data-widget={w.key}
      className={cx(
        "flex h-full flex-col rounded-[var(--s-radius)] border px-4 py-3",
        w.count === 0 ? "bg-transparent" : "bg-surface",
      )}
    >
      <h2 id={titleId} className="text-[0.875rem] font-semibold">
        {w.title}
      </h2>
      <Link
        {...(w.link as { to: "/staff" })}
        aria-label={`${w.countLabel}: open the list`}
        title={w.countLabel}
        className={cx(
          "mt-1 inline-block self-start text-[2rem] leading-none font-semibold tracking-tight hover:underline",
          w.count === 0 && "text-ink-soft",
        )}
      >
        {w.count}
      </Link>
      {w.note && <p className="mt-1 text-[0.75rem] text-ink-soft">{w.note}</p>}
      {w.count === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-ink-soft">{w.empty}</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-[0.8125rem]">
          {w.items.map((i) => (
            <li key={i.id} className="min-w-0">
              <a href={i.link} className="block truncate font-medium text-ink hover:underline">
                {i.label}
              </a>
              <span className="block truncate text-[0.75rem] text-ink-soft">
                {i.household}
                {i.endsAt
                  ? ` · ends ${stamp(i.endsAt)}`
                  : i.age
                    ? ` · open for ${i.age}`
                    : ` · ${stamp(i.since)}`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {w.count > w.items.length && (
        <Link {...(w.link as { to: "/staff" })} className="mt-auto pt-2 text-[0.75rem] text-harbor underline">
          See all {w.count}
          <span className="sr-only">: {w.title}</span>
        </Link>
      )}
    </section>
  );
}
