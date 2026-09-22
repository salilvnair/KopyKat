const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("empty");
const emptyTextEl = document.getElementById("emptyText");
const eventCountEl = document.getElementById("eventCount");
const searchEl = document.getElementById("search");
const themeToggle = document.getElementById("themeToggle");

let auditLog = [];

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

function matchesFilter(entry, q) {
  if (!q) return true;
  const hay = [
    entry.key,
    entry.fromOrigin,
    (entry.toOrigins || []).join(" "),
    (entry.unreachableOrigins || []).join(" "),
    entry.valuePreview
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = auditLog.filter((e) => matchesFilter(e, q));
  rowsEl.innerHTML = "";

  eventCountEl.textContent = `${auditLog.length} event${auditLog.length === 1 ? "" : "s"}`;

  if (filtered.length === 0) {
    emptyEl.style.display = "block";
    emptyTextEl.textContent = auditLog.length === 0
      ? "No sync events recorded yet."
      : "No events match your filter.";
    return;
  }
  emptyEl.style.display = "none";

  for (const entry of filtered) {
    const tr = document.createElement("tr");

    const time = document.createElement("td");
    time.className = "time-cell";
    time.textContent = new Date(entry.ts).toLocaleString();

    const key = document.createElement("td");
    const keyBadge = document.createElement("span");
    keyBadge.className = "key-badge";
    keyBadge.textContent = entry.key;
    key.appendChild(keyBadge);

    const from = document.createElement("td");
    from.className = "origin-cell";
    from.textContent = entry.fromOrigin;

    const to = document.createElement("td");
    to.className = "origin-cell";
    if (entry.toOrigins?.length) {
      const ok = document.createElement("span");
      ok.className = "to-line pill-ok";
      ok.textContent = `→ ${entry.toOrigins.join(", ")}`;
      to.appendChild(ok);
    }
    if (entry.unreachableOrigins?.length) {
      const warn = document.createElement("span");
      warn.className = "to-line pill-warn";
      warn.textContent = `⚠ unreachable: ${entry.unreachableOrigins.join(", ")} (open/reload tab)`;
      to.appendChild(warn);
    }
    if (!entry.toOrigins?.length && !entry.unreachableOrigins?.length) {
      const none = document.createElement("span");
      none.className = "to-line pill-none";
      none.textContent = "(no allow-listed tab open)";
      to.appendChild(none);
    }

    const value = document.createElement("td");
    const val = document.createElement("span");
    val.className = "value-preview";
    val.textContent = entry.valuePreview;
    value.appendChild(val);

    tr.append(time, key, from, to, value);
    rowsEl.appendChild(tr);
  }
}

searchEl.addEventListener("input", render);

chrome.runtime.sendMessage({ type: "GET_AUDIT" }, (res) => {
  auditLog = res?.auditLog ?? [];
  render();
});

document.getElementById("clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_AUDIT" }, () => {
    auditLog = [];
    render();
  });
});
