const $ = (s) => document.querySelector(s);
const enabledEl = $("#enabled");
const autoReloadEl = $("#autoReload");
const themeToggle = $("#themeToggle");
const toastEl = $("#toast");

let syncKeys = [];
let mappings = []; // [{from, to:[...]}]
let allowedOrigins = []; // optional gatekeeper

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

/* ---------- shared bits ---------- */
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" stroke-width="2"/></svg>';
function copyText(t) { navigator.clipboard?.writeText(t).then(() => toast("Copied ✓"), () => toast("Copied ✓")); }
function normalizeOrigin(raw) {
  if (raw.includes("*")) return raw;
  try { return new URL(raw).origin; } catch { return raw; }
}
function chip(text, cls, onRemove) {
  const c = document.createElement("span");
  c.className = "chip" + (cls ? " " + cls : "");
  const t = document.createElement("span");
  t.className = "chip-text"; t.textContent = text; t.title = text;
  const cp = document.createElement("button");
  cp.className = "chip-cp"; cp.innerHTML = COPY_ICON; cp.title = "Copy"; cp.type = "button";
  cp.addEventListener("click", () => copyText(text));
  c.append(t, cp);
  if (onRemove) {
    const rm = document.createElement("button");
    rm.className = "chip-rm"; rm.textContent = "×"; rm.type = "button";
    rm.setAttribute("aria-label", `Remove ${text}`);
    rm.addEventListener("click", onRemove);
    c.append(rm);
  }
  return c;
}

/* ---------- keys ---------- */
const keysChips = $("#keysChips");
const keyInput = $("#keyInput");
function renderKeys() {
  $("#keysCount").textContent = String(syncKeys.length);
  keysChips.innerHTML = "";
  if (!syncKeys.length) {
    const e = document.createElement("span"); e.className = "hint"; e.style.margin = "0"; e.textContent = "None added yet.";
    keysChips.append(e); return;
  }
  syncKeys.forEach((k, i) => keysChips.append(chip(k, "", () => { syncKeys.splice(i, 1); renderKeys(); })));
}
function addKey() {
  const v = keyInput.value.trim();
  if (!v || syncKeys.includes(v)) return;
  syncKeys.push(v); keyInput.value = ""; renderKeys();
}
$("#addKey").addEventListener("click", addKey);
keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addKey(); } });

// bulk edit
$("#bulkToggle").addEventListener("click", () => {
  const chipsHidden = $("#keysChipsWrap").hidden;
  if (!chipsHidden) {
    $("#keysBulk").value = syncKeys.join(", ");
    $("#keysChipsWrap").hidden = true;
    $("#keysBulkWrap").hidden = false;
    $("#bulkToggleLabel").textContent = "Chip view";
  } else {
    applyBulk();
    $("#keysBulkWrap").hidden = true;
    $("#keysChipsWrap").hidden = false;
    $("#bulkToggleLabel").textContent = "Bulk edit";
  }
});
function applyBulk() {
  syncKeys = $("#keysBulk").value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  renderKeys();
}
$("#bulkDone").addEventListener("click", () => $("#bulkToggle").click());
$("#bulkCopy").addEventListener("click", () => copyText($("#keysBulk").value));

/* ---------- sync map table ---------- */
const DEL_ICON = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function renderMap() {
  $("#mapCount").textContent = String(mappings.length);
  const box = $("#mapTable"); box.innerHTML = "";
  if (!mappings.length) {
    const e = document.createElement("div"); e.className = "map-empty"; e.textContent = "No mappings yet — add a source origin below.";
    box.append(e); return;
  }
  const table = document.createElement("table"); table.className = "map-table";
  table.innerHTML = '<thead><tr><th class="col-from">From (source)</th><th class="col-to">To (destinations)</th><th class="col-act"></th></tr></thead>';
  const tb = document.createElement("tbody");
  mappings.forEach((rule, i) => {
    const tr = document.createElement("tr");
    const tdF = document.createElement("td");
    tdF.append(chip(rule.from, "from-cell"));
    const tdT = document.createElement("td"); tdT.className = "col-to";
    const chips = document.createElement("div"); chips.className = "chips";
    (rule.to || []).forEach((d, j) => chips.append(chip(d, "to", () => { rule.to.splice(j, 1); renderMap(); })));
    if (!(rule.to || []).length) {
      const em = document.createElement("span"); em.className = "muted-hint"; em.textContent = "No destinations yet"; chips.append(em);
    }
    tdT.append(chips);
    const add = document.createElement("div"); add.className = "add-row compact";
    const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "add destination…";
    const b = document.createElement("button"); b.className = "btn-primary sm"; b.textContent = "Add";
    const addDest = () => { const v = normalizeOrigin(inp.value.trim()); if (v && !(rule.to || []).includes(v)) { (rule.to ||= []).push(v); renderMap(); } };
    b.addEventListener("click", addDest);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addDest(); } });
    add.append(inp, b); tdT.append(add);
    const tdA = document.createElement("td"); tdA.className = "col-act";
    const del = document.createElement("button"); del.className = "rowdel"; del.innerHTML = DEL_ICON; del.title = "Delete rule";
    del.addEventListener("click", () => { mappings.splice(i, 1); renderMap(); });
    tdA.append(del);
    tr.append(tdF, tdT, tdA); tb.append(tr);
  });
  table.append(tb); box.append(table);
}
$("#addRule").addEventListener("click", () => {
  const v = normalizeOrigin($("#newFrom").value.trim());
  if (!v) return;
  mappings.push({ from: v, to: [] }); $("#newFrom").value = ""; renderMap();
});
$("#newFrom").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#addRule").click(); } });

