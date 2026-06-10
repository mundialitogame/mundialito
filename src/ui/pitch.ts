import { PITCH, TUNE } from "../engine/tuning.ts";
import { surname } from "./dom.ts";
import { rollDistance } from "../engine/physics.ts";
import type { V2 } from "../engine/physics.ts";
import type { Match, Side } from "../engine/match.ts";

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; col: string; r: number }

export interface RenderState {
  ballOverride: V2 | null;
  ballAir: number; // 0 grounded .. 1 peak of a lofted kick
  discOverride: Map<number, V2>;
  aim: { dir: number; power: number } | null;
  dribbleTarget: V2 | null; // path being drawn in dribble mode
  penMode: boolean;
  showRadii: Side | null; // show interception radii of this side's opponents-of-interest
  hidePlans: boolean; // true while a flight is playing back
  trail: { x: number; y: number; a: number }[];
  particles: Particle[];
  shake: number;
  flash: number;
}

export function freshRenderState(): RenderState {
  return {
    ballOverride: null, ballAir: 0, discOverride: new Map(), aim: null, dribbleTarget: null, penMode: false,
    showRadii: null, hidePlans: false, trail: [], particles: [], shake: 0, flash: 0
  };
}

// indoor gym court: warm maple boards, painted lines
const SURROUND = "#221a10";
const PLANKS = ["#c9a266", "#c09a5e", "#d1aa6f", "#c5a064"];
const SEAM = "rgba(122,93,53,0.55)";
const CHALK = "rgba(247,243,230,0.92)";
const PAINT_D = "rgba(178,80,44,0.22)"; // keeper-area paint

