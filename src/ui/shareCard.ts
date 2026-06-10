import type { SquadData } from "../data/types.ts";
import { USER, pickPlayer } from "../game/tournament.ts";
import type { RunState } from "../game/tournament.ts";

/** Renders a retro tournament-summary card to an offscreen canvas (PNG-able). */
export function makeShareCard(data: SquadData, run: RunState): HTMLCanvasElement {
  const W = 620, H = 930;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  const champion = run.champion === USER;

  c.fillStyle = "#f2ecdd";
  c.fillRect(0, 0, W, H);
  // border + stripes
  c.strokeStyle = "#1b1a14";
  c.lineWidth = 10;
  c.strokeRect(14, 14, W - 28, H - 28);
  const stripes = ["#e8542f", "#d9a521", "#0e7c66"];
  stripes.forEach((s, i) => {
    c.fillStyle = s;
    c.fillRect(24, 36 + i * 16, W - 48, 12);
  });

  const font = (size: number, weight = 800) => `${weight} ${size}px "Avenir Next Condensed","Arial Narrow",sans-serif`;
  c.fillStyle = "#1b1a14";
  c.textAlign = "center";
  c.font = font(54);
  c.fillText("MUNDIALITO ’26", W / 2, 142);
  c.font = font(20, 700);
  c.fillText("P O C K E T   W O R L D   C U P", W / 2, 172);

  c.font = font(44);
  c.fillStyle = "#0e7c66";
  c.fillText(`⭐ ${run.teamName}`, W / 2, 240);

  c.fillStyle = "#1b1a14";
  c.font = font(26, 700);
  const placed = champion ? "🏆 CHAMPIONS OF THE WORLD 🏆" : (run.placed ?? "").toUpperCase();
  c.fillText(placed, W / 2, 286);

  // squad list
  c.textAlign = "left";
  let y = 350;
  c.font = font(21, 700);
  c.fillText("THE SQUAD", 60, y - 24);
  c.strokeStyle = "#1b1a14";
  c.lineWidth = 3;
  c.strokeRect(48, y - 12, W - 96, run.picks.length * 52 + 18);
  for (let i = 0; i < run.picks.length; i++) {
    const p = pickPlayer(data, run.picks[i]);
    const starter = run.starters.includes(i);
    c.font = font(26, starter ? 800 : 600);
    c.globalAlpha = starter ? 1 : 0.6;
    c.fillText(`${p.flag}  ${p.name}`, 64, y + 24);
    c.textAlign = "right";
    c.font = font(24, 800);
    c.fillText(`${p.pos} ${p.ovr}`, W - 64, y + 24);
    c.textAlign = "left";
    y += 52;
  }
  c.globalAlpha = 1;

  // record
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const [key, r] of Object.entries(run.groupResults)) {
    const [a, b] = key.split("@");
    if (a !== USER && b !== USER) continue;
    const mine = a === USER ? r[0] : r[1], theirs = a === USER ? r[1] : r[0];
    gf += mine; ga += theirs;
    if (mine > theirs) w++; else if (mine === theirs) d++; else l++;
  }
  for (const round of run.bracket) {
    const tie = round.find((t) => t.a === USER || t.b === USER);
    if (!tie || tie.sa == null) continue;
    const mine = tie.a === USER ? tie.sa : tie.sb!, theirs = tie.a === USER ? tie.sb! : tie.sa;
    gf += mine; ga += theirs;
    if (tie.winner === USER) w++; else l++;
  }
  y += 36;
  c.font = font(28, 800);
  c.textAlign = "center";
  c.fillText(`${w}W  ${d}D  ${l}L   ·   GOALS ${gf}–${ga}`, W / 2, y);

  c.font = font(17, 700);
  c.fillStyle = "#4a463a";
  c.fillText("DRAFT YOUR OWN AT MUNDIALITO", W / 2, H - 44);
  return cv;
}
