// Fetches the Wikipedia 2026 World Cup squads page into data-cache/.
// Run once (or to refresh after late squad changes), then `npm run data:build`.
import { mkdirSync, writeFileSync } from "node:fs";

const URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads";
const OUT = new URL("../data-cache/wcsquads.html", import.meta.url).pathname;

mkdirSync(new URL("../data-cache/", import.meta.url).pathname, { recursive: true });
const res = await fetch(URL, { headers: { "user-agent": "mundialito-data-build/0.1 (fan project)" } });
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const html = await res.text();
writeFileSync(OUT, html);
console.log(`saved ${html.length} bytes -> ${OUT}`);
