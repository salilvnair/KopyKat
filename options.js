const enabledEl = document.getElementById("enabled");
const autoReloadEl = document.getElementById("autoReload");
const keysChipsEl = document.getElementById("keysChips");
const originsChipsEl = document.getElementById("originsChips");
const keyInputEl = document.getElementById("keyInput");
const originInputEl = document.getElementById("originInput");
const keysCountEl = document.getElementById("keysCount");
const originsCountEl = document.getElementById("originsCount");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const themeToggle = document.getElementById("themeToggle");

let syncKeys = [];
let allowedOrigins = [];

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

chrome.storage.local.get(
  { enabled: false, syncKeys: ["currentUserTokenState"], allowedOrigins: [], autoReloadOnUpdate: true },
  (res) => {
    enabledEl.checked = res.enabled;
    autoReloadEl.checked = res.autoReloadOnUpdate;
    syncKeys = [...res.syncKeys];
    allowedOrigins = [...res.allowedOrigins];
    renderChips(keysChipsEl, syncKeys, removeKey);
    renderChips(originsChipsEl, allowedOrigins, removeOrigin);
    updateCounts();
  }
);

function updateCounts() {
  keysCountEl.textContent = String(syncKeys.length);
  originsCountEl.textContent = String(allowedOrigins.length);
}

function renderChips(container, items, onRemove) {
  container.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("span");
    empty.className = "hint";
    empty.style.margin = "0";
    empty.textContent = "None added yet.";
    container.appendChild(empty);
    return;
  }
  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const text = document.createElement("span");
    text.className = "chip-text";
    text.textContent = item;
    text.title = item;
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item}`);
    remove.addEventListener("click", () => onRemove(item));
    chip.appendChild(text);
    chip.appendChild(remove);
    container.appendChild(chip);
  }
}

function addKey() {
  const value = keyInputEl.value.trim();
  if (!value || syncKeys.includes(value)) return;
  syncKeys.push(value);
  keyInputEl.value = "";
  renderChips(keysChipsEl, syncKeys, removeKey);
  updateCounts();
}

function removeKey(value) {
  syncKeys = syncKeys.filter((k) => k !== value);
  renderChips(keysChipsEl, syncKeys, removeKey);
  updateCounts();
}

function normalizeOrigin(raw) {
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

function addOrigin() {
  const value = normalizeOrigin(originInputEl.value.trim());
  if (!value || allowedOrigins.includes(value)) return;
  allowedOrigins.push(value);
  originInputEl.value = "";
  renderChips(originsChipsEl, allowedOrigins, removeOrigin);
  updateCounts();
}

function removeOrigin(value) {
  allowedOrigins = allowedOrigins.filter((o) => o !== value);
  renderChips(originsChipsEl, allowedOrigins, removeOrigin);
  updateCounts();
}

document.getElementById("addKey").addEventListener("click", addKey);
keyInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addKey();
  }
});

document.getElementById("addOrigin").addEventListener("click", addOrigin);
originInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addOrigin();
  }
});

function flashStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.add("show");
  setTimeout(() => statusEl.classList.remove("show"), 1600);
}

saveBtn.addEventListener("click", () => {
  chrome.storage.local.set(
    { enabled: enabledEl.checked, syncKeys, allowedOrigins, autoReloadOnUpdate: autoReloadEl.checked },
    () => flashStatus("✓ Saved")
  );
});

/* ---------- first-run onboarding ---------- */
const welcome = document.getElementById("welcome");
if (new URLSearchParams(location.search).get("welcome") === "1") {
  welcome.hidden = false;
}
document.getElementById("welcomeDismiss").addEventListener("click", () => {
  welcome.hidden = true;
});

/* ---------- export / import config ---------- */
document.getElementById("exportBtn").addEventListener("click", () => {
  const config = {
    app: "KopyKat",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      enabled: enabledEl.checked,
      syncKeys,
      allowedOrigins,
      autoReloadOnUpdate: autoReloadEl.checked
    }
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kopykat-config.json";
  a.click();
  URL.revokeObjectURL(url);
  flashStatus("✓ Exported");
});

const importFile = document.getElementById("importFile");
document.getElementById("importBtn").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const s = parsed.settings ?? parsed; // accept bare settings too
      if (Array.isArray(s.syncKeys)) syncKeys = s.syncKeys.filter((x) => typeof x === "string");
      if (Array.isArray(s.allowedOrigins)) allowedOrigins = s.allowedOrigins.filter((x) => typeof x === "string");
      if (typeof s.enabled === "boolean") enabledEl.checked = s.enabled;
      if (typeof s.autoReloadOnUpdate === "boolean") autoReloadEl.checked = s.autoReloadOnUpdate;
      renderChips(keysChipsEl, syncKeys, removeKey);
      renderChips(originsChipsEl, allowedOrigins, removeOrigin);
      updateCounts();
      flashStatus("✓ Imported — review, then Save");
    } catch {
      flashStatus("✗ Invalid file");
    }
    importFile.value = "";
  };
  reader.readAsText(file);
});
