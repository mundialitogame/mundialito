// Parses data-cache/wcsquads.html (Wikipedia: 2026 FIFA World Cup squads)
// into data-cache/squads.raw.json. Pure regex over the squad-table template
// markup (tr class="nat-fs-player") — no DOM dependency.
import { readFileSync, writeFileSync } from "node:fs";

const IN = new URL("../data-cache/wcsquads.html", import.meta.url).pathname;
const OUT = new URL("../data-cache/squads.raw.json", import.meta.url).pathname;
const KICKOFF = Date.UTC(2026, 5, 11); // tournament start, for age calc

const html = readFileSync(IN, "utf-8");

const stripTags = (s) =>
  s
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, "")
    .replace(/<span style="display:none">[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#91;[\s\S]*?&#93;/g, "")
    .replace(/\s+/g, " ")
    .trim();

// --- locate group sections (h2 id="Group_A" ...) and nation headings (h3) ---
const sections = [];
const h2re = /<h2 id="(Group_[A-L])"[^>]*>/g;
const h2s = [];
let m;
while ((m = h2re.exec(html))) h2s.push({ id: m[1], idx: m.index });
const h3re = /<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g;
while ((m = h3re.exec(html))) {
  const name = stripTags(m[2]);
  // group = last h2 before this h3
  let group = null;
  for (const h of h2s) if (h.idx < m.index) group = h.id.slice(-1);
  sections.push({ name, idx: m.index, group });
}

// --- parse each nation's squad table ---
const nations = [];
for (let i = 0; i < sections.length; i++) {
  const sec = sections[i];
  const end = i + 1 < sections.length ? sections[i + 1].idx : html.length;
  const chunk = html.slice(sec.idx, end);
  const rows = chunk.match(/<tr class="nat-fs-player">[\s\S]*?<\/tr>/g);
  if (!rows || !sec.group) continue; // not a squad section
  const players = [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?(?=<t[dh][^>]*>|<\/tr>)/g) ?? [];
    if (cells.length < 7) continue;
    const num = parseInt(stripTags(cells[0]), 10) || 0;
    const pos = (stripTags(cells[1]).match(/\b(GK|DF|MF|FW)\b/) ?? [])[1] ?? "MF";
    let name = stripTags(cells[2]).replace(/\s*\((captain|c|vice-captain)\)\s*$/i, "");
    const bday = (cells[3].match(/class="bday">(\d{4})-(\d{2})-(\d{2})/) ?? []).slice(1);
    let age = 0;
    if (bday.length === 3) {
      const b = Date.UTC(+bday[0], +bday[1] - 1, +bday[2]);
      age = Math.floor((KICKOFF - b) / (365.25 * 24 * 3600 * 1000));
    } else {
      age = parseInt((stripTags(cells[3]).match(/aged?\s+(\d+)/) ?? [])[1] ?? "26", 10);
    }
    const caps = parseInt(stripTags(cells[4]), 10) || 0;
    const goals = parseInt(stripTags(cells[5]), 10) || 0;
    // club cell: last anchor is the club (first anchor is the federation flag)
    const clubCell = cells[6];
    const anchors = [...clubCell.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((a) => stripTags(a[1])).filter(Boolean);
    const club = anchors.length ? anchors[anchors.length - 1] : stripTags(clubCell) || "Unattached";
    players.push({ num, pos, name, age, caps, goals, club });
  }
  if (players.length >= 20) nations.push({ nation: sec.name, group: sec.group, players });
}

writeFileSync(OUT, JSON.stringify(nations, null, 1));

// --- summary for sanity + curation reference ---
console.log(`nations: ${nations.length}, players: ${nations.reduce((a, n) => a + n.players.length, 0)}`);
for (const n of nations) {
  const gk = n.players.filter((p) => p.pos === "GK").length;
  if (n.players.length < 23 || gk < 3) console.log(`  CHECK ${n.nation}: ${n.players.length} players, ${gk} GK`);
}
const clubs = new Map();
for (const n of nations) for (const p of n.players) clubs.set(p.club, (clubs.get(p.club) ?? 0) + 1);
writeFileSync(
  new URL("../data-cache/clubs.txt", import.meta.url).pathname,
  [...clubs.entries()].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${k}\t${c}`).join("\n")
);
console.log(`distinct clubs: ${clubs.size} (data-cache/clubs.txt)`);
console.log("groups:", [...new Set(nations.map((n) => n.group))].sort().join(""));
console.log(nations.map((n) => `${n.group}:${n.nation}`).join(", "));
