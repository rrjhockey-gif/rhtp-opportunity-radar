(function () {
  const SOLUTIONS = ["Telehealth", "Cloud Infrastructure", "Data & Analytics", "Cyber Security"];
  const HARDWARE_CATEGORIES = ["Networking", "Security Appliances", "Endpoint & Workstation", "Video & RPM Hardware", "Servers & Storage"];
  const PIPELINE_STAGES = ["New", "Reviewing", "Pursuing", "Passed"];
  const LS_KEY = "rhtp-radar-local-state-v1";

  const ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6 9 17l-5-5"/></svg>',
    found: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    changed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20v-6M12 4v4M5 10l7-6 7 6M5 14l7 6 7-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3h7v7M21 3l-9 9M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>'
  };

  const corners = '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  }
  function saveLocal(patch) {
    const cur = loadLocal();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
  }

  let state = {
    loading: true,
    error: null,
    activeTab: "Overview",
    search: "",
    vendorFilter: "all",
    selectedId: null,
    opportunities: [],
    partners: [],
    oems: [],
    attachedOems: {},
    scrubLog: [],
    meta: {}
  };

  function fitTag(level, label) {
    const cls = level === "high" ? "tag-accent" : level === "medium" ? "tag-amber" : "tag-neutral";
    return `<span class="tag ${cls}">${label}</span>`;
  }
  function fitLabel(level) { return level === "high" ? "High fit" : level === "medium" ? "Possible fit" : "Low fit"; }
  function statusTag(status) {
    const map = { New: "tag-accent", Reviewing: "tag-blue", Pursuing: "tag-amber", Passed: "tag-neutral" };
    return `<span class="tag ${map[status] || "tag-outline"}">${esc(status)}</span>`;
  }
  function sourceStatusTag(rcjStatus) {
    if (!rcjStatus) return "";
    const map = { OPEN: "tag-accent", CLOSING_SOON: "tag-red", UPCOMING: "tag-blue", AMENDED: "tag-amber", CLOSED: "tag-neutral" };
    const label = rcjStatus.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return `<span class="tag ${map[rcjStatus] || "tag-outline"}">${esc(label)}</span>`;
  }
  function matchPartners(op, partners) {
    const opStates = op.states && op.states.length ? op.states : ["Nationwide"];
    return partners
      .filter((p) => p.services.includes(op.solution) && (p.states.includes("Nationwide") || opStates.includes("Nationwide") || p.states.some((s) => opStates.includes(s))))
      .map((p) => (p.software ? `${p.name} (${p.software})` : p.name));
  }
  function matchOems(op, oems) {
    return oems.filter((v) => v.categories.some((c) => (op.hardwareCategories || []).includes(c))).map((v) => v.name);
  }
  function matchCount(partner) {
    return state.opportunities.filter((o) => partner.services.includes(o.solution)).length;
  }
  function oemMatchCount(vendor) {
    return state.opportunities.filter((o) => (o.hardwareCategories || []).some((c) => vendor.categories.includes(c))).length;
  }
  function timeAgo(iso) {
    if (!iso) return "never run yet";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "unknown";
    const diffH = (Date.now() - d.getTime()) / 36e5;
    if (diffH < 1) return "less than an hour ago";
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    return `${Math.round(diffH / 24)}d ago`;
  }

  async function fetchJson(path, fallback) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(err);
      return fallback;
    }
  }

  async function loadData() {
    state.loading = true;
    renderRoot();
    const [opportunities, partnersDefault, oemsDefault, scrubLog, meta] = await Promise.all([
      fetchJson("data/opportunities.json", null),
      fetchJson("data/partners.json", []),
      fetchJson("data/oems.json", []),
      fetchJson("data/scrub-log.json", []),
      fetchJson("data/meta.json", {})
    ]);

    if (opportunities === null) {
      state.loading = false;
      state.error = "Could not load data/opportunities.json. If this is a brand-new deployment, the daily scrub workflow (or a manual run of it from the Actions tab) needs to run at least once.";
      renderRoot();
      return;
    }

    const local = loadLocal();
    state.opportunities = opportunities.map((op) => {
      const overrideStatus = local.statusOverrides && local.statusOverrides[op.id];
      return overrideStatus ? { ...op, status: overrideStatus } : op;
    });
    state.partners = (local.partners && local.partners.length ? local.partners : partnersDefault).map((p) => ({ ...p, states: [...p.states], services: [...p.services] }));
    state.oems = (local.oems && local.oems.length ? local.oems : oemsDefault).map((v) => ({ ...v, categories: [...v.categories] }));
    state.scrubLog = scrubLog;
    state.meta = meta;

    state.attachedOems = {};
    state.opportunities.forEach((op) => {
      state.attachedOems[op.id] = (local.attachedOems && local.attachedOems[op.id]) || matchOems(op, state.oems);
    });

    state.loading = false;
    renderAll();
  }

  function renderNavMeta() {
    const el = document.getElementById("nav-meta");
    if (state.loading) { el.innerHTML = "<span>Loading...</span>"; return; }
    const lastScrub = state.meta.lastScrubAt ? timeAgo(state.meta.lastScrubAt) : "never run yet";
    el.innerHTML = `
      <span style="display:inline-flex; width:14px; height:14px; color:var(--color-accent);">${ICONS.scan}</span>
      <span>Last scrub ${esc(lastScrub)} - source <a href="https://rhtp.amemobile.net" target="_blank" rel="noopener">rhtp.amemobile.net</a></span>
      <span class="dot"></span>
      <span>Edits saved to this browser only - see Admin tab</span>`;
  }

  function renderStats() {
    const total = state.opportunities.length;
    const newCount = state.opportunities.filter((o) => o.status === "New").length;
    const highAws = state.opportunities.filter((o) => o.awsFit === "high").length;
    const setAsides = state.opportunities.filter((o) => !!o.setAside).length;
    const multiVendor = state.opportunities.filter((o) => (o.hardwareCategories || []).length >= 2).length;
    const cards = [
      { label: "Tracked releases", value: total, sub: "Across 4 solution areas" },
      { label: "New this week", value: newCount, sub: "Pipeline stage = New" },
      { label: "High AWS fit", value: highAws, sub: "Direct cloud services play" },
      { label: "Ingram set-asides", value: setAsides, sub: "Hardware / eligible-spend carve-outs" },
      { label: "Multi-vendor builds", value: multiVendor, sub: "2+ hardware categories needed" },
      { label: "Enrolled partners", value: state.partners.length, sub: "Resellers, ISVs & SIs" }
    ];
    return `<div class="stats">${cards.map((c) => `<div class="stat-card">${corners}<div class="stat-label">${esc(c.label)}</div><div class="stat-value">${c.value}</div><div class="stat-sub">${esc(c.sub)}</div></div>`).join("")}</div>`;
  }

  function renderTabs() {
    const tabs = ["Overview", ...SOLUTIONS, "Partners", "OEM Vendors", "Admin"];
    return `<div class="tabbar">${tabs.map((t) => `<button class="tab-btn${state.activeTab === t ? " active" : ""}" data-tab="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
  }

  function renderTableView() {
    let list = state.opportunities;
    if (SOLUTIONS.includes(state.activeTab)) list = list.filter((o) => o.solution === state.activeTab);
    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      list = list.filter((o) => (o.title || "").toLowerCase().includes(q) || (o.agency || "").toLowerCase().includes(q) || (o.solution || "").toLowerCase().includes(q));
    }
    if (state.vendorFilter === "aws") list = list.filter((o) => o.awsFit === "high");
    if (state.vendorFilter === "ingram") list = list.filter((o) => !!o.setAside);

    const rows = list.map((op) => `
      <tr data-id="${esc(op.id)}">
        <td><div class="op-title">${esc(op.title)}</div><div class="op-solution">${esc(op.solution)}</div></td>
        <td class="cell-muted">${esc(op.agency)}</td>
        <td>${fitTag(op.awsFit, fitLabel(op.awsFit))}</td>
        <td>${fitTag(op.ingramFit, fitLabel(op.ingramFit))}</td>
        <td class="cell-muted">${op.setAside ? esc(op.setAside) : "-"}</td>
        <td class="cell-mono">${esc(op.award)}</td>
        <td class="cell-mono">${esc(op.deadline)}</td>
        <td>${statusTag(op.status)}</td>
      </tr>`).join("");

    return `
      <div class="toolbar">
        <input class="search-input" id="search" type="text" placeholder="Search agency, title, keyword..." value="${esc(state.search)}">
        <div class="seg" id="vendor-seg">
          <button class="seg-opt${state.vendorFilter === "all" ? " active" : ""}" data-v="all">All</button>
          <button class="seg-opt${state.vendorFilter === "aws" ? " active" : ""}" data-v="aws">AWS fit</button>
          <button class="seg-opt${state.vendorFilter === "ingram" ? " active" : ""}" data-v="ingram">Ingram set-aside</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Opportunity</th><th>Agency</th><th>AWS fit</th><th>Ingram / hardware fit</th><th>Set-aside</th><th>Award</th><th>Deadline</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${list.length === 0 ? `<div class="empty-state">${state.opportunities.length === 0 ? "No opportunities tracked yet - the daily scrub hasn't found or synced anything." : "No opportunities match this filter."}</div>` : ""}
      </div>`;
  }

  function renderPartnersView() {
    const cards = state.partners.map((p, idx) => {
      const chips = SOLUTIONS.map((s) => `<button class="chip${p.services.includes(s) ? " on" : ""}" data-idx="${idx}" data-sol="${esc(s)}">${esc(s)}</button>`).join("");
      return `
      <div class="partner-card">
        ${corners}
        <div class="partner-head">
          <div><div class="partner-name">${esc(p.name)}</div><div class="partner-focus">${esc(p.type)} - ${esc(p.focus)}</div></div>
          <span class="tag tag-accent">${matchCount(p)} open matches</span>
        </div>
        <div style="margin-top:14px;"><div class="kicker">Core solutions covered</div><div class="chip-row">${chips}</div></div>
        <div class="field"><label>States served (comma-separated, or "Nationwide")</label><input class="input states-input" data-idx="${idx}" type="text" value="${esc(p.states.join(", "))}"></div>
        <div class="field"><label>ISV software / platform (if applicable)</label><input class="input software-input" data-idx="${idx}" type="text" placeholder="e.g. platform name" value="${esc(p.software)}"></div>
      </div>`;
    }).join("");
    return `
      <div class="view-header">
        <h2 class="view-title">Partner capability manager</h2>
        <span class="view-note">Used to match new releases to the right reseller / ISV / SI to notify</span>
      </div>
      <div class="partner-grid">${cards}</div>`;
  }

  function renderOemsView() {
    const cards = state.oems.map((v, idx) => {
      const chips = HARDWARE_CATEGORIES.map((c) => `<button class="chip${v.categories.includes(c) ? " on" : ""}" data-idx="${idx}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
      return `
      <div class="partner-card">
        ${corners}
        <div class="partner-head">
          <div><div class="partner-name">${esc(v.name)}</div><div class="partner-focus">OEM hardware line</div></div>
          <span class="tag tag-accent">${oemMatchCount(v)} open matches</span>
        </div>
        <div style="margin-top:14px;"><div class="kicker">Hardware categories covered</div><div class="chip-row">${chips}</div></div>
        <div class="field"><label>Specialty / product line notes</label><input class="input oem-specialty-input" data-idx="${idx}" type="text" value="${esc(v.specialty)}"></div>
      </div>`;
    }).join("");
    return `
      <div class="view-header">
        <h2 class="view-title">OEM hardware vendor lines</h2>
        <span class="view-note">Manufacturer lines Ingram distributes - matched to opportunities by hardware category, attached per-deal from the opportunity detail view</span>
      </div>
      <div class="partner-grid">${cards}</div>`;
  }

  function guessActionsUrl() {
    // Best-effort: on a *.github.io/<repo>/ Pages URL, the repo's Actions tab follows the same pattern.
    const host = location.hostname;
    const m = host.match(/^([^.]+)\.github\.io$/);
    if (!m) return "https://github.com";
    const owner = m[1];
    const repo = location.pathname.split("/").filter(Boolean)[0];
    return repo ? `https://github.com/${owner}/${repo}/actions/workflows/scrape.yml` : `https://github.com/${owner}?tab=repositories`;
  }

  function renderAdminView() {
    const logRows = state.scrubLog.length
      ? state.scrubLog.map((l) => `
        <div class="scrub-row">
          <span class="scrub-icon">${ICONS[l.icon] || ICONS.info}</span>
          <div><div class="scrub-text">${esc(l.text)}</div><div class="scrub-time">${esc(new Date(l.time).toLocaleString())}</div></div>
        </div>`).join("")
      : `<div class="empty-state" style="padding:24px 0;">No scrub history yet.</div>`;

    const dirRows = state.partners.map((p) => `
      <div class="dir-row">
        <div><div class="dir-name">${esc(p.name)}</div><div class="dir-focus">${esc(p.type)} - ${esc(p.focus)}</div></div>
        <span class="tag tag-outline">${matchCount(p)} matches</span>
      </div>`).join("");

    return `
      <div class="admin-grid">
        <div class="panel">
          ${corners}
          <div class="panel-head">
            <div class="kicker">Daily scrub log - rhtp.amemobile.net (via Rural Care Journey API)</div>
            <a class="btn btn-secondary" href="${esc(guessActionsUrl())}" target="_blank" rel="noopener">${ICONS.scan.replace("<svg", '<svg width="14" height="14"')} Open Actions tab</a>
          </div>
          <div class="scrub-log">${logRows}</div>
          <div class="caveat">
            <div class="kicker">${ICONS.info.replace("<svg", '<svg width="12" height="12"')} How this works</div>
            <p>A GitHub Actions workflow runs daily, pulls from the Rural Care Journey API, auto-tags each release with rule-based keyword matching (no paid LLM calls), and commits the result here. Trigger an on-demand run from the repo's Actions tab (workflow: "Daily scrub").</p>
          </div>
          <div class="caveat" style="background:var(--color-blue-soft);">
            <div class="kicker" style="color:var(--color-blue-soft-text);">${ICONS.info.replace("<svg", '<svg width="12" height="12"')} Partner / OEM / status edits are local-only</div>
            <p style="color:var(--color-blue-soft-text);">There's no write-back API yet, so edits you make in the Partners, OEM Vendors, and opportunity status controls are saved to this browser's local storage only - they won't show up on another device, and clearing browser data clears them. To make a capability change permanent for the whole team, edit site/data/partners.json or site/data/oems.json directly in the GitHub repo.</p>
          </div>
        </div>
        <div class="panel">
          ${corners}
          <div class="kicker">Enrolled partner directory</div>
          <div class="dir-list">${dirRows}</div>
        </div>
      </div>`;
  }

  function renderModal() {
    const root = document.getElementById("modal-root");
    if (state.selectedId == null) { root.innerHTML = ""; return; }
    const op = state.opportunities.find((o) => o.id === state.selectedId);
    if (!op) { root.innerHTML = ""; return; }

    const recommended = matchPartners(op, state.partners);
    const suggestedOems = matchOems(op, state.oems);
    const attached = state.attachedOems[op.id] || [];
    const hardwareCategories = op.hardwareCategories || [];
    const oemChips = state.oems.map((v) => {
      const on = attached.includes(v.name);
      const suggested = suggestedOems.includes(v.name);
      return `<button class="chip${on ? " on" : ""}" data-oem="${esc(v.name)}" title="${esc(v.specialty)}">${on ? ICONS.check.replace("<svg", '<svg width="10" height="10" style="vertical-align:-1px;margin-right:3px;"') : ""}${esc(v.name)}${suggested && !on ? " *" : ""}</button>`;
    }).join("");

    root.innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal">
          <div class="modal-title">
            <div>
              <span class="tag tag-accent">${esc(op.solution)}</span> ${sourceStatusTag(op.rcjStatus)}
              <div class="modal-heading">${esc(op.title)}</div>
            </div>
            <button class="btn-icon" id="close-modal">${ICONS.x.replace("<svg", '<svg width="18" height="18"')}</button>
          </div>
          <div class="modal-body">
            <div class="meta-grid">
              <div><div class="kicker">Agency</div><div>${esc(op.agency)}</div></div>
              <div><div class="kicker">Award</div><div>${esc(op.award)}</div></div>
              <div><div class="kicker">Released</div><div>${esc(op.released) || "-"}</div></div>
              <div><div class="kicker">Deadline</div><div>${esc(op.deadline) || "-"}</div></div>
            </div>
            <div style="margin-bottom:16px;"><div class="kicker">Eligible states</div><div>${esc((op.states && op.states.length ? op.states : ["Nationwide"]).join(", "))}</div></div>
            <div class="kicker">Summary</div>
            <p style="margin:8px 0 16px; font-size:13px;">${esc(op.summary) || "No summary provided by the source."}</p>
            ${(op.applicantTypes && op.applicantTypes.length) || op.loiDate || op.questionDeadline ? `
            <div class="kicker">Eligibility & key dates</div>
            <ul style="margin:8px 0 16px; padding-left:18px; font-size:13px;">
              ${op.applicantTypes && op.applicantTypes.length ? `<li>Applicant types: ${op.applicantTypes.map(esc).join(", ")}</li>` : ""}
              ${op.loiDate ? `<li>Letter of intent due: ${esc(op.loiDate)}</li>` : ""}
              ${op.questionDeadline ? `<li>Question deadline: ${esc(op.questionDeadline)}</li>` : ""}
            </ul>` : ""}
            <div class="notes-grid">
              <div class="note-card"><div class="kicker">AWS relevance</div><p>${esc(op.awsNotes)}</p></div>
              <div class="note-card"><div class="kicker">Ingram Micro / hardware relevance</div><p>${esc(op.ingramNotes)}</p></div>
            </div>
            <div style="margin-top:16px;">
              <div class="kicker">Pipeline status</div>
              <div class="seg" id="status-seg" style="margin-top:8px; width:fit-content;">
                ${PIPELINE_STAGES.map((s) => `<button class="seg-opt${op.status === s ? " active" : ""}" data-status="${esc(s)}">${esc(s)}</button>`).join("")}
              </div>
            </div>
            <div style="margin-top:16px;">
              <div class="kicker">Recommended partners to loop in (matched on solution + state)</div>
              <div class="chip-row" style="margin-top:8px;">
                ${recommended.length ? recommended.map((n) => `<span class="tag tag-outline">${esc(n)}</span>`).join("") : '<span class="cell-muted" style="font-size:12.5px;">No enrolled partner currently covers this solution/state combination.</span>'}
              </div>
            </div>
            <div style="margin-top:16px;">
              <div class="kicker">Hardware / OEM vendor lines to attach${hardwareCategories.length ? ` (needs: ${hardwareCategories.map(esc).join(", ")})` : ""}</div>
              ${hardwareCategories.length === 0
                ? '<p class="cell-muted" style="font-size:12.5px; margin:8px 0 0;">No hardware component detected for this release - cloud/services play only.</p>'
                : `<p style="font-size:11.5px; color:var(--color-text-faint); margin:6px 0 8px;">Click to attach or remove a vendor line. * marks a suggested match${hardwareCategories.length > 1 ? " - more than one category is needed here, so this build may take multiple OEM lines" : ""}.</p>
                   <div class="chip-row" id="oem-chip-row">${oemChips}</div>`}
            </div>
          </div>
          <div class="modal-actions">
            ${op.sourceUrl ? `<a class="btn btn-secondary" href="${esc(op.sourceUrl)}" target="_blank" rel="noopener">${ICONS.link.replace("<svg", '<svg width="14" height="14"')} View source listing</a>` : "<span></span>"}
            <div style="display:flex; gap:10px;">
              <button class="btn btn-secondary" id="close-modal-2">Close</button>
              <button class="btn btn-primary">${ICONS.send.replace("<svg", '<svg width="14" height="14"')} Share with partners</button>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") closeModal(); });
    document.getElementById("close-modal").addEventListener("click", closeModal);
    document.getElementById("close-modal-2").addEventListener("click", closeModal);

    document.getElementById("status-seg").querySelectorAll(".seg-opt").forEach((btn) =>
      btn.addEventListener("click", () => {
        op.status = btn.dataset.status;
        const local = loadLocal();
        const statusOverrides = { ...(local.statusOverrides || {}), [op.id]: op.status };
        saveLocal({ statusOverrides });
        renderModal();
        renderRoot();
      })
    );

    const oemRow = document.getElementById("oem-chip-row");
    if (oemRow) {
      oemRow.querySelectorAll(".chip").forEach((chip) =>
        chip.addEventListener("click", () => {
          const name = chip.dataset.oem;
          const cur = state.attachedOems[op.id] || [];
          state.attachedOems[op.id] = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
          const local = loadLocal();
          saveLocal({ attachedOems: { ...(local.attachedOems || {}), [op.id]: state.attachedOems[op.id] } });
          renderModal();
        })
      );
    }
  }
  function closeModal() { state.selectedId = null; renderModal(); }

  function renderContent() {
    if (state.activeTab === "Partners") return renderPartnersView();
    if (state.activeTab === "OEM Vendors") return renderOemsView();
    if (state.activeTab === "Admin") return renderAdminView();
    return renderTableView();
  }

  function renderRoot() {
    const root = document.getElementById("root");
    renderNavMeta();
    if (state.loading) {
      root.innerHTML = `<div class="state-screen"><div class="spinner"></div><div>Loading tracked opportunities...</div></div>`;
      return;
    }
    if (state.error) {
      root.innerHTML = `<div class="state-screen"><div class="kicker" style="color:var(--color-amber-soft-text);">Couldn't load data</div><div style="max-width:520px;">${esc(state.error)}</div></div>`;
      return;
    }
    root.innerHTML = `${renderStats()}${renderTabs()}<div id="content">${renderContent()}</div>`;
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => { state.activeTab = btn.dataset.tab; renderRoot(); }));
    wireEvents();
  }
  function renderAll() { renderRoot(); renderModal(); }

  function wireEvents() {
    const search = document.getElementById("search");
    if (search) search.addEventListener("input", (e) => { state.search = e.target.value; renderContentOnly(); });

    const vendorSeg = document.getElementById("vendor-seg");
    if (vendorSeg) vendorSeg.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-v]");
      if (!btn) return;
      state.vendorFilter = btn.dataset.v;
      renderContentOnly();
    });

    document.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => { state.selectedId = tr.dataset.id; renderModal(); }));

    document.querySelectorAll("#content .chip[data-sol]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const idx = Number(chip.dataset.idx), sol = chip.dataset.sol;
        const cur = state.partners[idx].services;
        state.partners[idx].services = cur.includes(sol) ? cur.filter((x) => x !== sol) : [...cur, sol];
        saveLocal({ partners: state.partners });
        renderAll();
      })
    );
    document.querySelectorAll("#content .states-input").forEach((inp) =>
      inp.addEventListener("change", () => {
        state.partners[Number(inp.dataset.idx)].states = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
        saveLocal({ partners: state.partners });
        renderRoot();
      })
    );
    document.querySelectorAll("#content .software-input").forEach((inp) =>
      inp.addEventListener("change", () => {
        state.partners[Number(inp.dataset.idx)].software = inp.value;
        saveLocal({ partners: state.partners });
      })
    );

    document.querySelectorAll("#content .chip[data-cat]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const idx = Number(chip.dataset.idx), cat = chip.dataset.cat;
        const cur = state.oems[idx].categories;
        state.oems[idx].categories = cur.includes(cat) ? cur.filter((x) => x !== cat) : [...cur, cat];
        saveLocal({ oems: state.oems });
        renderAll();
      })
    );
    document.querySelectorAll("#content .oem-specialty-input").forEach((inp) =>
      inp.addEventListener("change", () => {
        state.oems[Number(inp.dataset.idx)].specialty = inp.value;
        saveLocal({ oems: state.oems });
      })
    );
  }

  function renderContentOnly() {
    document.getElementById("content").innerHTML = renderContent();
    wireEvents();
  }

  loadData();
})();
