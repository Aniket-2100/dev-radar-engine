const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"].forEach((key) => url.searchParams.delete(key));
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return value; }
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function sourceMentionsDate(content, iso) {
  if (!validDate(iso)) return false;
  const [year, month, day] = iso.split("-");
  const name = months[Number(month) - 1];
  const short = name.slice(0, 3);
  const d = String(Number(day));
  const text = String(content).toLowerCase().replace(/\s+/g, " ");
  if (text.includes(iso)) return true;
  const monthName = `(?:${name}|${short}\\.?)`;
  return [
    new RegExp(`\\b${monthName}\\s+${d}(?:st|nd|rd|th)?(?:\\s*[-–]\\s*\\d{1,2})?\\s*,?\\s*${year}\\b`, "i"),
    new RegExp(`\\b${d}(?:st|nd|rd|th)?(?:\\s*[-–]\\s*\\d{1,2})?\\s+${monthName}\\s*,?\\s*${year}\\b`, "i"),
    new RegExp(`\\b${Number(month)}/${Number(day)}/${year}\\b`),
  ].some((pattern) => pattern.test(text));
}

function meaningfulWords(value) {
  return String(value).toLowerCase().match(/[a-z0-9]{4,}/g)?.filter((word) => !["2026", "2027", "hackathon", "competition", "internship", "global", "online", "student", "challenge"].includes(word)) || [];
}

export function verifySource(candidate, source, searchUrls) {
  const url = canonicalUrl(candidate.sourceUrl);
  const registrationUrl = canonicalUrl(candidate.registrationUrl);
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (["linkedin.com", "wikipedia.org", "coursera.org"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  if (!searchUrls.has(url) || canonicalUrl(source?.url || "") !== url) return false;
  const body = `${source?.title || ""} ${source?.text || ""} ${(source?.highlights || []).join(" ")}`;
  if (body.length < 160 || !sourceMentionsDate(body, candidate.eventDate)) return false;
  if (candidate.endDate && !sourceMentionsDate(body, candidate.endDate)) return false;
  if (candidate.deadline && !sourceMentionsDate(body, candidate.deadline)) return false;
  const lower = body.toLowerCase();
  const titleWords = meaningfulWords(candidate.title);
  if (!titleWords.length || titleWords.filter((word) => lower.includes(word)).length < Math.min(2, titleWords.length)) return false;
  const organizerWords = meaningfulWords(candidate.organizer);
  if (!organizerWords.some((word) => lower.includes(word))) return false;
  const sameHost = new URL(registrationUrl).hostname.replace(/^www\./, "") === host;
  const linked = lower.includes(registrationUrl.toLowerCase()) || (source?.extras?.links || []).some((link) => canonicalUrl(link) === registrationUrl);
  return sameHost || linked;
}
