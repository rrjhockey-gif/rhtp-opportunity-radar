// Daily data pull: hits grants.gov's free, public, keyless search API
// (https://www.grants.gov/api) for federal rural-health-relevant funding notices,
// auto-tags each one with rule-based keyword matching, and merges into
// site/data/opportunities.json - preserving any pipeline status a human has already
// set (New/Reviewing/Pursuing/Passed), since a re-scrape must never clobber that.
//
// Note: grants.gov only covers FEDERAL opportunities (HRSA/CMS/FCC/USDA/ONC/etc).
// State-level RHTP RFPs (issued by individual state health departments) aren't in
// this database - there's no single free source for those; they'd need per-state
// scraping added later if you want that coverage.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tagOpportunity } from "./tag.mjs";

const SEARCH_BASE = "https://api.grants.gov/v1/api/search2";
const DETAIL_BASE = "https://api.grants.gov/v1/api/fetchOpportunity";
const DETAIL_PAGE_BASE = "https://www.grants.gov/search-results-detail";

const SEARCH_QUERIES = [
  "rural health",
  "rural hospital",
  "rural telehealth",
  "critical access hospital",
  "rural health broadband",
  "rural health cybersecurity",
  "rural health data interoperability"
];

const OUT_PATH = new URL("../site/data/opportunities.json", import.meta.url);
const LOG_PATH = new URL("../site/data/scrub-log.json", import.meta.url);
const META_PATH = new URL("../site/data/meta.json", import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchOnce(keyword) {
  const res = await fetch(SEARCH_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, rows: 50, oppStatuses: "forecasted|posted" })
  });
  if (!res.ok) throw new Error(`search2 failed for "${keyword}": ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.data?.oppHits || [];
}

function isRelevant(hit) {
  const t = hit.title.toLowerCase();
  const hasHealthWord = /health|hospital|clinic|telehealth|medic/.test(t);
  const hasRuralWord = /rural/.test(t);
  const isHealthAgency = /^HHS/.test(hit.agencyCode || "");
  return (hasRuralWord && hasHealthWord) || (isHealthAgency && hasRuralWord);
}

async function collectCandidates() {
  const byId = new Map();
  for (const q of SEARCH_QUERIES) {
    const hits = await searchOnce(q);
    for (const h of hits) {
      if (isRelevant(h)) byId.set(h.id, h);
    }
    await sleep(200); // be a polite, low-volume caller of a free public service
  }
  return [...byId.values()];
}

async function fetchDetail(id) {
  const res = await fetch(DETAIL_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opportunityId: String(id) })
  });
  if (!res.ok) throw new Error(`fetchOpportunity failed for ${id}: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.data;
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function fmtDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtAward(min, max) {
  const n = (v) => Number(v) || 0;
  const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M` : v > 0 ? `$${Math.round(v / 1e3)}K` : null;
  const lo = fmt(n(min)), hi = fmt(n(max));
  if (!lo && !hi) return "Not specified";
  if (lo && hi && lo !== hi) return `${lo} - ${hi}`;
  return hi || lo;
}

function normalize(detail) {
  const isForecast = detail.docType === "forecast" || !detail.synopsis;
  const body = isForecast ? detail.forecast : detail.synopsis;
  const desc = stripHtml(isForecast ? body?.forecastDesc : body?.synopsisDesc);
  const applicantTypes = (body?.applicantTypes || []).map((t) => t.description);
  const deadline = fmtDate(body?.responseDate);
  const posted = fmtDate(body?.postingDate);

  let sourceStatus = "UPCOMING";
  if (!isForecast) {
    const days = body?.responseDate ? (new Date(body.responseDate) - Date.now()) / 864e5 : null;
    sourceStatus = days != null && days <= 14 && days >= 0 ? "CLOSING_SOON" : "OPEN";
  }

  const taggingInput = {
    title: detail.opportunityTitle,
    summary: desc,
    applicantTypes
  };
  const tags = tagOpportunity(taggingInput);

  return {
    id: String(detail.id),
    slug: detail.opportunityNumber,
    title: detail.opportunityTitle,
    agency: detail.agencyDetails?.agencyName || detail.owningAgencyCode || "Unknown agency",
    summary: desc || "No description provided by the source.",
    applicantTypes,
    award: fmtAward(body?.awardFloor, body?.awardCeiling ?? body?.estimatedFunding),
    deadline,
    released: posted,
    loiDate: null,
    questionDeadline: null,
    states: ["Nationwide"], // grants.gov is federal-only; federal NOFOs are generally nationwide-eligible
    sourceUrl: `${DETAIL_PAGE_BASE}/${detail.id}`,
    rcjStatus: sourceStatus,
    ...tags,
    status: "New"
  };
}

async function loadPrevious() {
  try { return JSON.parse(await readFile(OUT_PATH, "utf8")); } catch { return []; }
}
async function loadLog() {
  try { return JSON.parse(await readFile(LOG_PATH, "utf8")); } catch { return []; }
}

async function main() {
  const previous = await loadPrevious();
  const previousById = new Map(previous.map((o) => [o.id, o]));

  const candidates = await collectCandidates();
  console.log(`Found ${candidates.length} candidate opportunities after relevance filtering.`);

  const normalized = [];
  for (const c of candidates) {
    try {
      const detail = await fetchDetail(c.id);
      normalized.push(normalize(detail));
    } catch (err) {
      console.error(`Skipping ${c.id} (${c.title}): ${err.message}`);
    }
    await sleep(200);
  }

  const log = await loadLog();
  const now = new Date().toISOString();
  let newCount = 0;
  let changedCount = 0;
  const newHighFit = [];

  const merged = normalized.map((op) => {
    const prior = previousById.get(op.id);
    if (!prior) {
      newCount += 1;
      log.unshift({ icon: "found", text: `Scrub found 1 new release: "${op.title}" (${op.agency})`, time: now });
      if (op.awsFit === "high" || op.ingramFit === "high") newHighFit.push(op);
      return op;
    }
    const keepStatus = prior.status || op.status;
    if (prior.deadline !== op.deadline || prior.rcjStatus !== op.rcjStatus) {
      changedCount += 1;
      log.unshift({ icon: "changed", text: `Update on "${op.title}" - deadline/status changed`, time: now });
    }
    return { ...op, status: keepStatus };
  });

  if (newCount === 0 && changedCount === 0) {
    log.unshift({ icon: "check", text: `Daily scrub completed - no changes detected on ${merged.length} tracked listings`, time: now });
  }

  await mkdir(new URL("../site/data/", import.meta.url), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(merged, null, 2) + "\n");
  await writeFile(LOG_PATH, JSON.stringify(log.slice(0, 50), null, 2) + "\n");
  await writeFile(META_PATH, JSON.stringify({ lastScrubAt: now, trackedCount: merged.length }, null, 2) + "\n");

  console.log(`Scraped ${merged.length} opportunities (${newCount} new, ${changedCount} changed).`);

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook && newHighFit.length) {
    const lines = newHighFit.map((op) => `- *${op.title}* (${op.agency}) - AWS fit: ${op.awsFit}, Ingram fit: ${op.ingramFit}, deadline ${op.deadline || "TBD"}`);
    const text = `RHTP Radar found ${newHighFit.length} new high-fit release${newHighFit.length > 1 ? "s" : ""}:\n${lines.join("\n")}`;
    const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) console.error(`Slack notification failed: ${res.status} ${res.statusText}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
