const required = ["EXA_API_KEY", "DEV_RADAR_INGEST_URL", "DEV_RADAR_INGEST_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing GitHub secret(s): ${missing.join(", ")}`);

const dateParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
};
const asIndiaIso = (date) => {
  const { year, month, day } = dateParts(date);
  return `${year}-${month}-${day}`;
};
const today = new Date();
const todayIso = asIndiaIso(today);
const end = new Date(today);
end.setDate(end.getDate() + 60);
const endIso = asIndiaIso(end);

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
          organizer: { type: "string" },
          city: { type: "string" },
          eventDate: { type: "string", description: "Exact event start date as YYYY-MM-DD" },
          focus: { type: "string" },
          registrationUrl: { type: "string" },
          sourceUrl: { type: "string" },
          factsVerified: { type: "boolean" },
          summary: { type: "string", description: "Only source-stated details: venue, cost, prize, team size, eligibility, deadline, duration, and a concise event description. Leave unknown details out." },
        },
        required: ["title", "organizer", "city", "eventDate", "focus", "registrationUrl", "sourceUrl", "factsVerified", "summary"],
      },
    },
  },
  required: ["events"],
};

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const validUrl = (value) => { try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; } };
const clean = (value, maximum = 240) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const kinds = new Set(["Hackathon", "Workshop", "Competition", "Summit", "Program"]);
const modes = new Set(["In person", "Online", "Hybrid"]);

function normalizedMode(value) {
  const lower = clean(value).toLowerCase();
  if (lower.includes("hybrid")) return "Hybrid";
  if (lower.includes("online") || lower.includes("virtual")) return "Online";
  return "In person";
}

function sourceName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Official source"; }
}

function normalise(raw) {
  const eventDate = clean(raw.eventDate, 10);
  const registrationUrl = clean(raw.registrationUrl, 300);
  const sourceUrl = clean(raw.sourceUrl, 300);
  const summary = clean(raw.summary, 1000);
  const event = {
    title: clean(raw.title, 100),
    kind: kinds.has(clean(raw.kind, 30)) ? clean(raw.kind, 30) : "Competition",
    organizer: clean(raw.organizer, 100),
    city: clean(raw.city, 80),
    venue: "See official source",
    eventDate,
    eventTime: "",
    deadline: "",
    mode: modes.has(clean(raw.mode, 30)) ? clean(raw.mode, 30) : normalizedMode(raw.mode),
    price: "See official registration page",
    prize: "Not listed",
    team: "See official registration page",
    eligibility: "See official registration page",
    focus: clean(raw.focus, 80),
    duration: "See official schedule",
    description: summary,
    details: summary ? [summary] : [],
    tags: [clean(raw.focus, 40), "Verified"].filter(Boolean),
    registrationUrl,
    sourceUrl,
    sourceName: sourceName(sourceUrl),
    sourceType: "primary",
    verificationStatus: "approved",
  };
  const hasRequired = event.title && event.organizer && event.city && event.focus && event.description && event.sourceName;
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
      systemPrompt: `Return only events that have an official organizer or reputable event-platform page. Do not infer or guess any field. An event can have factsVerified=true only when its exact event date, location/city, organizer, and registration URL are explicitly present in its linked source. Keep unknown details out of the summary. Search window: ${todayIso} through ${endIso}.`,
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
