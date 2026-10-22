import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IntegrationNotConnected, adapters, integrationStatus } from "@/server/integrations/registry";

/** Integration readiness without integration behaviour: contracts exist, nothing is connected, nothing calls out. */
const SRC = path.resolve(__dirname, "../../src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?)$/.test(f) && !f.endsWith(".gen.ts") ? [p] : [];
  });
const files = walk(SRC).map((f) => ({ f: path.relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("integration adapters", () => {
  it("are all not connected, and every call is refused", async () => {
    expect(integrationStatus().every((i) => i.connected === false)).toBe(true);
    await expect(adapters.ehr.fetchCensus({ tenantId: "t", organizationId: "o" })).rejects.toBeInstanceOf(
      IntegrationNotConnected,
    );
    await expect(adapters.identity.isActive({ tenantId: "t", subject: "s" })).rejects.toThrow(
      /isn't connected/,
    );
    await expect(
      adapters.messageDelivery.send({
        tenantId: "t",
        channel: "email",
        to: "x@example.invalid",
        title: "T",
        link: "/family",
      }),
    ).rejects.toBeInstanceOf(IntegrationNotConnected);
    await expect(
      adapters.partnerDelivery.requestStop({ tenantId: "t", packetId: "p", deliveryId: "d" }),
    ).rejects.toBeInstanceOf(IntegrationNotConnected);
  });

  it("aren't called from any service, route or function", () => {
    const users = files
      .filter(({ f }) => !f.startsWith("server/integrations/"))
      .filter(({ text }) => /\badapters\.(ehr|identity|messageDelivery|partnerDelivery)\b/.test(text))
      .map(({ f }) => f);
    expect(users).toEqual([]);
  });
});

describe("no outbound network calls", () => {
  it("nothing in the app opens a connection to another system", () => {
    const patterns: [string, RegExp][] = [
      ["fetch to a URL", /fetch\(\s*["'`]https?:/],
      ["http client modules", /from\s+["'](node:)?(http|https|net|tls|dgram)["']/],
      ["third-party http clients", /from\s+["'](axios|got|node-fetch|undici)["']/],
      ["browser network APIs", /new\s+(XMLHttpRequest|WebSocket|EventSource)\(/],
    ];
    const hits = files.flatMap(({ f, text }) =>
      patterns.filter(([, re]) => re.test(text)).map(([why]) => `${f}: ${why}`),
    );
    expect(hits).toEqual([]);
  });
});
