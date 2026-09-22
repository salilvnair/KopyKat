const enabledEl = document.getElementById("enabled");
const autoReloadEl = document.getElementById("autoReload");
const saveBtn = document.getElementById("save");
const toastEl = document.getElementById("toast");
const themeToggle = document.getElementById("themeToggle");

let syncKeys = [];
let allowedOrigins = [];
let fromOrigins = [];
let toOrigins = [];

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

/* ---------- toast ---------- */
let toastTimer;
function toast(text, kind = "ok") {
  toastEl.textContent = text;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 2200);
}

/* ---------- reusable chip list (keys / allowed / from / to) ---------- */
function normalizeOrigin(raw) {
  if (raw.includes("*")) return raw; // wildcard patterns aren't valid URLs
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

function makeList({ chipsId, inputId, addId, countId, get, set, normalize }) {
  const chipsEl = document.getElementById(chipsId);
  const inputEl = document.getElementById(inputId);
  const countEl = document.getElementById(countId);

  function render() {
    const items = get();
    countEl.textContent = String(items.length);
    chipsEl.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("span");
      empty.className = "hint";
      empty.style.margin = "0";
      empty.textContent = "None added yet.";
      chipsEl.appendChild(empty);
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
      remove.addEventListener("click", () => {
        set(get().filter((x) => x !== item));
        render();
      });
      chip.append(text, remove);
      chipsEl.appendChild(chip);
    }
  }

  function add() {
    const raw = inputEl.value.trim();
    const value = normalize ? normalize(raw) : raw;
    if (!value || get().includes(value)) return;
    set([...get(), value]);
    inputEl.value = "";
    render();
  }

  document.getElementById(addId).addEventListener("click", add);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });

  return { render };
}

const keysList = makeList({
  chipsId: "keysChips", inputId: "keyInput", addId: "addKey", countId: "keysCount",
  get: () => syncKeys, set: (v) => (syncKeys = v)
});
const allowedList = makeList({
  chipsId: "originsChips", inputId: "originInput", addId: "addOrigin", countId: "originsCount",
  get: () => allowedOrigins, set: (v) => (allowedOrigins = v), normalize: normalizeOrigin
});
const fromList = makeList({
  chipsId: "fromChips", inputId: "fromInput", addId: "addFrom", countId: "fromCount",
  get: () => fromOrigins, set: (v) => (fromOrigins = v), normalize: normalizeOrigin
});
const toList = makeList({
  chipsId: "toChips", inputId: "toInput", addId: "addTo", countId: "toCount",
  get: () => toOrigins, set: (v) => (toOrigins = v), normalize: normalizeOrigin
});

function renderAll() {
  keysList.render();
  allowedList.render();
  fromList.render();
  toList.render();
}

/* ---------- load ---------- */
chrome.storage.local.get(
  {
    enabled: false,
    syncKeys: ["currentUserTokenState"],
    allowedOrigins: [],
    fromOrigins: [],
    toOrigins: [],
    autoReloadOnUpdate: true
  },
  (res) => {
    enabledEl.checked = res.enabled;
    autoReloadEl.checked = res.autoReloadOnUpdate;
    syncKeys = [...res.syncKeys];
    allowedOrigins = [...res.allowedOrigins];
    fromOrigins = [...res.fromOrigins];
    toOrigins = [...res.toOrigins];
    renderAll();
  }
);

/* ---------- save ---------- */
saveBtn.addEventListener("click", () => {
  chrome.storage.local.set(
    {
      enabled: enabledEl.checked,
      syncKeys,
      allowedOrigins,
      fromOrigins,
      toOrigins,
      autoReloadOnUpdate: autoReloadEl.checked
    },
    () => toast("✓ Settings saved")
  );
});

/* ---------- first-run onboarding ---------- */
const welcome = document.getElementById("welcome");
if (new URLSearchParams(location.search).get("welcome") === "1") welcome.hidden = false;
document.getElementById("welcomeDismiss").addEventListener("click", () => (welcome.hidden = true));

/* ---------- export / import config ---------- */
document.getElementById("exportBtn").addEventListener("click", () => {
  const config = {
    app: "KopyKat",
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: {
      enabled: enabledEl.checked,
      syncKeys,
      allowedOrigins,
      fromOrigins,
      toOrigins,
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
  toast("✓ Config exported");
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
      const s = parsed.settings ?? parsed;
      const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : undefined);
      if (strs(s.syncKeys)) syncKeys = strs(s.syncKeys);
      if (strs(s.allowedOrigins)) allowedOrigins = strs(s.allowedOrigins);
      if (strs(s.fromOrigins)) fromOrigins = strs(s.fromOrigins);
      if (strs(s.toOrigins)) toOrigins = strs(s.toOrigins);
      if (typeof s.enabled === "boolean") enabledEl.checked = s.enabled;
      if (typeof s.autoReloadOnUpdate === "boolean") autoReloadEl.checked = s.autoReloadOnUpdate;
      renderAll();
      toast("✓ Imported — review, then Save");
    } catch {
      toast("✗ Invalid config file", "bad");
    }
    importFile.value = "";
  };
  reader.readAsText(file);
});
