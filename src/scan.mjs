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

const scanScope = (process.env.DEV_RADAR_SCAN_SCOPE || "india").trim().toLowerCase();
const sourceLanes = [
  {
    id: "ncr",
    query: `Official registration page for an upcoming hackathon, coding competition, developer workshop, AI or cloud event in Delhi NCR, Gurugram, Noida, Greater Noida, or New Delhi between ${todayIso} and ${endIso}. Include the exact date, venue and registration link.`,
  },
  {
    id: "india",
    query: `Official registration page for an upcoming India-wide student technology competition, hackathon, robotics, esports, cloud, or open-source event between ${todayIso} and ${endIso}. Include exact date, city and registration link.`,
  },
  {
    id: "global-programs",
    query: `Official application or registration page for an upcoming remote or international developer program, open-source mentorship, student technology competition, internship, fellowship, AI, cloud, cybersecurity, robotics, gaming, or coding opportunity open to applicants in India between ${todayIso} and ${endIso}. Include the exact deadline or event date, eligibility, organizer and application link.`,
  },
  {
    id: "global-hackathons",
    query: `Official registration page for an upcoming global or remote hackathon, developer challenge, cloud competition, data science competition, or student innovation competition between ${todayIso} and ${endIso}. Include the exact date or deadline, organizer, eligibility and registration link.`,
  },
];
const activeLanes = scanScope === "expanded" ? sourceLanes : sourceLanes.slice(0, 2);
const queries = activeLanes.map((lane) => lane.query);

const eventSchema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", description: "Hackathon, Workshop, Competition, Summit, or Program" },
          organizer: { type: "string" },
          city: { type: "string" },
          venue: { type: "string" },
          eventDate: { type: "string", description: "Exact event start date as YYYY-MM-DD" },
          eventTime: { type: "string" },
          deadline: { type: "string", description: "Exact application or registration deadline as YYYY-MM-DD when stated" },
          mode: { type: "string", description: "In person, Online, or Hybrid" },
          price: { type: "string" },
          prize: { type: "string" },
          team: { type: "string" },
          eligibility: { type: "string" },
          duration: { type: "string" },
          focus: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
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
const cleanList = (value, maximum = 8) => Array.isArray(value) ? value.map((item) => clean(item, 80)).filter(Boolean).slice(0, maximum) : [];
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

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"].forEach((key) => url.searchParams.delete(key));
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return value; }
}

function normalise(raw) {
  const eventDate = clean(raw.eventDate, 10);
  const registrationUrl = canonicalUrl(clean(raw.registrationUrl, 300));
  const sourceUrl = canonicalUrl(clean(raw.sourceUrl, 300));
  const summary = clean(raw.summary, 1000);
  const deadline = clean(raw.deadline, 10);
  const facts = [
    clean(raw.venue, 180) && `Venue: ${clean(raw.venue, 180)}`,
    deadline && `Deadline: ${deadline}`,
    clean(raw.team, 80) && `Team: ${clean(raw.team, 80)}`,
    clean(raw.eligibility, 160) && `Eligibility: ${clean(raw.eligibility, 160)}`,
    clean(raw.price, 80) && `Cost: ${clean(raw.price, 80)}`,
  ].filter(Boolean);
  const event = {
    title: clean(raw.title, 100),
    kind: kinds.has(clean(raw.kind, 30)) ? clean(raw.kind, 30) : "Competition",
    organizer: clean(raw.organizer, 100),
    city: clean(raw.city, 80),
    venue: clean(raw.venue, 180) || "See official source",
    eventDate,
    eventTime: clean(raw.eventTime, 8),
    deadline: validDate(deadline) ? deadline : "",
    mode: modes.has(clean(raw.mode, 30)) ? clean(raw.mode, 30) : normalizedMode(raw.mode),
    price: clean(raw.price, 80) || "See official registration page",
    prize: clean(raw.prize, 100) || "Not listed",
    team: clean(raw.team, 80) || "See official registration page",
    eligibility: clean(raw.eligibility, 160) || "See official registration page",
    focus: clean(raw.focus, 80),
    duration: clean(raw.duration, 80) || "See official schedule",
    description: summary,
    details: [...facts, ...(summary ? [summary] : [])].slice(0, 6),
    tags: [...new Set([...cleanList(raw.tags), clean(raw.focus, 40), "Verified scan"])].filter(Boolean).slice(0, 8),
    registrationUrl,
    sourceUrl,
    sourceName: sourceName(sourceUrl),
    sourceType: "primary",
    verificationStatus: "approved",
  };
  const hasRequired = event.title && event.organizer && event.city && event.focus && event.description && event.sourceName;
  if (!raw.factsVerified || !hasRequired || !validDate(eventDate) || eventDate < todayIso || eventDate > endIso || (deadline && !validDate(deadline)) || !validUrl(registrationUrl) || !validUrl(sourceUrl)) return null;
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
      systemPrompt: `Return only events that have an official organizer or reputable event-platform page. Do not infer or guess any field. An event can have factsVerified=true only when its exact event date, location/city, organizer, and registration URL are explicitly present in its linked source. Return kind, mode, venue, deadline, price, prize, team size, eligibility, duration and tags only when the linked source states them. Keep unknown values empty and keep the summary factual. Search window: ${todayIso} through ${endIso}.`,
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
      note: `Exa ${scanScope === "expanded" ? "expanded global" : "India"} scan completed: ${events.length} source-backed upcoming event record(s) passed publication checks across ${activeLanes.map((lane) => lane.id).join(", ")}.`,
    },
  }),
});
if (!response.ok) throw new Error(`Dev Radar ingest failed: ${response.status} ${await response.text()}`);
console.log(JSON.stringify({ scannedAt: new Date().toISOString(), discovered: events.length, ingest: await response.json() }, null, 2));
