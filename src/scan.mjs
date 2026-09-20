const required = ["EXA_API_KEY", "DEV_RADAR_INGEST_URL", "DEV_RADAR_INGEST_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing GitHub secret(s): ${missing.join(", ")}`);

const today = new Date();
const todayIso = today.toISOString().slice(0, 10);
const end = new Date(today);
end.setDate(end.getDate() + 60);
const endIso = end.toISOString().slice(0, 10);

const queries = [
  `Official registration page for an upcoming hackathon, coding competition, developer workshop, AI or cloud event in Delhi NCR, Gurugram, Noida, Greater Noida, or New Delhi between ${todayIso} and ${endIso}. Include the exact date, venue and registration link.`,
  `Official registration page for an upcoming India-wide student technology competition, hackathon, robotics, esports, cloud, or open-source event between ${todayIso} and ${endIso}. Include exact date, city and registration link.`,
];

const eventSchema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string" },
          organizer: { type: "string" },
          city: { type: "string" },
          venue: { type: "string" },
          eventDate: { type: "string", description: "Exact event start date as YYYY-MM-DD" },
          eventTime: { type: "string" },
          deadline: { type: "string", description: "Exact registration deadline as YYYY-MM-DD or empty string if unavailable" },
          mode: { type: "string" },
          price: { type: "string" },
          prize: { type: "string" },
          team: { type: "string" },
          eligibility: { type: "string" },
          focus: { type: "string" },
          duration: { type: "string" },
          description: { type: "string" },
          details: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          registrationUrl: { type: "string" },
          sourceUrl: { type: "string" },
          sourceName: { type: "string" },
          factsVerified: { type: "boolean" },
        },
        required: ["title", "kind", "organizer", "city", "eventDate", "mode", "price", "team", "focus", "description", "registrationUrl", "sourceUrl", "sourceName", "factsVerified"],
      },
    },
  },
  required: ["events"],
};

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const validUrl = (value) => { try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; } };
const clean = (value, maximum = 240) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const list = (value) => Array.isArray(value) ? value.map((item) => clean(item, 180)).filter(Boolean).slice(0, 8) : [];
const kinds = new Set(["Hackathon", "Workshop", "Competition", "Summit", "Program"]);
const modes = new Set(["In person", "Online", "Hybrid"]);

function normalizedMode(value) {
  const lower = clean(value).toLowerCase();
  if (lower.includes("hybrid")) return "Hybrid";
  if (lower.includes("online") || lower.includes("virtual")) return "Online";
  return "In person";
}

function normalise(raw) {
  const eventDate = clean(raw.eventDate, 10);
  const registrationUrl = clean(raw.registrationUrl, 300);
  const sourceUrl = clean(raw.sourceUrl, 300);
  const kind = kinds.has(clean(raw.kind, 30)) ? clean(raw.kind, 30) : "Competition";
  const event = {
    title: clean(raw.title, 100),
    kind,
    organizer: clean(raw.organizer, 100),
    city: clean(raw.city, 80),
    venue: clean(raw.venue, 180) || "Venue to be confirmed",
    eventDate,
    eventTime: clean(raw.eventTime, 8),
    deadline: validDate(clean(raw.deadline, 10)) ? clean(raw.deadline, 10) : "",
    mode: modes.has(clean(raw.mode, 30)) ? clean(raw.mode, 30) : normalizedMode(raw.mode),
    price: clean(raw.price, 80),
    prize: clean(raw.prize, 100) || "Not listed",
    team: clean(raw.team, 80),
    eligibility: clean(raw.eligibility, 160) || "See official registration page",
    focus: clean(raw.focus, 80),
    duration: clean(raw.duration, 80) || "See official schedule",
    description: clean(raw.description, 1000),
    details: list(raw.details),
    tags: list(raw.tags),
    registrationUrl,
    sourceUrl,
    sourceName: clean(raw.sourceName, 100),
    sourceType: "primary",
    verificationStatus: "approved",
  };
  const hasRequired = event.title && event.organizer && event.city && event.price && event.team && event.focus && event.description && event.sourceName;
  if (!raw.factsVerified || !hasRequired || !validDate(eventDate) || eventDate < todayIso || eventDate > endIso || !validUrl(registrationUrl) || !validUrl(sourceUrl)) return null;
  return event;
}

function parseStructuredOutput(payload) {
  const output = payload?.output?.content ?? payload?.output ?? payload;
  if (typeof output === "string") {
    try { return JSON.parse(output); } catch { return { events: [] }; }
  }
  return output && typeof output === "object" ? output : { events: [] };
}

async function search(query) {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.EXA_API_KEY}` },
    body: JSON.stringify({
      query,
      type: "deep-lite",
      numResults: 10,
      userLocation: "IN",
      contents: { highlights: true },
      systemPrompt: `Return only events that have an official organizer or reputable event-platform page. Do not infer or guess any field. An event can have factsVerified=true only when its exact event date, location/city, organizer, and registration URL are explicitly present in its linked source. Keep unknown fields empty. Search window: ${todayIso} through ${endIso}.`,
      outputSchema: eventSchema,
    }),
  });
  if (!response.ok) throw new Error(`Exa search failed: ${response.status} ${await response.text()}`);
  return parseStructuredOutput(await response.json());
}

const outcomes = await Promise.all(queries.map(search));
const deduped = new Map();
for (const outcome of outcomes) {
  for (const raw of Array.isArray(outcome.events) ? outcome.events : []) {
    const event = normalise(raw);
    if (!event) continue;
    const key = `${event.registrationUrl.toLowerCase()}|${event.eventDate}`;
    deduped.set(key, event);
  }
}

const events = [...deduped.values()].slice(0, 50);
const response = await fetch(process.env.DEV_RADAR_INGEST_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.DEV_RADAR_INGEST_SECRET}`,
  },
  body: JSON.stringify({
    events,
    scan: {
      status: "success",
      sourcesChecked: queries.length,
      note: `Exa scan completed: ${events.length} source-backed upcoming event record(s) passed publication checks.`,
    },
  }),
});
if (!response.ok) throw new Error(`Dev Radar ingest failed: ${response.status} ${await response.text()}`);
console.log(JSON.stringify({ scannedAt: new Date().toISOString(), discovered: events.length, ingest: await response.json() }, null, 2));
