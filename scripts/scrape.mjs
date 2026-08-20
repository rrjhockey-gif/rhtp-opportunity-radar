// Daily data pull: hits the Rural Care Journey API, normalizes + auto-tags each opportunity,
// and merges into site/data/opportunities.json - preserving any pipeline status a human has
// already set (New/Reviewing/Pursuing/Passed), since a re-scrape must never clobber that.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tagOpportunity } from "./tag.mjs";

const API_BASE = "https://www.ruralcarejourney.com";
const OUT_PATH = new URL("../site/data/opportunities.json", import.meta.url);
const LOG_PATH = new URL("../site/data/scrub-log.json", import.meta.url);
const META_PATH = new URL("../site/data/meta.json", import.meta.url);

const apiKey = process.env.RCJ_API_KEY;
if (!apiKey) {
  console.error("RCJ_API_KEY is not set. Add it as a repo secret (Settings > Secrets and variables > Actions).");
  process.exit(1);
}

async function fetchAllOpportunities() {
  const results = [];
  let page = 1;
  const limit = 100;
  while (true) {
    const url = `${API_BASE}/api/v1/opportunities?page=${page}&limit=${limit}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`RCJ API request failed: ${res.status} ${res.statusText} - ${await res.text()}`);
    }
    const body = await res.json();
    results.push(...(body.data || []));
    const pages = body.pagination?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
  }
  return results;
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtAward(min, max) {
  const fmt = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`;
  if (min == null && max == null) return "Not specified";
  if (min != null && max != null && min !== max) return `${fmt(min)} - ${fmt(max)}`;
  return fmt(max ?? min);
}

function normalize(raw) {
  const tags = tagOpportunity(raw);
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    agency: raw.issuingAgency || "Unknown agency",
    summary: raw.summary || "",
    applicantTypes: raw.applicantTypes || [],
    award: fmtAward(raw.budgetMin, raw.budgetMax),
    deadline: fmtDate(raw.dueDate),
    released: fmtDate(raw.postedDate),
    loiDate: fmtDate(raw.loiDate),
    questionDeadline: fmtDate(raw.questionDeadline),
    states: raw.scope === "NATIONAL" ? ["Nationwide"] : raw.state ? [raw.state] : ["Nationwide"],
    sourceUrl: raw.sourceUrl || null,
    rcjStatus: raw.status || null,
    ...tags,
    status: "New" // default pipeline stage for brand-new items; overwritten below if we've seen this id before
  };
}

async function loadPrevious() {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function loadLog() {
  try {
    return JSON.parse(await readFile(LOG_PATH, "utf8"));
  } catch {
    return [];
  }
}

async function main() {
  const previous = await loadPrevious();
  const previousById = new Map(previous.map((o) => [o.id, o]));

  const raw = await fetchAllOpportunities();
  const normalized = raw.map(normalize);

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
    // Preserve human-managed fields across re-scrapes.
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
    const lines = newHighFit.map((op) => `- *${op.title}* (${op.agency}) - AWS fit: ${op.awsFit}, Ingram fit: ${op.ingramFit}, deadline ${op.deadline}`);
    const text = `RHTP Radar found ${newHighFit.length} new high-fit release${newHighFit.length > 1 ? "s" : ""}:\n${lines.join("\n")}`;
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) console.error(`Slack notification failed: ${res.status} ${res.statusText}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
