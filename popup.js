const $ = (s) => document.getElementById(s);
const enabledToggle = $("enabledToggle");
const originEl = $("origin");
const allowedEl = $("allowed");
const allowedTextEl = $("allowedText");
const keyCountEl = $("keyCount");
const lastSyncEl = $("lastSync");
const statusLed = $("statusLed");
const statusText = $("statusText");
const quickAdd = $("quickAdd");
const themeToggle = $("themeToggle");
const toastEl = $("toast");

let currentOrigin = "-";
let state = { enabled: false, mappings: [], syncKeys: [], allowedOrigins: [] };

/* ---------- theme ---------- */
(function initTheme() {
  try { const s = localStorage.getItem("kk-theme"); if (s) document.documentElement.setAttribute("data-theme", s); } catch {}
})();
themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark"
    || (!document.documentElement.hasAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("kk-theme", next); } catch {}
});

/* ---------- toast ---------- */
let toastTimer;
function toast(text) {
  toastEl.textContent = text;
  toastEl.className = "toast show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 2000);
}

/* ---------- matching ---------- */
function originMatches(origin, pattern) {
  if (pattern === origin) return true;
  if (!pattern || !pattern.includes("*")) return false;
  const rx = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return rx.test(origin);
}
const inList = (o, list) => (list || []).some((p) => originMatches(o, p));
const froms = () => state.mappings.map((m) => m.from);
const tos = () => state.mappings.flatMap((m) => m.to || []);

/* ---------- nav ---------- */
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("openAudit").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("audit.html") }));

/* ---------- render ---------- */
function relativeTime(ts) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
function renderStatus() {
  const gate = state.allowedOrigins || [];
  const passesGate = gate.length === 0 || inList(currentOrigin, gate);
  const isFrom = passesGate && inList(currentOrigin, froms());
  const isTo = passesGate && inList(currentOrigin, tos());
  const mapped = isFrom || isTo;

  allowedTextEl.textContent = mapped ? "Yes" : "No";
  allowedEl.className = `badge ${mapped ? "yes" : "no"}`;
  keyCountEl.textContent = state.syncKeys.length ? String(state.syncKeys.length) : "0";
  quickAdd.style.display = (!mapped && currentOrigin !== "-") ? "flex" : "none";

  const role = isFrom && isTo ? "from + to" : isFrom ? "source (from)" : isTo ? "destination (to)" : null;
  const hasFlow = state.mappings.some((m) => m.from && (m.to || []).length);

  if (!state.enabled) {
    statusLed.className = "status-led";
    statusText.textContent = "Sync engine off";
  } else if (!hasFlow) {
    statusLed.className = "status-led paused";
    statusText.textContent = "On — add a from → to mapping";
  } else if (!role) {
    statusLed.className = "status-led paused";
    statusText.textContent = "On — this origin isn't mapped";
  } else {
    statusLed.className = "status-led on";
    statusText.textContent = `Syncing · ${role}`;
  }
}

chrome.storage.local.get({ enabled: false, mappings: [], syncKeys: [], allowedOrigins: [] }, (settings) => {
  state = settings;
  enabledToggle.checked = settings.enabled;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try { currentOrigin = tabs[0]?.url ? new URL(tabs[0].url).origin : "-"; } catch { currentOrigin = "-"; }
    originEl.textContent = currentOrigin;
    originEl.title = currentOrigin;
    renderStatus();
  });
});

enabledToggle.addEventListener("change", () => {
  state.enabled = enabledToggle.checked;
  chrome.storage.local.set({ enabled: enabledToggle.checked });
  renderStatus();
});

// Not mapped yet → jump to Options to build a rule.
quickAdd.addEventListener("click", () => chrome.runtime.openOptionsPage());

const reloadTabs = $("reloadTabs");
const reloadTabsLabel = $("reloadTabsLabel");
reloadTabs.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RELOAD_MAPPED_TABS" }, (res) => {
    const n = res?.count ?? 0;
    reloadTabsLabel.textContent = n > 0 ? `Reloaded ${n} tab${n === 1 ? "" : "s"}` : "No mapped tabs open";
    setTimeout(() => (reloadTabsLabel.textContent = "Reload synced tabs"), 1800);
  });
});

/* ---------- clear-all modal ---------- */
const backdrop = $("backdrop");
$("clearAll").addEventListener("click", () => {
  const keys = state.syncKeys.length ? state.syncKeys.join(", ") : "the synced keys";
  $("modalBody").innerHTML = `This removes <b>${keys}</b> from every mapped tab now. Each app signs out until it sets the value again.`;
  backdrop.hidden = false;
});
$("cancelModal").addEventListener("click", () => (backdrop.hidden = true));
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.hidden = true; });
$("confirmModal").addEventListener("click", () => {
  backdrop.hidden = true;
  chrome.runtime.sendMessage({ type: "CLEAR_ALL_TABS" }, (res) => {
    const n = res?.cleared ?? 0;
    toast(n ? `Cleared on ${n} origin${n === 1 ? "" : "s"}` : "No mapped tabs open");
  });
});

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
  lastSyncEl.textContent = relativeTime(res?.lastEntry?.ts);
});