/* ---------- allowed origins (optional gatekeeper) ---------- */
const allowedChips = $("#allowedChips");
const allowedInput = $("#allowedInput");
function renderAllowed() {
  $("#allowedCount").textContent = String(allowedOrigins.length);
  allowedChips.innerHTML = "";
  if (!allowedOrigins.length) {
    const e = document.createElement("span"); e.className = "hint"; e.style.margin = "0";
    e.textContent = "Empty — the sync map governs (no extra fence).";
    allowedChips.append(e); return;
  }
  allowedOrigins.forEach((o, i) => allowedChips.append(chip(o, "", () => { allowedOrigins.splice(i, 1); renderAllowed(); })));
}
function addAllowed() {
  const v = normalizeOrigin(allowedInput.value.trim());
  if (!v || allowedOrigins.includes(v)) return;
  allowedOrigins.push(v); allowedInput.value = ""; renderAllowed();
}
$("#addAllowed").addEventListener("click", addAllowed);
allowedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addAllowed(); } });

/* ---------- load ---------- */
chrome.storage.local.get(
  { enabled: false, syncKeys: ["currentUser"], mappings: [], allowedOrigins: [], autoReloadOnUpdate: true },
  (res) => {
    enabledEl.checked = res.enabled;
    autoReloadEl.checked = res.autoReloadOnUpdate;
    syncKeys = [...res.syncKeys];
    mappings = (res.mappings || []).map((m) => ({ from: m.from, to: [...(m.to || [])] }));
    allowedOrigins = [...(res.allowedOrigins || [])];
    renderKeys();
    renderMap();
    renderAllowed();
  }
);

/* ---------- save ---------- */
$("#save").addEventListener("click", () => {
  if (!$("#keysBulkWrap").hidden) applyBulk();
  const clean = mappings.filter((m) => m.from).map((m) => ({ from: m.from, to: [...new Set(m.to || [])] }));
  chrome.storage.local.set(
    { enabled: enabledEl.checked, syncKeys, mappings: clean, allowedOrigins, autoReloadOnUpdate: autoReloadEl.checked },
    () => toast("✓ Settings saved")
  );
});

/* ---------- onboarding ---------- */
const welcome = $("#welcome");
if (new URLSearchParams(location.search).get("welcome") === "1") welcome.hidden = false;
$("#welcomeDismiss").addEventListener("click", () => (welcome.hidden = true));

/* ---------- export / import ---------- */
$("#exportBtn").addEventListener("click", () => {
  const config = {
    app: "KopyKat", version: 3, exportedAt: new Date().toISOString(),
    settings: { enabled: enabledEl.checked, syncKeys, mappings, allowedOrigins, autoReloadOnUpdate: autoReloadEl.checked }
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "kopykat-config.json"; a.click();
  URL.revokeObjectURL(url); toast("✓ Config exported");
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
      if (Array.isArray(s.syncKeys)) syncKeys = s.syncKeys.filter((x) => typeof x === "string");
      if (Array.isArray(s.mappings)) {
        mappings = s.mappings.filter((m) => m && typeof m.from === "string")
          .map((m) => ({ from: m.from, to: Array.isArray(m.to) ? m.to.filter((x) => typeof x === "string") : [] }));
      }
      if (Array.isArray(s.allowedOrigins)) allowedOrigins = s.allowedOrigins.filter((x) => typeof x === "string");
      if (typeof s.enabled === "boolean") enabledEl.checked = s.enabled;
      if (typeof s.autoReloadOnUpdate === "boolean") autoReloadEl.checked = s.autoReloadOnUpdate;
      renderKeys(); renderMap(); renderAllowed();
      toast("✓ Imported — review, then Save");
    } catch { toast("✗ Invalid config file", "bad"); }
    importFile.value = "";
  };
  reader.readAsText(file);
});
