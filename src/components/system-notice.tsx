import { useEffect, useState } from "react";
import { getSystemNotice } from "@/functions/session";

/**
 * A banner for everyone when the server is in read-only mode (an incident control; see
 * docs/operations-runbook.md). Checked once after the page loads; a mode change needs a restart.
 */
export function SystemNotice() {
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    getSystemNotice()
      .then((n) => setReadOnly(n.readOnly))
      .catch(() => setReadOnly(false));
  }, []);
  if (!readOnly) return null;
  return (
    <div
      role="status"
      className="border-b border-ochre/30 bg-ochre-soft px-4 py-2 text-center text-sm text-ink"
    >
      <strong>Zeporah is read-only right now.</strong> You can look at everything, but changes are paused
      while the team checks something. Nothing you've already done is affected.
    </div>
  );
}
