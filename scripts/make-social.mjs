// Renders the social/brand asset suite from the game's design system,
// pixel-true via headless Chromium. Output: social/*.png (+ public/og.png).
// Run: node scripts/make-social.mjs
import { chromium } from "playwright";
import { mkdirSync, copyFileSync } from "node:fs";

const OUT = new URL("../social/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`;

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --paper: #f2ecdd; --ink: #1b1a14; --green: #0e7c66;
    --sunset: #e8542f; --gold: #d9a521;
  }
  body {
    font-family: "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
    width: 100vw; height: 100vh; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  body::after {
    content: ""; position: fixed; inset: 0; pointer-events: none; opacity: 0.055;
    background-image: ${GRAIN};
  }
  .stripes { display: flex; flex-direction: column; gap: calc(var(--u) * 0.45); width: 100%; }
  .stripes div { height: calc(var(--u) * 1.1); border: calc(var(--u) * 0.3) solid var(--ink); }
  .s1 { background: var(--sunset); } .s2 { background: var(--gold); } .s3 { background: var(--green); }
  .wordmark {
    font-weight: 800; color: var(--ink); letter-spacing: 0.01em;
    font-size: var(--wm, calc(var(--u) * 7.2)); line-height: 0.95; white-space: nowrap;
  }
  .y26 { font-weight: 800; color: var(--sunset); transform: rotate(7deg); display: inline-block; }
  .tagline {
    font-weight: 700; letter-spacing: 0.18em; color: #4a463a;
    font-size: calc(var(--u) * 1.35); white-space: nowrap;
  }
  .pill {
    display: inline-block; background: var(--green); color: var(--paper);
    border: calc(var(--u) * 0.32) solid var(--ink); border-radius: calc(var(--u) * 0.6);
    box-shadow: calc(var(--u) * 0.45) calc(var(--u) * 0.45) 0 var(--ink);
    font-weight: 800; letter-spacing: 0.08em;
    font-size: calc(var(--u) * 1.5); padding: calc(var(--u) * 0.7) calc(var(--u) * 1.6);
  }
  .ballrow { display: flex; align-items: center; gap: calc(var(--u) * 1.4); width: 100%; }
  .ballrow .line { flex: 1; height: calc(var(--u) * 0.32); background: var(--ink); }
  svg.ball { display: block; }
`;

function ball(size) {
  const r = size / 2;
  const d = (f) => r * f;
  return `<svg class="ball" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${r}" cy="${r}" r="${r - d(0.08)}" fill="#f7f4e8" stroke="#1b1a14" stroke-width="${d(0.12)}"/>
    <circle cx="${r}" cy="${r}" r="${d(0.24)}" fill="#1b1a14"/>
    <circle cx="${d(0.46)}" cy="${d(0.62)}" r="${d(0.15)}" fill="#1b1a14"/>
    <circle cx="${d(1.54)}" cy="${d(0.62)}" r="${d(0.15)}" fill="#1b1a14"/>
    <circle cx="${d(0.62)}" cy="${d(1.54)}" r="${d(0.15)}" fill="#1b1a14"/>
    <circle cx="${d(1.38)}" cy="${d(1.54)}" r="${d(0.15)}" fill="#1b1a14"/>
  </svg>`;
}

// each asset: [name, width, height, html, bodyStyle]
const lockup = (u, opts = {}) => `
  <div style="--u:${u}px; --wm:${opts.wm ?? 130}px; width: ${opts.width ?? "auto"}; display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 1.1);">
    <div class="stripes"><div class="s1"></div><div class="s2"></div><div class="s3"></div></div>
    <div class="wordmark">MUNDIALITO&hairsp;<span class="y26" style="font-size: calc(var(--wm) * 0.46)">’26</span></div>
    <div class="ballrow"><div class="line"></div>${ball(u * 4.6)}<div class="line"></div></div>
    ${opts.tagline ? `<div class="tagline">DRAFT · FLICK · LIFT THE TROPHY</div>` : ""}
    ${opts.pill ? `<div class="pill">${opts.pill}</div>` : ""}
  </div>`;

const assets = [
  // circle-safe avatars: ball + stripe band, content well inside the crop
  ["avatar-green-1024", 1024, 1024, `
    <div style="--u:34px; width: 660px; display: flex; flex-direction: column; align-items: center; gap: 64px;">
      <div class="stripes"><div class="s1"></div><div class="s2"></div><div class="s3"></div></div>
      ${ball(390)}
    </div>`, "background: var(--green);"],
  ["avatar-cream-1024", 1024, 1024, `
    <div style="--u:34px; width: 660px; display: flex; flex-direction: column; align-items: center; gap: 64px;">
      <div class="stripes"><div class="s1"></div><div class="s2"></div><div class="s3"></div></div>
      ${ball(390)}
      <div style="font-weight: 800; font-size: 118px; color: var(--ink); line-height: 1;">M’26</div>
    </div>`, "background: var(--paper);"],
  // wide link-preview card (also becomes public/og.png)
  ["og-1200x630", 1200, 630,
    lockup(30, { width: "820px", wm: 124, tagline: true }), "background: var(--paper);"],
  // X / Twitter header
  ["header-x-1500x500", 1500, 500, `
    <div style="--u:26px; display: flex; align-items: center; gap: 90px;">
      ${ball(240)}
      <div style="--wm:112px; display: flex; flex-direction: column; gap: 26px; width: 760px;">
        <div class="stripes"><div class="s1"></div><div class="s2"></div><div class="s3"></div></div>
        <div class="wordmark">MUNDIALITO&hairsp;<span class="y26" style="font-size: 52px">’26</span></div>
        <div class="tagline">DRAFT · FLICK · LIFT THE TROPHY</div>
      </div>
    </div>`, "background: var(--paper);"],
  // Instagram / general square poster
  ["square-1080", 1080, 1080,
    lockup(34, { width: "820px", wm: 124, tagline: true, pill: "FREE BROWSER GAME · REAL 2026 SQUADS" }),
    "background: var(--paper);"],
  // Ko-fi cover
  ["kofi-cover-1410x470", 1410, 470, `
    <div style="--u:24px; display: flex; align-items: center; gap: 80px;">
      ${ball(220)}
      <div style="--wm:102px; display: flex; flex-direction: column; gap: 24px; width: 700px;">
        <div class="stripes"><div class="s1"></div><div class="s2"></div><div class="s3"></div></div>
        <div class="wordmark">MUNDIALITO&hairsp;<span class="y26" style="font-size: 48px">’26</span></div>
        <div class="tagline">SUPPORT THE POCKET WORLD CUP</div>
      </div>
    </div>`, "background: var(--paper);"]
];

const browser = await chromium.launch();
for (const [name, w, hgt, html, bodyStyle] of assets) {
  const page = await browser.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head>
    <body style="${bodyStyle}">${html}</body></html>`);
  await page.waitForTimeout(120);
  await page.screenshot({ path: OUT + name + ".png" });
  await page.close();
  console.log("wrote social/" + name + ".png");
}
await browser.close();
copyFileSync(OUT + "og-1200x630.png", new URL("../public/og.png", import.meta.url).pathname);
console.log("copied -> public/og.png");
