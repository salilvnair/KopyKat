const $ = (s) => document.querySelector(s);
const rowsEl = $("#rows");
const emptyEl = $("#empty");
const emptyTextEl = $("#emptyText");
const eventCountEl = $("#eventCount");
const searchEl = $("#search");
const themeToggle = $("#themeToggle");
const toastEl = $("#toast");

let auditLog = [];

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
function toast(text, kind = "ok") {
  toastEl.textContent = text;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 2200);
}

/* ---------- render ---------- */
function matchesFilter(entry, q) {
  if (!q) return true;
  const hay = [entry.key, entry.fromOrigin, (entry.toOrigins || []).join(" "), entry.valuePreview].join(" ").toLowerCase();
  return hay.includes(q);
}
function render() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = auditLog.filter((e) => matchesFilter(e, q));
  rowsEl.innerHTML = "";
  eventCountEl.textContent = `${auditLog.length} event${auditLog.length === 1 ? "" : "s"}`;
  if (!filtered.length) {
    emptyEl.style.display = "block";
    emptyTextEl.textContent = auditLog.length === 0 ? "No sync events recorded yet." : "No events match your filter.";
    return;
  }
  emptyEl.style.display = "none";
  for (const entry of filtered) {
    const tr = document.createElement("tr");
    const time = document.createElement("td"); time.className = "time-cell"; time.textContent = new Date(entry.ts).toLocaleString();
    const key = document.createElement("td");
    const kb = document.createElement("span"); kb.className = "key-badge"; kb.textContent = entry.key; key.append(kb);
    const from = document.createElement("td"); from.className = "origin-cell"; from.textContent = entry.fromOrigin;
    const to = document.createElement("td"); to.className = "origin-cell";
    const ok = document.createElement("span"); ok.className = "pill-ok"; ok.textContent = "→ " + (entry.toOrigins || []).join(", "); to.append(ok);
    const val = document.createElement("td");
    const v = document.createElement("span"); v.className = "value-preview"; v.textContent = entry.valuePreview; val.append(v);
    tr.append(time, key, from, to, val);
    rowsEl.appendChild(tr);
  }
}
searchEl.addEventListener("input", render);

chrome.runtime.sendMessage({ type: "GET_AUDIT" }, (res) => { auditLog = res?.auditLog ?? []; render(); });

/* ---------- clear log ---------- */
$("#clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_AUDIT" }, () => { auditLog = []; render(); toast("Audit log cleared"); });
});

/* ---------- sync tabs ---------- */
$("#syncTabs").addEventListener("click", () => {
  const label = $("#syncTabsLabel");
  chrome.runtime.sendMessage({ type: "RELOAD_MAPPED_TABS" }, (res) => {
    const n = res?.count ?? 0;
    label.textContent = n ? `Reloaded ${n}` : "No mapped tabs";
    setTimeout(() => (label.textContent = "Sync tabs"), 1800);
  });
});

/* ---------- export / import ---------- */
$("#exportBtn").addEventListener("click", () => {
  chrome.storage.local.get(
    { enabled: false, syncKeys: [], mappings: [], autoReloadOnUpdate: true },
    (s) => {
      const config = { app: "KopyKat", version: 3, exportedAt: new Date().toISOString(), settings: s };
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "kopykat-config.json"; a.click();
      URL.revokeObjectURL(url); toast("✓ Config exported");
    }
  );
});
const importFile = $("#importFile");
$("#importBtn").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const s = parsed.settings ?? parsed;
      const patch = {};
      if (Array.isArray(s.syncKeys)) patch.syncKeys = s.syncKeys.filter((x) => typeof x === "string");
      if (Array.isArray(s.mappings)) {
        patch.mappings = s.mappings.filter((m) => m && typeof m.from === "string")
          .map((m) => ({ from: m.from, to: Array.isArray(m.to) ? m.to.filter((x) => typeof x === "string") : [] }));
      }
      if (typeof s.enabled === "boolean") patch.enabled = s.enabled;
      if (typeof s.autoReloadOnUpdate === "boolean") patch.autoReloadOnUpdate = s.autoReloadOnUpdate;
      chrome.storage.local.set(patch, () => toast("✓ Config imported"));
    } catch { toast("✗ Invalid config file", "bad"); }
    importFile.value = "";
  };
  reader.readAsText(file);
});

/* ---------- clear keys everywhere (modal) ---------- */
const backdrop = $("#backdrop");
function openModal() {
  chrome.storage.local.get({ syncKeys: [], mappings: [] }, (s) => {
    const keys = s.syncKeys.length ? s.syncKeys.join(", ") : "the synced keys";
    $("#modalBody").innerHTML = `This removes <b>${keys}</b> from every mapped destination tab right now. Each app will be signed out until it sets the value again.`;
    const targets = [...new Set((s.mappings || []).flatMap((m) => m.to || []))];
    const box = $("#modalTargets"); box.innerHTML = "";
    targets.forEach((t) => { const c = document.createElement("span"); c.className = "chip to"; c.textContent = t; box.append(c); });
    backdrop.hidden = false;
  });
}
function closeModal() { backdrop.hidden = true; }
$("#clearKeys").addEventListener("click", openModal);
$("#cancelModal").addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) closeModal(); });
$("#confirmModal").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_ALL_TABS" }, (res) => {
    closeModal();
    const n = res?.cleared ?? 0;
    toast(n ? `Cleared on ${n} origin${n === 1 ? "" : "s"}` : "No mapped tabs open");
    chrome.runtime.sendMessage({ type: "GET_AUDIT" }, (r) => { auditLog = r?.auditLog ?? []; render(); });
  });
});
