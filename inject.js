// Runs in the page's MAIN world (see manifest content_scripts). Wraps the page's
// own sessionStorage mutators so a write is broadcast the instant it happens,
// instead of waiting for the isolated content script's polling loop.
//
// It only dispatches a same-page CustomEvent; content.js (isolated world) listens,
// applies the allow-list/enabled gate, and decides whether to report. Nothing here
// touches chrome.* or leaves the page. Applies from content.js use the isolated
// world's native setItem, so they never re-trigger this patch (no echo loop).
(() => {
  const proto = window.Storage && window.Storage.prototype;
  if (!proto || proto.__kkPatched) return;
  proto.__kkPatched = true;

  const fire = (key, value) => {
    try {
      window.dispatchEvent(new CustomEvent("kk-session-write", { detail: { key, value } }));
    } catch {}
  };

  const rawSet = proto.setItem;
  const rawRemove = proto.removeItem;
  const rawClear = proto.clear;

  proto.setItem = function (key, value) {
    const result = rawSet.apply(this, arguments);
    if (this === window.sessionStorage) fire(key, String(value));
    return result;
  };

  proto.removeItem = function (key) {
    const result = rawRemove.apply(this, arguments);
    if (this === window.sessionStorage) fire(key, null);
    return result;
  };

  proto.clear = function () {
    const result = rawClear.apply(this, arguments);
    if (this === window.sessionStorage) fire(null, null); // null key = "everything cleared"
    return result;
  };
})();
