import assert from "node:assert/strict";
import test from "node:test";

test("scan fits Exa's schema limit, checks the source and ingests a verified event", async () => {
  process.env.EXA_API_KEY = "test-key";
  process.env.DEV_RADAR_INGEST_URL = "https://dev-radar.example/api/engine/ingest";
  process.env.DEV_RADAR_INGEST_SECRET = "test-ingest-key";
  process.env.DEV_RADAR_SCAN_SCOPE = "india";
  const eventDate = new Date(Date.now() + 14 * 86400000);
  const iso = eventDate.toISOString().slice(0, 10);
  const humanDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(eventDate);
  const url = "https://example.org/future-build";
  const candidate = { title: "Future Build Hackathon", organizer: "Example Foundation", city: "New Delhi", eventDate: iso, endDate: "", deadline: "", registrationUrl: url, sourceUrl: url, summary: "Example Foundation hosts a developer hackathon in New Delhi." };
  let ingested;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (requestUrl, options) => {
    if (requestUrl.endsWith("/search")) {
      const request = JSON.parse(options.body);
      const properties = Object.keys(request.outputSchema.properties.events.items.properties).length + Object.keys(request.outputSchema.properties).length;
      assert.ok(properties <= 10);
      return Response.json({ output: { content: JSON.stringify({ events: [candidate] }) }, results: [{ url }] });
    }
    if (requestUrl.endsWith("/contents")) return Response.json({ results: [{ url, title: candidate.title, text: `Example Foundation presents Future Build Hackathon in New Delhi on ${humanDate}. Registration is open to developers. Participants will build a useful prototype, share their code and show a working demo to the jury.` }] });
    ingested = JSON.parse(options.body);
    return Response.json({ received: ingested.events.length, approved: 1 });
  };
  try {
    await import(`../src/scan.mjs?test=${Date.now()}`);
    assert.equal(ingested.events.length, 1);
    assert.equal(ingested.events[0].verificationStatus, "approved");
    assert.equal(ingested.events[0].expiresAt, iso);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
