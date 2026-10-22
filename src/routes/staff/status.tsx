import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getSystemStatus } from "@/functions/staff";
import { announce, cx, isDenied, stamp, unwrap } from "@/lib/client";
import { Button, Card, DeniedView, Notice, Stamp } from "@/components/ui";

/**
 * System status for operations: configuration, schema, audit integrity and sign-in health, with a
 * one-line verdict. Read-only; nothing here contacts another system.
 */
export const Route = createFileRoute("/staff/status")({
  loader: async () => unwrap(await getSystemStatus()),
  component: Status,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

type Tone = "ok" | "attention" | "info";
const MARK: Record<Tone, { icon: string; label: string; cls: string }> = {
  ok: { icon: "✓", label: "OK", cls: "text-moss" },
  attention: { icon: "!", label: "Needs attention", cls: "text-rose font-bold" },
  info: { icon: "—", label: "For information", cls: "text-ink-soft" },
};

/** One row: a status mark, the label (and a hint), and the value. */
function Row({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint?: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  const m = MARK[tone];
  return (
    <div className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-x-2 py-2" data-tone={tone}>
      <span className={cx("text-center", m.cls)} aria-hidden>
        {m.icon}
      </span>
      <dt>
        <span className="text-ink">{label}</span>
        <span className="sr-only"> ({m.label})</span>
        {hint && <span className="block text-[0.75rem] text-ink-soft">{hint}</span>}
      </dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Status() {
  const d = Route.useLoaderData();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  if (isDenied(d)) return <DeniedView d={d} />;
  const upToDate = d.database.migrationsApplied === d.database.migrationsAvailable;
  // What counts as a problem: anything that stops the app working as it should.
  const problems = [
    !upToDate && "the database schema isn't up to date",
    !d.audit.ok && "the audit chain didn't verify",
    d.environment.readOnly && "read-only mode is on",
  ].filter((x): x is string => !!x);
  const recheck = async () => {
    setChecking(true);
    await router.invalidate();
    setChecking(false);
    announce("Checked again.");
  };
  // Plain facts for a support request: no names, households or records.
  const summary = [
    `Zeporah ${d.version} (${d.environment.name})`,
    `Schema: ${d.database.migrationsApplied ?? "?"} of ${d.database.migrationsAvailable} migrations`,
    `Audit chain: ${d.audit.ok ? `verified, ${d.audit.events} events` : "did not verify"}`,
    `Read-only mode: ${d.environment.readOnly ? "on" : "off"}`,
    `Checked: ${stamp(d.checkedAt)}`,
  ].join("\n");
  return (
    <>
      <StaffPageHeader
        title="System status"
        actions={
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={checking} onClick={() => void recheck()}>
              {checking ? "Checking…" : "Check again"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summary);
                  announce("Copied. Paste it into your support request.");
                } catch {
                  announce("Couldn't copy. Select the details below instead.", "problem");
                }
              }}
            >
              Copy for support
            </Button>
          </span>
        }
      />
      {/* The verdict first: a problem stands out without reading every row. */}
      <div className="mb-4" data-testid="status-verdict">
        {problems.length === 0 ? (
          <Notice tone="harbor" title="All checks passed">
            Checked <Stamp at={d.checkedAt} full />.
          </Notice>
        ) : (
          <Notice
            tone="rose"
            title={
              problems.length === 1 ? "1 thing needs attention" : `${problems.length} things need attention`
            }
          >
            {problems.join("; ").replace(/^./, (c) => c.toUpperCase())}. Checked{" "}
            <Stamp at={d.checkedAt} full />.
            {d.environment.readOnly &&
              " Read-only mode refuses every change until the server restarts without ZEPORAH_READ_ONLY (see the operations runbook)."}
          </Notice>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Environment">
          <dl className="divide-y text-sm">
            <Row label="Environment" tone="info">
              {d.environment.name === d.environment.mode
                ? d.environment.name
                : `${d.environment.name} (${d.environment.mode})`}
            </Row>
            <Row label="Version" tone="info">
              {d.version}
            </Row>
            <Row
              label="Development persona sign-in"
              hint="One-click sign-in as the synthetic people, for review. Never on in production."
              tone="info"
            >
              {d.environment.devSignIn ? "On (development only)" : "Off"}
            </Row>
            <Row
              label="Read-only mode"
              hint="Refuses every change, for maintenance."
              tone={d.environment.readOnly ? "attention" : "ok"}
            >
              {d.environment.readOnly ? "On" : "Off"}
            </Row>
            <Row label="Email" hint="Notices with fixed wording; never message content." tone="info">
              {d.email === "dev_mailbox" ? "Development mailbox only. Nothing leaves this computer." : "Off"}
            </Row>
            <Row label="Backups" hint="Set up before any real information is stored." tone="info">
              Not set up (development only)
            </Row>
          </dl>
        </Card>
        <Card title="Data and access">
          <dl className="divide-y text-sm">
            <Row label="Database" tone="info">
              {d.database.kind}
            </Row>
            <Row label="Schema" tone={upToDate ? "ok" : "attention"}>
              {d.database.migrationsApplied === null
                ? "Couldn't check"
                : upToDate
                  ? `Up to date (${d.database.migrationsApplied} migrations)`
                  : `${d.database.migrationsApplied} of ${d.database.migrationsAvailable} migrations applied`}
            </Row>
            <Row label="Audit chain" tone={d.audit.ok ? "ok" : "attention"}>
              <Link to="/staff/audit" className="text-harbor underline-offset-2 hover:underline">
                {d.audit.ok
                  ? `Verified (${d.audit.events} events)`
                  : "Didn't verify — report to the security lead"}
              </Link>
            </Row>
            <Row
              label="Sign-ins, last 24 hours"
              hint="Failed attempts, and sign-ins paused after too many."
              tone="info"
            >
              <Link
                to="/staff/audit"
                search={{ category: "access", days: 1 }}
                className="text-harbor underline-offset-2 hover:underline"
              >
                {d.signIns.failed} failed · {d.signIns.paused} paused
              </Link>
            </Row>
            <Row label="Signed in now" tone="info">
              {d.activeSessions === 1 ? "1 session" : `${d.activeSessions} sessions`}
            </Row>
          </dl>
        </Card>
      </div>
      <div className="mt-4">
        <Card title="Integrations">
          <ul className="divide-y text-sm">
            {d.integrations.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="text-ink">{i.label}</span>
                  <span className="block text-[0.75rem] text-ink-soft">{i.purpose}</span>
                </span>
                <span className="rounded-full border bg-sunk px-2 text-[0.75rem] font-semibold text-ink-soft">
                  Not connected
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-soft">
            Nothing here contacts another system. Connecting one is a production step that needs approval.
          </p>
        </Card>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        This is a synthetic pilot prototype for internal review only. It isn't a production system and makes
        no security or compliance claim.
      </p>
    </>
  );
}
