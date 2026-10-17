import assert from "node:assert/strict";
import test from "node:test";
import { canonicalUrl, sourceMentionsDate, validDate, verifySource } from "../src/verify.mjs";

test("date validation rejects impossible days", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-11-14"), true);
});

test("source dates accept common official-page spellings", () => {
  assert.equal(sourceMentionsDate("November 14–15, 2026", "2026-11-14"), true);
  assert.equal(sourceMentionsDate("14 Nov 2026", "2026-11-14"), true);
  assert.equal(sourceMentionsDate("12 Dec 2026", "2026-11-14"), false);
});

test("a candidate cannot approve itself without a matching source page", () => {
  const sourceUrl = "https://example.org/hackathon";
  const candidate = { title: "Future AI Challenge", organizer: "Example Foundation", eventDate: "2026-11-14", sourceUrl, registrationUrl: sourceUrl };
  const source = { url: sourceUrl, title: "Future AI Challenge", text: "Example Foundation hosts Future AI Challenge on November 14, 2026. Registration is open to builders worldwide. Participants will create a working prototype, publish a demonstration and present the result to the judging team." };
  assert.equal(verifySource(candidate, source, new Set([canonicalUrl(sourceUrl)])), true);
  assert.equal(verifySource(candidate, { ...source, text: "Example Foundation hosts the challenge in December 2026. Registration is open to builders worldwide." }, new Set([canonicalUrl(sourceUrl)])), false);
  assert.equal(verifySource(candidate, source, new Set()), false);
});
