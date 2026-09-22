// Shared defaults/helpers used by background, content, options and popup scripts.
const DEFAULT_SETTINGS = {
  enabled: false,
  // Multiple sessionStorage keys can be synced (e.g. auth token, tenant id, etc.)
  syncKeys: ["currentUserTokenState"],
  // Gatekeeper: an origin must be here to be touched at all (read OR written).
  // Empty by default: the extension does nothing until you explicitly allow-list origins.
  allowedOrigins: [],
  // Direction. A change is only READ from a "from" origin and only WRITTEN to a
  // "to" origin, so the audit log reads cleanly as  from -> to  (no cross-product).
  fromOrigins: [],
  toOrigins: [],
  // Auto-reload allow-listed tabs when the extension is (re)installed/updated, so their
  // content scripts re-attach instead of being silently orphaned.
  autoReloadOnUpdate: true
};

const MAX_AUDIT_ENTRIES = 50;

function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

// Origin allow-list matching, with wildcard support:
//   "https://app.example.com"  -> exact
//   "https://*.example.com"    -> any subdomain (a.example.com, a.b.example.com)
//   "*"                        -> everything (use with care)
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function originMatches(origin, pattern) {
  if (pattern === origin) return true;
  if (!pattern.includes("*")) return false;
  const rx = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$");
  return rx.test(origin);
}
function matchesAny(origin, list) {
  return Array.isArray(list) && list.some((p) => originMatches(origin, p));
}
function isOriginAllowed(origin, allowedOrigins) {
  return matchesAny(origin, allowedOrigins);
}
// A source (we read from it) must pass the gate AND be listed under "from".
function isSourceOrigin(origin, settings) {
  return isOriginAllowed(origin, settings.allowedOrigins) && matchesAny(origin, settings.fromOrigins);
}
// A destination (we write to it) must pass the gate AND be listed under "to".
function isDestOrigin(origin, settings) {
  return isOriginAllowed(origin, settings.allowedOrigins) && matchesAny(origin, settings.toOrigins);
}

// Never store/display raw secret values in the audit log - only a short masked preview.
function maskValue(value) {
  if (value === null || value === undefined) return "(cleared)";
  const str = String(value);
  if (str.length <= 12) return `${str.slice(0, 2)}***`;
  return `${str.slice(0, 6)}...${str.slice(-4)} (${str.length} chars)`;
}

