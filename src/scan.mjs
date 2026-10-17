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
const scanScope = (process.env.DEV_RADAR_SCAN_SCOPE || "india").trim().toLowerCase();
// India changes quickly, so keep that feed tight. Global programmes such as
// NASA challenges and fellowships are announced much further in advance.
const horizonDays = scanScope === "global" || scanScope === "expanded" ? 180 : 60;
const end = new Date(today);
end.setDate(end.getDate() + horizonDays);
const endIso = asIndiaIso(end);

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
    id: "global-internships",
    query: `Official employer careers or application page for a software engineering, AI, data, cybersecurity or developer internship accepting applications between ${todayIso} and ${endIso}. Include the exact application deadline where given, country restrictions, eligibility and application link. Search international and India-based employers, not generic internship roundups.`,
  },
  {
    id: "global-hackathons",
    query: `Official organizer or Devpost registration page for an international online hackathon, coding competition, developer challenge, cloud, data science, robotics or gaming event between ${todayIso} and ${endIso}. Include exact dates, organizer, eligibility and registration URL; exclude expired editions.`,
  },
  {
    id: "global-student",
    query: `Official organizer registration page for a global university or school student coding, AI, cybersecurity, open-source or research competition between ${todayIso} and ${endIso}. Include team size, registration deadline, exact event dates and official link.`,
  },
  {
    id: "global-space",
    query: `Official NASA, ESA, space agency or event organizer registration page for a space, astronomy, Earth observation, satellite or robotics hackathon or challenge between ${todayIso} and ${endIso}. Include exact event dates, eligibility and official registration link.`,
  },
];
const activeLanes = scanScope === "expanded"
  ? sourceLanes
  : scanScope === "global"
    ? sourceLanes.slice(2)
    : sourceLanes.slice(0, 2);
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
          eventDate: { type: "string", description: "Exact event start date as YYYY-MM-DD; for internships with no exact start, use the application deadline as this date and explain that in summary" },
          endDate: { type: "string", description: "Exact final day as YYYY-MM-DD if a multi-day event" },
          deadline: { type: "string", description: "Exact application or registration deadline as YYYY-MM-DD when stated" },
          registrationUrl: { type: "string" },
          sourceUrl: { type: "string" },
          summary: { type: "string", description: "Concise source-stated description including location restrictions, eligibility, venue, cost and team size only if stated. No guesses." },
        },
        required: ["title", "organizer", "city", "eventDate", "registrationUrl", "sourceUrl", "summary"],
      },
    },
  },
  required: ["events"],
};

const validUrl = (value) => { try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; } };
const clean = (value, maximum = 240) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const kinds = new Set(["Hackathon", "Workshop", "Competition", "Summit", "Program", "Fellowship", "Internship"]);

function normalizedMode(value) {
  const lower = clean(value).toLowerCase();
  if (lower.includes("hybrid")) return "Hybrid";
  if (lower.includes("online") || lower.includes("virtual")) return "Online";
  return "In person";
}

function sourceName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Official source"; }
}

function normalise(raw, lane, source, searchUrls) {
  const eventDate = clean(raw.eventDate, 10);
  const endDate = clean(raw.endDate, 10);
  const registrationUrl = canonicalUrl(clean(raw.registrationUrl, 300));
  const sourceUrl = canonicalUrl(clean(raw.sourceUrl, 300));
  const summary = clean(raw.summary, 1000);
  const deadline = clean(raw.deadline, 10);
  const kind = lane.id === "global-internships" ? "Internship" : /hackathon|hack/i.test(raw.title) ? "Hackathon" : /workshop/i.test(raw.title) ? "Workshop" : /summit/i.test(raw.title) ? "Summit" : "Competition";
  const mode = normalizedMode(`${raw.city} ${summary}`);
  const focus = lane.id === "global-space" ? "Space & astronomy" : lane.id === "global-internships" ? "Tech internship" : /robot/i.test(summary) ? "Robotics" : /cloud/i.test(summary) ? "Cloud" : /AI|machine learning/i.test(summary) ? "AI / ML" : "Technology";
  const expiry = kind === "Internship" ? deadline || eventDate : endDate || eventDate;
  const dateWithinHorizon = eventDate <= endIso || (deadline && deadline <= endIso);
  if (!raw.title || !raw.organizer || !raw.city || !summary || !validDate(eventDate) || (endDate && (!validDate(endDate) || endDate < eventDate)) || (deadline && (!validDate(deadline) || deadline < todayIso)) || expiry < todayIso || !dateWithinHorizon || !validUrl(registrationUrl) || !validUrl(sourceUrl)) return null;
  const verified = verifySource({ ...raw, eventDate, endDate, deadline, sourceUrl, registrationUrl }, source, searchUrls);
  const event = {
    title: clean(raw.title, 100),
    kind: kinds.has(kind) ? kind : "Competition",
    organizer: clean(raw.organizer, 100),
    city: clean(raw.city, 80),
    venue: mode === "Online" ? "Online · see official source" : "See official source for venue",
    eventDate,
    eventTime: "",
    deadline: validDate(deadline) ? deadline : "",
    mode,
    price: "See official registration page",
    prize: "Not listed",
    team: "See official rules",
    eligibility: "See official rules and location restrictions",
    focus,
    duration: endDate ? `${eventDate} to ${endDate}` : "See official schedule",
    description: summary,
    details: [summary, deadline ? `Registration deadline: ${deadline}` : "Check the official page for the current registration status."],
    tags: [focus, kind, lane.id.replaceAll("-", " ")],
    registrationUrl,
    sourceUrl,
    sourceName: sourceName(sourceUrl),
    sourceType: "source-backed",
    verificationStatus: verified ? "approved" : "pending",
    expiresAt: expiry,
  };
  return event;
}