export class PitchRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  s = 5;
  ox = 0;
  oy = 0;
  padTop = 60;
  padBot = 86;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.fit();
  }

  fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hgt * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const availW = w - 14;
    const availH = hgt - this.padTop - this.padBot;
    this.s = Math.min(availW / PITCH.W, availH / (PITCH.H + 10));
    this.ox = (w - PITCH.W * this.s) / 2;
    this.oy = this.padTop + (availH - PITCH.H * this.s) / 2;
  }

  px(x: number) { return this.ox + x * this.s; }
  py(y: number) { return this.oy + y * this.s; }
  toPitch(cx: number, cy: number): V2 {
    return { x: (cx - this.ox) / this.s, y: (cy - this.oy) / this.s };
  }

  draw(m: Match, rs: RenderState) {
    const c = this.ctx;
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    c.save();
    if (rs.shake > 0.2) c.translate((Math.random() - 0.5) * rs.shake, (Math.random() - 0.5) * rs.shake);

    // surround
    c.fillStyle = SURROUND;
    c.fillRect(-20, -20, w + 40, hgt + 40);

    this.drawPitch(c);
    if (rs.showRadii !== null) this.drawRadii(c, m, rs.showRadii);
    if (!rs.hidePlans) this.drawPlans(c, m);

    // discs
    const placing = m.planningSide();
    for (const d of m.discs) {
      const key = d.side * 5 + d.idx;
      const p = rs.discOverride.get(key) ?? d.p;
      const movable = d.side === 0 && placing === 0 && m.canPlan(d.idx) && !m.planFor(0, d.idx);
      this.drawDisc(c, m, d.side, d.idx, p, false, movable);
    }

    // ball trail + ball
    const bp = rs.ballOverride ?? this.ballAt(m);
    for (const t of rs.trail) {
      c.globalAlpha = t.a * 0.35;
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(this.px(t.x), this.py(t.y), TUNE.ballR * this.s * 0.8, 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    this.drawBall(c, bp, rs.ballAir);

    if (rs.aim) this.drawAim(c, m, bp, rs.aim);
    if (rs.dribbleTarget) this.drawDribblePlan(c, bp, rs.dribbleTarget);

    // particles
    for (const p of rs.particles) {
      c.globalAlpha = Math.max(0, Math.min(1, p.life));
      c.fillStyle = p.col;
      c.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2.6);
    }
    c.globalAlpha = 1;

    if (rs.flash > 0.01) {
      c.fillStyle = `rgba(248,245,232,${rs.flash * 0.55})`;
      c.fillRect(-20, -20, w + 40, hgt + 40);
    }
    c.restore();
  }

  ballAt(m: Match): V2 {
    if (m.owner) {
      const d = m.disc(m.owner.side, m.owner.idx);
      const dir = m.owner.side === 0 ? -1 : 1;
      return { x: d.p.x, y: d.p.y + dir * (TUNE.discR + TUNE.ballR + 0.15) };
    }
    return m.ball;
  }

  private drawPitch(c: CanvasRenderingContext2D) {
    const { s } = this;
    const x0 = this.px(0), y0 = this.py(0), x1 = this.px(PITCH.W), y1 = this.py(PITCH.H);
    // maple boards (vertical planks with staggered joints)
    const plankW = 4.6 * s;
    const n = Math.ceil((x1 - x0 + 24) / plankW);
    for (let i = 0; i < n; i++) {
      const px0 = x0 - 12 + i * plankW;
      c.fillStyle = PLANKS[(i * 7 + 3) % PLANKS.length];
      c.fillRect(px0, y0 - 10, plankW + 0.6, y1 - y0 + 20);
      c.strokeStyle = SEAM;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px0, y0 - 10);
      c.lineTo(px0, y1 + 10);
      c.stroke();
      // board joints, staggered per column
      const stag = ((i * 53) % 17) * s;
      for (let jy = y0 - 10 + stag; jy < y1 + 10; jy += 17 * s) {
        c.beginPath();
        c.moveTo(px0, jy);
        c.lineTo(px0 + plankW, jy);
        c.stroke();
      }
    }
    // varnish sheen + vignette
    const sheen = c.createLinearGradient(x0, y0, x1, y1);
    sheen.addColorStop(0, "rgba(255,250,235,0.07)");
    sheen.addColorStop(0.5, "rgba(255,250,235,0)");
    sheen.addColorStop(1, "rgba(80,55,25,0.10)");
    c.fillStyle = sheen;
    c.fillRect(x0 - 12, y0 - 10, x1 - x0 + 24, y1 - y0 + 20);
    const grad = c.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2, (y1 - y0) * 0.2, (x0 + x1) / 2, (y0 + y1) / 2, (y1 - y0) * 0.75);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(40,26,10,0.30)");
    c.fillStyle = grad;
    c.fillRect(x0 - 12, y0 - 10, x1 - x0 + 24, y1 - y0 + 20);

    // painted keeper areas
    for (const top of [true, false]) {
      const gy = top ? this.py(0) : this.py(PITCH.H);
      c.beginPath();
      c.moveTo(this.px(PITCH.W / 2) - PITCH.boxD * s, gy);
      c.arc(this.px(PITCH.W / 2), gy, PITCH.boxD * s, top ? 0 : Math.PI, top ? Math.PI : 2 * Math.PI);
      c.closePath();
      c.fillStyle = PAINT_D;
      c.fill();
    }

    // painted court lines
    c.strokeStyle = CHALK;
    c.lineWidth = Math.max(1.6, s * 0.34);
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // halfway + centre
    c.beginPath();
    c.moveTo(x0, this.py(PITCH.H / 2));
    c.lineTo(x1, this.py(PITCH.H / 2));
    c.stroke();
    c.beginPath();
    c.arc(this.px(PITCH.W / 2), this.py(PITCH.H / 2), 8.6 * s, 0, 7);
    c.stroke();
    c.beginPath();
    c.arc(this.px(PITCH.W / 2), this.py(PITCH.H / 2), 0.6 * s, 0, 7);
    c.fillStyle = CHALK;
    c.fill();
    // keeper boxes (D-style arcs, futsal flavoured)
    for (const top of [true, false]) {
      const gy = top ? this.py(0) : this.py(PITCH.H);
      c.beginPath();
      c.arc(this.px(PITCH.W / 2), gy, PITCH.boxD * s, top ? 0 : Math.PI, top ? Math.PI : 2 * Math.PI);
      c.stroke();
      // penalty dot
      c.beginPath();
      c.arc(this.px(PITCH.W / 2), top ? this.py(13) : this.py(PITCH.H - 13), 0.5 * s, 0, 7);
      c.fill();
    }
    // corner arcs
    for (const [cx, cy, a0] of [[0, 0, 0], [PITCH.W, 0, Math.PI / 2], [PITCH.W, PITCH.H, Math.PI], [0, PITCH.H, -Math.PI / 2]] as const) {
      c.beginPath();
      c.arc(this.px(cx), this.py(cy), 2.2 * s, a0, a0 + Math.PI / 2);
      c.stroke();
    }
    // goals: posts + net behind the line
    for (const top of [true, false]) {
      const gy = top ? 0 : PITCH.H;
      const dy = top ? -1 : 1;
      const gx0 = this.px(PITCH.W / 2 - PITCH.goalHalf), gx1 = this.px(PITCH.W / 2 + PITCH.goalHalf);
      const back = this.py(gy + dy * 4.4);
      const line = this.py(gy);
      // net
      c.save();
      c.fillStyle = "rgba(22,16,9,0.55)";
      c.fillRect(gx0, Math.min(line, back), gx1 - gx0, Math.abs(back - line));
      c.strokeStyle = "rgba(240,238,225,0.5)";
      c.lineWidth = 1;
      const mesh = 4.5;
      for (let x = gx0; x <= gx1; x += mesh) { c.beginPath(); c.moveTo(x, line); c.lineTo(x, back); c.stroke(); }
      for (let y = Math.min(line, back); y <= Math.max(line, back); y += mesh) { c.beginPath(); c.moveTo(gx0, y); c.lineTo(gx1, y); c.stroke(); }
      c.restore();
      // posts
      for (const gx of [gx0, gx1]) {
        c.beginPath();
        c.arc(gx, line, PITCH.postR * this.s, 0, 7);
        c.fillStyle = "#f4f1e4";
        c.fill();
        c.strokeStyle = "#1b1a14";
        c.lineWidth = 1.5;
        c.stroke();
      }
    }
  }

  private drawRadii(c: CanvasRenderingContext2D, m: Match, defSide: Side) {
    for (const d of m.discs) {
      if (d.side !== defSide) continue;
      const pl = m.player(d.side, d.idx);
      if (d.idx === 0) continue;
      const R = (TUNE.intR + pl.def * TUNE.intRStat + TUNE.discR) * this.s;
      c.beginPath();
      c.arc(this.px(d.p.x), this.py(d.p.y), R, 0, 7);
      c.fillStyle = "rgba(20,26,40,0.13)";
      c.fill();
      c.setLineDash([4, 5]);
      c.strokeStyle = "rgba(240,238,225,0.35)";
      c.lineWidth = 1.2;
      c.stroke();
      c.setLineDash([]);
    }
  }

  /** your planned runs as dotted arrows (the opposition's stay hidden —
   *  defence here is prediction, and so is reading it) */
  private drawPlans(c: CanvasRenderingContext2D, m: Match) {
    for (const d of m.discs) {
      if (d.side !== 0) continue;
      const target = m.planFor(d.side, d.idx);
      if (!target) continue;
      const x0 = this.px(d.p.x), y0 = this.py(d.p.y);
      const x1 = this.px(target.x), y1 = this.py(target.y);
      const mine = !target.lunge;
      // a lunge (committed challenge, foul risk) shows blood red
      const col = target.lunge ? "rgba(196,40,24,0.95)" : "rgba(244,241,228,0.92)";
      const ang = Math.atan2(y1 - y0, x1 - x0);
      c.strokeStyle = col;
      c.lineWidth = target.lunge ? 3.2 : 2.4;
      c.setLineDash([6, 6]);
      c.beginPath();
      c.moveTo(x0 + Math.cos(ang) * TUNE.discR * this.s, y0 + Math.sin(ang) * TUNE.discR * this.s);
      c.lineTo(x1, y1);
      c.stroke();
      c.setLineDash([]);
      // arrowhead + target marker
      c.fillStyle = mine ? "#e8542f" : "#c42818";
      c.beginPath();
      c.moveTo(x1 + Math.cos(ang) * 9, y1 + Math.sin(ang) * 9);
      c.lineTo(x1 + Math.cos(ang + 2.5) * 8, y1 + Math.sin(ang + 2.5) * 8);
      c.lineTo(x1 + Math.cos(ang - 2.5) * 8, y1 + Math.sin(ang - 2.5) * 8);
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(x1, y1, 3, 0, 7);
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      c.stroke();
    }
  }

  private drawDisc(c: CanvasRenderingContext2D, m: Match, side: Side, idx: number, p: V2, recovering: boolean, movable = false) {
    const team = m.teams[side];
    const r = TUNE.discR * this.s;
    const x = this.px(p.x), y = this.py(p.y);
    const pl = m.player(side, idx);
    const isGk = idx === 0;
    const kit = isGk ? ["#2d2d2d", "#d9a521"] : team.kit;
    // shadow
    c.beginPath();
    c.ellipse(x + r * 0.16, y + r * 0.3, r * 1.02, r * 0.92, 0, 0, 7);
    c.fillStyle = "rgba(10,25,16,0.35)";
    c.fill();
    // base ring
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fillStyle = "#15140f";
    c.fill();
    // kit face
    const fr = r * 0.82;
    c.save();
    c.beginPath();
    c.arc(x, y, fr, 0, 7);
    c.clip();
    c.fillStyle = kit[0];
    c.fillRect(x - fr, y - fr, fr * 2, fr * 2);
    c.fillStyle = kit[1];
    const pat = isGk ? "solid" : (team.pat as string);
    if (pat === "stripes") {
      for (const off of [-0.62, 0, 0.62]) c.fillRect(x + off * fr - fr * 0.14, y - fr, fr * 0.28, fr * 2);
    } else if (pat === "hoop") {
      c.fillRect(x - fr, y - fr * 0.22, fr * 2, fr * 0.44);
    } else if (pat === "check") {
      c.fillRect(x - fr, y - fr, fr, fr);
      c.fillRect(x, y, fr, fr);
    } else if (pat === "sash") {
      c.save();
      c.translate(x, y);
      c.rotate(-Math.PI / 4);
      c.fillRect(-fr * 1.5, -fr * 0.2, fr * 3, fr * 0.4);
      c.restore();
    }
    c.restore();
    // number
    const lum = parseInt(kit[0].slice(1, 3), 16) * 0.6 + parseInt(kit[0].slice(3, 5), 16);
    c.fillStyle = lum > 230 ? "#1b1a14" : "#f4f1e4";
    c.font = `800 ${Math.round(fr * 1.05)}px "Avenir Next Condensed","Arial Narrow",sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(isGk ? 1 : pl.num || idx + 2), x, y + 1);
    // name plate: you should know your players (and theirs)
    const ln = surname(pl.name).toUpperCase();
    c.font = `800 ${Math.max(8, Math.min(10.5, this.s * 0.45))}px "Avenir Next Condensed","Arial Narrow",sans-serif`;
    c.lineWidth = 2.6;
    c.strokeStyle = "rgba(28,20,10,0.85)";
    c.strokeText(ln, x, y + r + 7);
    c.fillStyle = side === 0 ? "#f7f3e6" : "#f3d9c8";
    c.fillText(ln, x, y + r + 7);
    if (recovering) {
      c.beginPath();
      c.arc(x, y, r, 0, 7);
      c.fillStyle = "rgba(110,110,110,0.45)";
      c.fill();
    }
    if (movable) {
      c.beginPath();
      c.arc(x, y, r + 3.2, 0, 7);
      c.setLineDash([5, 4]);
      c.strokeStyle = "rgba(244,241,228,0.75)";
      c.lineWidth = 1.8;
      c.stroke();
      c.setLineDash([]);
    }
  }

  private drawBall(c: CanvasRenderingContext2D, p: V2, air = 0) {
    const r = TUNE.ballR * this.s * (1 + air * 0.85);
    const x = this.px(p.x), y = this.py(p.y) - air * 6;
    // shadow stays on the floor, drifting away as the ball climbs
    c.beginPath();
    c.ellipse(this.px(p.x) + r * 0.18 + air * 4, this.py(p.y) + r * 0.3 + air * 5, r * (1 - air * 0.3), r * 0.8 * (1 - air * 0.3), 0, 0, 7);
    c.fillStyle = `rgba(10,25,16,${0.3 - air * 0.12})`;
    c.fill();
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fillStyle = "#f7f4e8";
    c.fill();
    c.strokeStyle = "#1b1a14";
    c.lineWidth = 1.2;
    c.stroke();
    // panel dots
    c.fillStyle = "#1b1a14";
    for (const [dx, dy] of [[0, 0], [-0.55, -0.35], [0.55, -0.35], [0, 0.62]]) {
      c.beginPath();
      c.arc(x + dx * r * 0.7, y + dy * r * 0.7, r * 0.16, 0, 7);
      c.fill();
    }
  }

  /** solid gold path: this turn will be spent running with the ball */
  private drawDribblePlan(c: CanvasRenderingContext2D, bp: V2, target: V2) {
    const x0 = this.px(bp.x), y0 = this.py(bp.y);
    const x1 = this.px(target.x), y1 = this.py(target.y);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    c.strokeStyle = "#d9a521";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.fillStyle = "#d9a521";
    c.beginPath();
    c.moveTo(x1 + Math.cos(ang) * 12, y1 + Math.sin(ang) * 12);
    c.lineTo(x1 + Math.cos(ang + 2.45) * 10, y1 + Math.sin(ang + 2.45) * 10);
    c.lineTo(x1 + Math.cos(ang - 2.45) * 10, y1 + Math.sin(ang - 2.45) * 10);
    c.closePath();
    c.fill();
  }

  private drawAim(c: CanvasRenderingContext2D, m: Match, bp: V2, aim: { dir: number; power: number }) {
    const speed = m.kickSpeed(aim.power);
    const dist = Math.min(rollDistance(speed), 70);
    const len = dist * this.s;
    const x = this.px(bp.x), y = this.py(bp.y);
    const cone = ((m.phase === "aim" ? m.coneDeg(aim.power) : 4) * Math.PI) / 180;
    // cone wedge
    c.save();
    c.translate(x, y);
    c.rotate(aim.dir);
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, len, -cone / 2, cone / 2);
    c.closePath();
    c.fillStyle = "rgba(244,241,228,0.13)";
    c.fill();
    // arrow shaft: white = short, gold = firm, red = lofted over everyone
    const pw = aim.power;
    const col = pw >= TUNE.airThresh ? "#e8542f" : pw > 0.45 ? "#d9a521" : "#f4f1e4";
    c.strokeStyle = col;
    c.lineWidth = Math.max(3, this.s * 0.55);
    c.setLineDash([this.s * 1.1, this.s * 0.75]);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(len - 12, 0);
    c.stroke();
    c.setLineDash([]);
    // head
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(len, 0);
    c.lineTo(len - 13, -7);
    c.lineTo(len - 13, 7);
    c.closePath();
    c.fill();
    c.restore();
    // lofted kicks show their landing zone
    if (pw >= TUNE.airThresh) {
      const airD = 8 + ((pw - TUNE.airThresh) / (1 - TUNE.airThresh)) * TUNE.airMax;
      const lx = x + Math.cos(aim.dir) * airD * this.s;
      const ly = y + Math.sin(aim.dir) * airD * this.s;
      c.beginPath();
      c.ellipse(lx, ly, 9, 6, 0, 0, 7);
      c.setLineDash([4, 4]);
      c.strokeStyle = "#e8542f";
      c.lineWidth = 2;
      c.stroke();
      c.setLineDash([]);
    }
    // power readout near ball
    c.fillStyle = "rgba(27,26,20,0.75)";
    const bw = 46, bx = x - bw / 2, by = y + 26;
    c.fillRect(bx, by, bw, 7);
    c.fillStyle = col;
    c.fillRect(bx + 1, by + 1, (bw - 2) * pw, 5);
  }
}
