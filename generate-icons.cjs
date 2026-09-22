// Source of truth for the KopyKat icon: a white "copy card" stack with a second
// card peeking behind it and the cat face knocked out of the front card so the
// terracotta gradient shows through. "on" = terracotta (sync active), "off" = gray.
//
// Node has no SVG rasterizer, so this script writes the two source SVGs. The
// shipped PNGs (icons/icon{16,48,128}[-off].png) were rasterized from these via
// a browser canvas. To re-rasterize after editing: open each SVG in a browser
// (or any SVG->PNG tool) and export at 16/48/128 px with a transparent
// background, keeping the same filenames.
const fs = require("fs");
const path = require("path");

const PALETTES = {
  on:  ["#f0ad82", "#e0895f", "#c65f43"], // terracotta
  off: ["#bdb7ac", "#9c968b", "#807a70"]  // warm gray
};

// eyesOpen -> awake cat (sync ON); closed -> sleeping cat (sync OFF)
function buildSVG(s, eyesOpen) {
  const eyes = eyesOpen
    ? `<circle cx="56" cy="60" r="4.6" fill="#fff"/>
    <circle cx="72" cy="60" r="4.6" fill="#fff"/>`
    : `<path d="M51 59 Q56 64 61 59" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <path d="M67 59 Q72 64 77 59" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${s[0]}"/><stop offset=".55" stop-color="${s[1]}"/><stop offset="1" stop-color="${s[2]}"/>
    </linearGradient>
    <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${s[0]}"/><stop offset=".55" stop-color="${s[1]}"/><stop offset="1" stop-color="${s[2]}"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="30" fill="url(#g)"/>
  <rect x="6" y="6" width="116" height="116" rx="30" fill="url(#sh)"/>
  <rect x="27" y="27" width="64" height="64" rx="18" fill="#fff" opacity=".5"/>
  <rect x="37" y="37" width="64" height="64" rx="18" fill="#fff"/>
  <g transform="translate(10.1,19.3) scale(0.92)">
    <path d="M40 54 L45 30 L60 48 A24 22 0 0 1 68 48 L83 30 L88 54 A25 27 0 0 1 40 54 Z" fill="url(#cat)"/>
    ${eyes}
    <path d="M60 69 h8 l-4 5 z" fill="#fff"/>
  </g>
</svg>`;
}

const outDir = path.join(__dirname, "icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "kopykat.svg"), buildSVG(PALETTES.on, true));
fs.writeFileSync(path.join(outDir, "kopykat-off.svg"), buildSVG(PALETTES.off, false));
console.log("wrote icons/kopykat.svg and icons/kopykat-off.svg");
console.log("Rasterize these to icon{16,48,128}[-off].png (transparent bg) to update the PNGs.");