function parseStructuredOutput(payload) {
  const output = payload?.output?.content ?? payload?.output ?? payload;
  if (typeof output === "string") {
    try { return JSON.parse(output); } catch { return { events: [] }; }
  }
  return output && typeof output === "object" ? output : { events: [] };
}

async function search(lane) {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY },
    body: JSON.stringify({
      query: lane.query,
      type: "deep-lite",
      numResults: 15,
      userLocation: "IN",
      contents: { highlights: true },
      systemPrompt: `Return only live opportunities supported by one official organizer, official careers, or organizer-controlled event-platform page among the search results. Do not invent URLs, dates or facts. eventDate must be the exact event start; if an internship has no exact start date but has a stated application deadline, use that deadline as eventDate and say so in summary. Include exact endDate and deadline only when stated. Summarize eligibility, location restrictions, mode, venue and cost only when stated on that page. Search window: ${todayIso} through ${endIso}.`,
      outputSchema: eventSchema,
    }),
  });
  if (!response.ok) throw new Error(`Exa search failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return { lane, candidates: parseStructuredOutput(payload).events || [], searchUrls: new Set((payload.results || []).map((result) => canonicalUrl(result.url))) };
}

async function fetchSources(urls) {
  const sourceMap = new Map();
  for (let index = 0; index < urls.length; index += 10) {
    const response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY },
      body: JSON.stringify({ urls: urls.slice(index, index + 10), text: true }),
    });
    if (!response.ok) throw new Error(`Exa source check failed: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    for (const result of payload.results || []) sourceMap.set(canonicalUrl(result.url), result);
  }
  return sourceMap;
}

const settled = await Promise.allSettled(activeLanes.map(search));
const outcomes = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
const failures = settled.filter((result) => result.status === "rejected").map((result) => String(result.reason?.message || result.reason));
if (!outcomes.length) throw new Error(`Every scan lane failed: ${failures.join(" | ")}`);
const sourceUrls = [...new Set(outcomes.flatMap((outcome) => outcome.candidates.map((candidate) => canonicalUrl(candidate.sourceUrl)).filter((url) => validUrl(url) && outcome.searchUrls.has(url))))].slice(0, 50);
const sources = await fetchSources(sourceUrls);
const deduped = new Map();
for (const outcome of outcomes) {
  for (const raw of Array.isArray(outcome.candidates) ? outcome.candidates : []) {
    const event = normalise(raw, outcome.lane, sources.get(canonicalUrl(raw.sourceUrl)), outcome.searchUrls);
    if (!event) continue;
    const key = `${event.registrationUrl.toLowerCase()}|${event.eventDate}`;
    if (!deduped.has(key) || event.verificationStatus === "approved") deduped.set(key, event);
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
      status: failures.length ? "error" : "success",
      sourcesChecked: outcomes.length,
      note: `Exa ${scanScope} scan: ${events.filter((event) => event.verificationStatus === "approved").length} verified, ${events.filter((event) => event.verificationStatus === "pending").length} pending across ${outcomes.map((outcome) => outcome.lane.id).join(", ")}; ${failures.length} lane failure(s).`,
    },
  }),
});
if (!response.ok) throw new Error(`Dev Radar ingest failed: ${response.status} ${await response.text()}`);
console.log(JSON.stringify({ scannedAt: new Date().toISOString(), discovered: events.length, ingest: await response.json() }, null, 2));
import { canonicalUrl, validDate, verifySource } from "./verify.mjs";

