const enabledToggle = document.getElementById("enabledToggle");
const originEl = document.getElementById("origin");
const allowedEl = document.getElementById("allowed");
const allowedTextEl = document.getElementById("allowedText");
const keyCountEl = document.getElementById("keyCount");
const lastSyncEl = document.getElementById("lastSync");
const statusLed = document.getElementById("statusLed");
const statusText = document.getElementById("statusText");
const quickAdd = document.getElementById("quickAdd");
const themeToggle = document.getElementById("themeToggle");

let currentOrigin = "-";
let state = { enabled: false, allowedOrigins: [], syncKeys: [] };

/* ---------- theme ---------- */
(function initTheme() {
  const saved = localStorage.getItem("kk-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark"
    || (!document.documentElement.hasAttribute("data-theme")
        && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("kk-theme", next); } catch {}
});

/* ---------- nav ---------- */
document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("openAudit").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("audit.html") });
});

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
  const isAllowed = state.allowedOrigins.includes(currentOrigin);

  allowedTextEl.textContent = isAllowed ? "Yes" : "No";
  allowedEl.className = `badge ${isAllowed ? "yes" : "no"}`;
  keyCountEl.textContent = state.syncKeys.length ? String(state.syncKeys.length) : "0";
  quickAdd.style.display = (!isAllowed && currentOrigin !== "-") ? "flex" : "none";

  if (!state.enabled) {
    statusLed.className = "status-led";
    statusText.textContent = "Sync engine off";
  } else if (state.allowedOrigins.length === 0) {
    statusLed.className = "status-led paused";
    statusText.textContent = "On — no origins allow-listed";
  } else if (!isAllowed) {
    statusLed.className = "status-led paused";
    statusText.textContent = "On — this origin not synced";
  } else {
    statusLed.className = "status-led on";
    statusText.textContent = "Syncing this origin";
  }
}

chrome.storage.local.get(
  { enabled: false, allowedOrigins: [], syncKeys: [] },
  (settings) => {
    state = settings;
    enabledToggle.checked = settings.enabled;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      try {
        currentOrigin = tabs[0]?.url ? new URL(tabs[0].url).origin : "-";
      } catch {
        currentOrigin = "-";
      }
      originEl.textContent = currentOrigin;
      originEl.title = currentOrigin;
      renderStatus();
    });
  }
);

enabledToggle.addEventListener("change", () => {
  state.enabled = enabledToggle.checked;
  chrome.storage.local.set({ enabled: enabledToggle.checked });
  renderStatus();
});

quickAdd.addEventListener("click", () => {
  if (currentOrigin === "-" || state.allowedOrigins.includes(currentOrigin)) return;
  state.allowedOrigins = [...state.allowedOrigins, currentOrigin];
  chrome.storage.local.set({ allowedOrigins: state.allowedOrigins });
  renderStatus();
});

const reloadTabs = document.getElementById("reloadTabs");
const reloadTabsLabel = document.getElementById("reloadTabsLabel");
reloadTabs.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RELOAD_ALLOWED_TABS" }, (res) => {
    const n = res?.count ?? 0;
    reloadTabsLabel.textContent = n > 0 ? `Reloaded ${n} tab${n === 1 ? "" : "s"}` : "No synced tabs open";
    setTimeout(() => (reloadTabsLabel.textContent = "Reload synced tabs"), 1800);
  });
});

const clearAll = document.getElementById("clearAll");
const clearAllLabel = document.getElementById("clearAllLabel");
clearAll.addEventListener("click", () => {
  const keys = state.syncKeys?.length ? state.syncKeys.join(", ") : "the synced keys";
  if (!confirm(`Remove ${keys} from every allow-listed tab now? Each app will be signed out until it sets the value again.`)) return;
  chrome.runtime.sendMessage({ type: "CLEAR_ALL_TABS" }, (res) => {
    const n = res?.cleared ?? 0;
    clearAllLabel.textContent = n > 0 ? `Cleared on ${n} origin${n === 1 ? "" : "s"}` : "No synced tabs open";
    setTimeout(() => (clearAllLabel.textContent = "Clear synced keys everywhere"), 1900);
  });
});

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
  lastSyncEl.textContent = relativeTime(res?.lastEntry?.ts);
});
