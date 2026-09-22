// Shared defaults/helpers used by background, content, options and popup scripts.
const DEFAULT_SETTINGS = {
  enabled: false,
  // sessionStorage keys to mirror (e.g. auth token, tenant id).
  syncKeys: ["currentUser"],
  // Sync map: each rule copies a value FROM one source origin TO many destinations.
  // The map is also the allow-list — only origins that appear in a rule are ever touched.
  //   mappings: [{ from: "https://dev.com", to: ["http://localhost:8080", "..."] }]
  mappings: [],
  // Auto-reload mapped tabs when the extension is (re)installed/updated.
  autoReloadOnUpdate: true
};

const MAX_AUDIT_ENTRIES = 50;

function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

/* ---- origin matching (supports "*" wildcards, e.g. https://*.example.com) ---- */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function originMatches(origin, pattern) {
  if (pattern === origin) return true;
  if (!pattern || !pattern.includes("*")) return false;
  const rx = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$");
  return rx.test(origin);
}
function matchesAny(origin, list) {
  return Array.isArray(list) && list.some((p) => originMatches(origin, p));
}

/* ---- sync-map helpers ---- */
function mappingSources(settings) {
  return (settings.mappings || []).map((m) => m.from).filter(Boolean);
}
function destinationPatternsFor(origin, settings) {
  const out = [];
  for (const m of settings.mappings || []) {
    if (originMatches(origin, m.from)) {
      for (const t of m.to || []) out.push(t);
    }
  }
  return out;
}
// A source (we read from it) is any origin matching a rule's "from".
function isSourceOrigin(origin, settings) {
  return matchesAny(origin, mappingSources(settings));
}
// A destination (we write to it) is any origin matching some rule's "to".
function isDestOrigin(origin, settings) {
  return (settings.mappings || []).some((m) => matchesAny(origin, m.to));
}
// Every distinct origin referenced anywhere in the map (for reload / clear-all).
function allMappedOrigins(settings) {
  const set = new Set();
  for (const m of settings.mappings || []) {
    if (m.from) set.add(m.from);
    for (const t of m.to || []) set.add(t);
  }
  return [...set];
}
// True when at least one rule can actually move a value (has a from and a to).
function hasUsableFlow(settings) {
  return (settings.mappings || []).some((m) => m.from && (m.to || []).length > 0);
}

// Never store/display raw secret values in the audit log - only a short masked preview.
function maskValue(value) {
  if (value === null || value === undefined) return "(cleared)";
  const str = String(value);
  if (str.length <= 12) return `${str.slice(0, 2)}***`;
  return `${str.slice(0, 6)}...${str.slice(-4)} (${str.length} chars)`;
}
