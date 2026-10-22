import { Link } from "@tanstack/react-router";
import { Notice, Stamp } from "@/components/ui";

export type Expectation = {
  version: number;
  handlingHours: string;
  expectation: string;
  fallback: string;
  replyTime: string;
  effectiveFrom: Date;
} | null;

/**
 * Shown when a hospice hasn't set an expected reply time (founder decision 24). It names no time:
 * Zeporah never supplies one.
 */
export const REPLY_TIME_UNSET = "Your care team reads messages during business hours.";

/** The one line about reply times: the hospice's own, or the fixed sentence plus the 24-hour line. */
export function ReplyTimeLine({
  e,
  line,
  className,
}: {
  e: Expectation;
  line: string | null;
  className?: string;
}) {
  const urgent = line
    ? `For anything urgent, call ${line}.`
    : "For anything urgent, call your hospice's 24-hour line.";
  return (
    <p className={className} data-testid="reply-time">
      {e?.replyTime ? `Your care team usually replies ${e.replyTime}.` : `${REPLY_TIME_UNSET} ${urgent}`}
    </p>
  );
}

/**
 * About replies to routine messages: the hospice's own wording and expected reply time when it has
 * set them; otherwise the fixed sentence above. Either way it ends with the 24-hour line.
 * `withReplyTime={false}` where the reply-time line is already shown (above the message box).
 */
export function ExpectationNote({
  e,
  line,
  withReplyTime = true,
}: {
  e: Expectation;
  line: string | null;
  withReplyTime?: boolean;
}) {
  if (!withReplyTime && !e) return null;
  return (
    <section
      aria-labelledby="expectation-title"
      className="rounded-xl border border-harbor/25 bg-harbor-soft px-4 py-3 text-[0.95rem]"
      data-testid="message-expectation"
    >
      <h2 id="expectation-title" className="font-sans text-base font-semibold">
        About replies to routine messages
      </h2>
      {withReplyTime && <ReplyTimeLine e={e} line={line} className="mt-1" />}
      {e && (
        <>
          <p className="mt-1">{e.expectation}</p>
          {e.handlingHours && <p className="mt-1 text-ink-soft">Messages are handled: {e.handlingHours}</p>}
          {e.fallback && <p className="mt-1 text-ink-soft">{e.fallback}</p>}
          <p className="mt-1 text-xs text-ink-soft">
            From your hospice · updated <Stamp at={e.effectiveFrom} full />
          </p>
        </>
      )}
    </section>
  );
}

/**
 * For hospice operations (decision 29b): until the hospice sets an expected reply time, families see
 * the fixed sentence above. `onSettings` drops the link when it's already the settings page.
 */
export function ReplyTimeMissing({ onSettings = false }: { onSettings?: boolean }) {
  return (
    <div className="mb-6" data-testid="reply-time-missing">
      <Notice tone="ochre" title="Required: set your expected reply time">
        Families are seeing “{REPLY_TIME_UNSET} For anything urgent, call your 24-hour line.” until your
        hospice sets its own reply time
        {onSettings ? (
          " below."
        ) : (
          <>
            {" "}
            in{" "}
            <Link to="/staff/settings" className="underline underline-offset-2">
              Hospice settings
            </Link>
            .
          </>
        )}
      </Notice>
    </div>
  );
}
