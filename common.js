// Shared defaults/helpers used by background, content, options and popup scripts.
const DEFAULT_SETTINGS = {
  enabled: false,
  // Multiple sessionStorage keys can be synced (e.g. auth token, tenant id, etc.)
  syncKeys: ["currentUserTokenState"],
  // Origins (e.g. "https://app-a.example.com") that are allowed to send/receive values.
  // Empty by default: the extension does nothing until you explicitly allow-list origins.
  allowedOrigins: [],
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
function isOriginAllowed(origin, allowedOrigins) {
  return Array.isArray(allowedOrigins) && allowedOrigins.some((p) => originMatches(origin, p));
}

// Never store/display raw secret values in the audit log - only a short masked preview.
function maskValue(value) {
  if (value === null || value === undefined) return "(cleared)";
  const str = String(value);
  if (str.length <= 12) return `${str.slice(0, 2)}***`;
  return `${str.slice(0, 6)}...${str.slice(-4)} (${str.length} chars)`;
}

