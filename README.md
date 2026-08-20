# RHTP Opportunity Radar

Tracks funding/grant releases relevant to the Rural Health Transformation Program, tags each
one for AWS and Ingram Micro hardware fit, and recommends which enrolled partners and OEM
vendor lines to loop in. Runs entirely on free infrastructure: GitHub Actions for the daily
pull + GitHub Pages for hosting. No AWS bill, no server to maintain.

## How it works

1. **`.github/workflows/scrape.yml`** runs daily (and on manual dispatch) via `scripts/scrape.mjs`,
   which calls the Rural Care Journey API (`GET /api/v1/opportunities`), auto-tags each release
   with rule-based keyword matching (`scripts/tag.mjs` - no LLM calls, so this stays free and
   deterministic), and commits the result to `site/data/*.json`.
2. That commit triggers **`.github/workflows/pages.yml`**, which redeploys the static site in
   `site/` to GitHub Pages.
3. `site/app.js` fetches the JSON files client-side and renders the dashboard. Partner/OEM
   capability edits and per-opportunity pipeline status are saved to the browser's local
   storage (no write-back API yet) - see the in-app Admin tab caveat.

## One-time setup

1. **Create the repo.** Push this folder to a new GitHub repo. Keep it **private** - the
   partner/OEM matching data here is internal Ingram Micro strategy, not for public view.
   ```bash
   git init
   git add .
   git commit -m "Initial commit: RHTP Opportunity Radar"
   gh repo create rhtp-opportunity-radar --private --source=. --push
   ```
   (No `gh` CLI? Create the empty repo on github.com first, then `git remote add origin <url>`
   and `git push -u origin main`.)

2. **Add the API key as a repo secret.** Settings -> Secrets and variables -> Actions -> New
   repository secret:
   - `RCJ_API_KEY` - your Rural Care Journey API key. Never commit this to the repo.
   - `SLACK_WEBHOOK_URL` (optional) - an incoming webhook URL if you want a Slack ping when a
     new high-fit release is found. Leave unset to skip notifications.

3. **Enable Pages.** Settings -> Pages -> Source -> "GitHub Actions" (not "Deploy from a branch").

4. **Note on private repo + Pages:** on GitHub's free plan, a Pages site built from a private
   repo is still reachable by anyone with the URL (the *source code* stays private, but the
   *built site* isn't access-controlled). The URL won't be indexed or linked anywhere, but
   don't treat that as real access control. If you need the deployed site itself gated to
   named people, that requires GitHub Pro (~$4/mo) for "private" Pages visibility, or fronting
   it with something like Cloudflare Access (free up to 50 users) - not set up here.

5. **Run the first scrub.** Actions tab -> "Daily scrub" -> Run workflow. This populates
   `site/data/opportunities.json` for the first time and kicks off the first Pages deploy.

## Updating partner / OEM data for the whole team

Edits made in the app (Partners tab, OEM Vendors tab, pipeline status) are local to that
browser only. To change what everyone sees, edit `site/data/partners.json` or
`site/data/oems.json` directly in the repo (GitHub's web editor works fine) and push - the
next Pages deploy picks it up.

## Local development

```bash
# serve the site
cd site && python -m http.server 8080

# run the scraper by hand (needs RCJ_API_KEY in the environment)
RCJ_API_KEY=your_key node scripts/scrape.mjs
```

## Known limitations (by design, to keep this free and simple)

- No database - data lives as JSON files in the repo, versioned by git.
- No write-back API - team-wide edits go through a git commit, not the UI.
- Auto-tagging is rule-based keyword matching, not an LLM - it will misclassify or leave
  "Uncategorized" releases sometimes. Spot-check new items, especially anything landing in
  Uncategorized or with unexpected AWS/Ingram fit levels.
- Pages access on the free plan isn't a real access-control boundary (see setup step 4).
