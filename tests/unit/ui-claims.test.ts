import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_STATUS_NOTE,
  OUT_OF_APP_NOTE,
  RELEASE_NOTE,
  RELEASE_NOTE_RECIPIENT,
  releaseNote,
  EMAIL_SETTINGS_NOTE,
  REVOCATION_NOTE,
  supportConfirmation,
} from "@/domain/claims";

/**
 * Static guard against interface text that overstates what Zeporah does.
 * Scans every screen, component and service (services write the audit summaries people read).
 */
const ROOT = path.resolve(__dirname, "../../src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
const files = [
  ...walk(path.join(ROOT, "routes")),
  ...walk(path.join(ROOT, "components")),
  ...walk(path.join(ROOT, "server/services")),
]
  .filter((f) => !f.endsWith("routeTree.gen.ts"))
  .map((f) => ({ f: path.relative(ROOT, f), text: readFileSync(f, "utf8") }));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const BANNED: [string, RegExp][] = [
  ["promises outreach", /will reach out|we('|’)ll (call|text|email|contact)|will (call|text|email) you/i],
  ["claims recipient contact", /recipient would be told|told to stop using|ask them to stop using/i],
  ["claims external delivery", /\bwas (sent|delivered) to\b|\bdelivered to the recipient/i],
  ["implies recall", /can('|’)t be recalled|cannot be recalled|can('|’)t be taken back/i],
  ["removed control", /pause suggestions/i],
  ["removed control", /simpler explanations/i],
  ["claims a legal decision", /legally (authorized|verified|valid)|verified legal/i],
];

describe("interface claims", () => {
  it("keeps the exact approved wording", () => {
    expect(RELEASE_NOTE).toBe("Released in Zeporah. Nothing was delivered outside Zeporah.");
    // Decision 48c: only where the named recipient was sent the sign-in alert.
    expect(RELEASE_NOTE_RECIPIENT).toBe(
      "Released in Zeporah. The recipient reads it in Zeporah; only a sign-in link was emailed, never the contents.",
    );
    expect(releaseNote(false)).toBe(RELEASE_NOTE);
    expect(releaseNote(true)).toBe(RELEASE_NOTE_RECIPIENT);
    expect(REVOCATION_NOTE).toBe(
      "Future access through Zeporah is revoked. Nothing is recalled, and no external recipient was contacted.",
    );
    // Founder decision 26 superseded decision 1's support wording.
    expect(supportConfirmation("555-0100")).toBe(
      "Your request was sent to your care team. A person will decide how to follow up. If it's urgent, call 555-0100.",
    );
    expect(supportConfirmation("555-0100", "within 1 business day")).toBe(
      "Your request was sent to your care team. A person will decide how to follow up. Your care team usually replies within 1 business day. If it's urgent, call 555-0100.",
    );
    // Decision 23: shown instead of OUT_OF_APP_NOTE only where an email channel exists.
    expect(EMAIL_SETTINGS_NOTE).toBe(
      "These apply to email notices, if you turn them on. Zeporah shows in-app notifications right away.",
    );
    expect(OUT_OF_APP_NOTE).toBe(
      "Saved for future out-of-app notifications. Zeporah shows in-app notifications right away.",
    );
    expect(AUTHORITY_STATUS_NOTE).toBe("This is a workflow status, not a legal determination.");
  });

  it("contains no overstated or removed claims anywhere in screens, components or audit summaries", () => {
    const hits = files.flatMap(({ f, text }) =>
      BANNED.filter(([, re]) => re.test(text)).map(([why]) => `${f}: ${why}`),
    );
    expect(hits).toEqual([]);
  });

  it("shows the exact wording where each effect happens", () => {
    const uses: [string, string[]][] = [
      // The release note comes from the server (decision 48c picks which one is true).
      ["routes/staff/packets/$packetId.tsx", ["REVOCATION_NOTE", "AUTHORITY_STATUS_NOTE"]],
      // The withdrawal dialog lives in the shared consent card (Sharing page and "Consents for you").
      ["components/consent-card.tsx", ["REVOCATION_NOTE"]],
      ["routes/staff/households/$householdId.tsx", ["REVOCATION_NOTE", "AUTHORITY_STATUS_NOTE"]],
      ["routes/family/support.tsx", ["supportConfirmation"]],
      ["routes/family/vault/index.tsx", ["AUTHORITY_STATUS_NOTE"]],
      ["components/forms.tsx", ["OUT_OF_APP_NOTE", "EMAIL_SETTINGS_NOTE"]],
      ["server/services/sharing.ts", ["releaseNote", "REVOCATION_NOTE", "AUTHORITY_STATUS_NOTE"]],
    ];
    for (const [file, names] of uses) {
      const text = read(file);
      for (const n of names)
        expect(
          text.includes(`{${n}}`) ||
            text.includes(`\${${n}}`) ||
            new RegExp(`[(,]\\s*${n}\\s*[,)]`).test(text) ||
            // Wording built by a function (decision 26: support confirmation with the hospice's line).
            new RegExp(`[{=(,]\\s*${n}\\(`).test(text) ||
            // Either side of a choice (decision 23: email wording only where email exists).
            new RegExp(`\\?\\s*${n}\\s*:|:\\s*${n}\\s*}`).test(text),
          `${file} uses ${n}`,
        ).toBe(true);
    }
  });

  it("never pastes a component into a template string, where it would print as raw text", () => {
    // e.g. `Last message from ${name}, $<Stamp at={t} />` renders the literal characters on screen.
    const hits = files.filter(({ f, text }) => f.endsWith(".tsx") && /\$<[A-Z]/.test(text)).map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it("shows absolute times only: no relative time that changes after the page loads", () => {
    const hits = files.filter(({ text }) => /<Ago\b|\bago\(/.test(text)).map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it("no longer offers the paused-suggestions or simpler-explanations settings", () => {
    expect(read("functions/family.ts")).not.toMatch(/recommendationsPaused|simplerExplanations/);
    expect(read("components/forms.tsx")).not.toMatch(/simplerExplanations/);
  });
});
