// Rule-based auto-tagging. Deliberately no LLM calls - keeps the daily run free and deterministic.
// Every heuristic here is a first guess, not a verdict; a human should still sanity-check "Uncategorized"
// items and anything tagged purely off generic keywords.

export const SOLUTIONS = ["Telehealth", "Cloud Infrastructure", "Data & Analytics", "Cyber Security"];
export const HARDWARE_CATEGORIES = ["Networking", "Security Appliances", "Endpoint & Workstation", "Video & RPM Hardware", "Servers & Storage"];

const SOLUTION_KEYWORDS = {
  "Telehealth": ["telehealth", "tele-health", "remote patient monitoring", "rpm ", "video visit", "connected care", "distance learning", "telemedicine", "virtual care"],
  "Cloud Infrastructure": ["cloud", "infrastructure moderniz", "migration", "modernization", "it infrastructure", "legacy system", "data center", "hosting"],
  "Data & Analytics": ["data", "analytics", "interoperab", "health information exchange", " hie ", "fhir", "quality reporting", "value-based", "dashboard"],
  "Cyber Security": ["cyber", "security", "ransomware", "firewall", "risk assessment", "incident response", "zero trust", "breach", "vulnerability"]
};

const HARDWARE_KEYWORDS = {
  "Networking": ["network", "broadband", "router", "gateway", "wan ", "wi-fi", "wifi", "connectivity", "bandwidth"],
  "Security Appliances": ["firewall", "segmentation", "endpoint security", "intrusion", "detection & response", "security appliance"],
  "Endpoint & Workstation": ["workstation", "laptop", "desktop", "device refresh", "field office", "end-user device"],
  "Video & RPM Hardware": ["video endpoint", "camera", "remote monitoring device", "rpm device", "cellular gateway", "peripheral"],
  "Servers & Storage": ["server", "storage", "on-prem hardware", "backup appliance", "data center hardware"]
};

const SET_ASIDE_KEYWORDS = [
  { pattern: /\b8\(a\)\b/i, label: "8(a) small business set-aside" },
  { pattern: /small business set-aside/i, label: "Small business set-aside" },
  { pattern: /rural non-?profit set-aside/i, label: "Rural non-profit set-aside" },
  { pattern: /critical-access hospital/i, label: "Rural critical-access hospital set-aside" },
  { pattern: /rural hospital set-aside/i, label: "Small rural hospital set-aside" },
  { pattern: /set-aside/i, label: "Set-aside (see source for detail)" }
];

const AWS_NOTES_BY_SOLUTION = {
  "Telehealth": "Video/remote-monitoring workloads fit AWS telehealth reference patterns (Amazon Chime SDK, IoT Core for RPM device ingestion, HealthLake for interoperability) - validate against the specific requirements above.",
  "Cloud Infrastructure": "Reads as a lift-and-shift / modernization play - Migration Hub, Direct Connect for hybrid sites, and standard EC2/RDS hosting are the likely fit - validate against the specific requirements above.",
  "Data & Analytics": "Data pipeline / interoperability work fits HealthLake, Glue, Lake Formation and QuickSight patterns - validate against the specific requirements above.",
  "Cyber Security": "Security Hub, GuardDuty, and WAF map to typical managed detection & response asks in this category - validate against the specific requirements above.",
  "Uncategorized": "Solution area not auto-detected from title/summary keywords - review manually before assuming an AWS angle."
};

const INGRAM_NOTES_BY_HARDWARE = {
  "Networking": "networking/connectivity gear (routers, gateways, access points)",
  "Security Appliances": "firewalls and network segmentation appliances",
  "Endpoint & Workstation": "end-user workstations or device refresh",
  "Video & RPM Hardware": "video endpoints or remote patient monitoring hardware",
  "Servers & Storage": "on-prem servers or storage hardware"
};

function textOf(item) {
  return `${item.title || ""} ${item.summary || ""} ${(item.applicantTypes || []).join(" ")}`.toLowerCase();
}

export function detectSolution(item) {
  const text = textOf(item);
  let best = null, bestHits = 0;
  for (const sol of SOLUTIONS) {
    const hits = SOLUTION_KEYWORDS[sol].filter((k) => text.includes(k)).length;
    if (hits > bestHits) { best = sol; bestHits = hits; }
  }
  return best || "Uncategorized";
}

export function detectHardwareCategories(item) {
  const text = textOf(item);
  return HARDWARE_CATEGORIES.filter((cat) => HARDWARE_KEYWORDS[cat].some((k) => text.includes(k)));
}

export function detectSetAside(item) {
  const text = `${item.title || ""} ${item.summary || ""}`;
  for (const { pattern, label } of SET_ASIDE_KEYWORDS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function tagOpportunity(item) {
  const solution = detectSolution(item);
  const hardwareCategories = detectHardwareCategories(item);
  const setAside = detectSetAside(item);

  const awsFit = solution === "Cloud Infrastructure" || solution === "Data & Analytics" ? "high"
    : solution === "Uncategorized" ? "low" : "medium";

  const ingramFit = hardwareCategories.length >= 2 || !!setAside ? "high"
    : hardwareCategories.length === 1 ? "medium" : "low";

  const ingramNotes = hardwareCategories.length
    ? `Likely hardware component: ${hardwareCategories.map((c) => INGRAM_NOTES_BY_HARDWARE[c]).join("; ")}. Auto-detected from keywords - confirm against the full solicitation.`
    : "No hardware keywords detected in the summary - likely a services/licensing-only engagement, but confirm against the full solicitation.";

  return {
    solution,
    hardwareCategories,
    setAside,
    awsFit,
    ingramFit,
    awsNotes: AWS_NOTES_BY_SOLUTION[solution],
    ingramNotes
  };
}
