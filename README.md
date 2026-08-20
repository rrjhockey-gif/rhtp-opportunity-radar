# RHTP Opportunity Radar

Tracks federal funding/grant releases relevant to rural health, tags each one for AWS and
Ingram Micro hardware fit, and recommends which enrolled partners and OEM vendor lines to
loop in. Runs entirely on free infrastructure: GitHub Actions for the daily pull + GitHub
Pages for hosting. No AWS bill, no server, no paid data subscription.

## Data source

Pulls from **grants.gov's public search API** (`api.grants.gov/v1/api/search2` +
`fetchOpportunity`) - free, no API key, no login. This is the official U.S. government grants
database, not a third-party aggregator.

**Coverage gaps, so you know what you're not seeing:**
- **Federal only.** grants.gov doesn't carry state-issued RFPs (e.g. a state health
  department's own RHTP solicitation). There's no single free source for those - would need
  per-state scraping added later if you want that coverage.
- **FCC's Rural Health Care Program and Connected Care Pilot aren't in grants.gov at all** -
  those are administered through USAC, a separate system, not the standard NOFO pipeline.
  Given these were some of the most Ingram/AWS-relevant programs in the original mockup,
  that's a real gap - would need a second scraper aimed at usac.org/fcc.gov if you want it.
- grants.gov's own keyword search is loose/fuzzy (a "rural health" search returns hundreds of
  unrelated hits), so `scripts/scrape.mjs` runs several targeted queries and then applies a
  local relevance filter (title must actually mention rural + health/hospital/clinic, or come
  from an HHS-family agency) before keeping anything. Tune `SEARCH_QUERIES` in that file to
  widen or narrow what gets pulled in.

## How it works

1. **`.github/workflows/scrape.yml`** runs daily (and on manual dispatch) via
   `scripts/scrape.mjs`, which queries grants.gov, auto-tags each release with rule-based
   keyword matching (`scripts/tag.mjs` - no LLM calls, so this stays free and deterministic),
   and commits the result to `site/data/*.json`.
2. That commit triggers **`.github/workflows/pages.yml`**, which redeploys the static site in
   `site/` to GitHub Pages.
3. `site/app.js` fetches the JSON files client-side and renders the dashboard. Partner/OEM
   capability edits and per-opportunity pipeline status are saved to the browser's local
   storage (no write-back API yet) - see the in-app Admin tab caveat.

## One-time setup

1. **Repo created and code pushed.** Done.

2. **(Optional) Slack notifications.** Settings -> Secrets and variables -> Actions -> New
   repository secret -> `SLACK_WEBHOOK_URL` (an incoming webhook URL). Leave unset to skip -
   nothing else needs a secret since grants.gov doesn't require a key.

3. **Enable Pages.** Settings -> Pages -> Source -> "GitHub Actions" (not "Deploy from a
   branch").

4. **Note on private repo + Pages:** on GitHub's free plan, a Pages site built from a private
   repo is still reachable by anyone with the URL (the *source code* stays private, but the
   *built site* isn't access-controlled). The URL won't be indexed or linked anywhere, but
   don't treat that as real access control. If you need the deployed site itself gated to
   named people, that requires GitHub Pro (~$4/mo) for "private" Pages visibility, or fronting
   it with something like Cloudflare Access (free up to 50 users) - not set up here.

5. **Run the scrub.** Actions tab -> "Daily scrub" -> Run workflow, if you want a fresh pull.
   (The repo already ships with a real, live-pulled dataset from grants.gov as of setup, so you
   don't have to wait for this to see something working.)

## Updating partner / OEM data for the whole team

Edits made in the app (Partners tab, OEM Vendors tab, pipeline status) are local to that
browser only. To change what everyone sees, edit `site/data/partners.json` or
`site/data/oems.json` directly in the repo (GitHub's web editor works fine) and push - the
next Pages deploy picks it up.

## Local development

```bash
# serve the site
cd site && python -m http.server 8080

# run the scraper by hand (no API key needed)
node scripts/scrape.mjs
```

## Known limitations (by design, to keep this free and simple)

- No database - data lives as JSON files in the repo, versioned by git.
- No write-back API - team-wide edits go through a git commit, not the UI.
- Auto-tagging is rule-based keyword matching, not an LLM - it will misclassify or leave
  "Uncategorized" releases sometimes, especially care-delivery/staffing grants that genuinely
  don't map to a tech solution area. Spot-check new items, especially anything landing in
  Uncategorized or with unexpected AWS/Ingram fit levels.
- See "Coverage gaps" above - this is federal-grants.gov data only, not the full universe of
  RHTP-adjacent funding.
- Pages access on the free plan isn't a real access-control boundary (see setup step 4).
