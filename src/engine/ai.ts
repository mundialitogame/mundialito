import { Match } from "./match.ts";
import type { Side } from "./match.ts";
import { PITCH, TUNE } from "./tuning.ts";
import { v, add, sub, mul, dist, clamp, angOf, speedForDistance } from "./physics.ts";
import type { V2 } from "./physics.ts";
import type { NationData, Team, MatchPlayer } from "../data/types.ts";

/** Best 5-a-side lineup from a 26-man squad: top GK + best outfield 4 (≥1 DF),
 *  returned in slot order (deepest first) since players[i] owns formation slot i. */
export function nationLineup(n: NationData): MatchPlayer[] {
  const tag = (p: any): MatchPlayer => ({ ...p, nationCode: n.code, flag: n.flag });
  const gks = n.players.filter((p) => p.pos === "GK").sort((a, b) => b.gk - a.gk);
  const out = n.players.filter((p) => p.pos !== "GK").sort((a, b) => b.ovr - a.ovr);
  const dfs = out.filter((p) => p.pos === "DF");
  const pick: any[] = [];
  if (dfs.length) pick.push(dfs[0]);
  for (const p of out) {
    if (pick.length >= 4) break;
    if (!pick.includes(p)) pick.push(p);
  }
  const four = pick.slice(0, 4).sort((a, b) => (b.def - b.sho * 0.85) - (a.def - a.sho * 0.85));
  return [gks[0], ...four].map(tag);
}

export function buildNationTeam(n: NationData): Team {
  const players = nationLineup(n);
  return {
    name: n.name, code: n.code, flag: n.flag, kit: n.kit, pat: n.pat,
    players, rating: n.rating, isUser: false
  } as Team;
}

export function nationFormation(team: Team): string {
  const dfCount = team.players.filter((p, i) => i > 0 && p.pos === "DF").length;
  return dfCount >= 2 ? "box" : "diamond";
}

// ---------------------------------------------------------------- evaluation
function positionValue(p: V2, side: Side): number {
  const gy = side === 0 ? 0 : PITCH.H;
  const dGoal = dist(p, v(PITCH.W / 2, gy));
  const central = 1 - Math.abs(p.x - PITCH.W / 2) / (PITCH.W / 2);
  const prog = clamp(1 - dGoal / (PITCH.H * 1.05), 0, 1);
  return Math.pow(prog, 1.6) * (0.65 + 0.35 * central);
}

const dot2 = (a: V2, b: V2) => a.x * b.x + a.y * b.y;

/** deterministic estimate of a pass reaching target (mirrors engine model) */
function passSafety(m: Match, side: Side, from: V2, to: V2, speed: number, bodyFactor = 0.25): number {
  let safe = 1;
  const d = dist(from, to);
  if (d < 1) return 0;
  for (const dd of m.discs) {
    if (dd.side === side) continue;
    const pl = m.player(dd.side, dd.idx);
    const seg = sub(to, from);
    const t = clamp((dot2(sub(dd.p, from), seg)) / (dot2(seg, seg)), 0, 1);
    const cp = add(from, mul(seg, t));
    const dc = dist(cp, dd.p);
    if (dd.idx !== 0) {
      const R = TUNE.intR + pl.def * TUNE.intRStat + TUNE.discR;
      if (dc < R) {
        const spdF = clamp(1.18 - Math.pow(speed / TUNE.intSpeedRef, TUNE.intSpeedPow), 0.06, 1);
        const prox = clamp(1 - dc / R, 0, 1);
        safe *= 1 - clamp(TUNE.intBase * Math.pow(pl.def / 100, 1.4) * (0.35 + 0.65 * prox) * spdF, 0, 0.93);
      }
    }
    if (dc < TUNE.discR + TUNE.ballR + 0.4) safe *= bodyFactor;
  }
  return safe;
}

function shotChance(m: Match, side: Side, from: V2, aimX: number): number {
  const gy = side === 0 ? 0 : PITCH.H;
  const target = v(aimX, gy);
  const d = dist(from, target);
  if (d > 50) return 0.01;
  const gk = m.disc((1 - side) as Side, 0);
  const gkp = m.player((1 - side) as Side, 0);
  const speed = TUNE.kickMin + TUNE.kickMax + m.player(side, m.kicker().idx).sho * TUNE.kickStatBoost;
  const reach = Math.max(0.8, TUNE.saveBase + gkp.gk * TUNE.saveStat - speed * 0.85 * TUNE.saveSpeedPen);
  const tPlane = clamp((gk.p.y - from.y) / (target.y - from.y || 1e-6), 0, 1);
  const crossX = from.x + (target.x - from.x) * tPlane;
  const gap = Math.abs(crossX - gk.p.x);
  let p = clamp((gap - reach * 0.55) / (reach * 1.5), 0.04, 0.92);
  p *= clamp(1.45 - d / 32, 0.08, 1);
  p *= passSafety(m, side, from, target, speed, 0.45) * 0.9 + 0.1;
  // friendly bodies clutter the lane too (deflections, not catastrophes)
  for (const dd of m.discs) {
    if (dd.side !== side || (dd.side === side && dd.idx === m.kicker().idx)) continue;
    const seg = sub(target, from);
    const t = clamp(dot2(sub(dd.p, from), seg) / dot2(seg, seg), 0.05, 0.95);
    if (dist(add(from, mul(seg, t)), dd.p) < TUNE.discR + TUNE.ballR + 0.6) p *= 0.7;
  }
  if (Math.abs(aimX - PITCH.W / 2) > PITCH.goalHalf - 1.1) p *= 0.75;
  return clamp(p, 0.01, 0.92);
}

/** rough ball travel time for a kick at v0 covering distance d */
function ballTime(d: number, v0: number): number {
  return d / Math.max(8, v0 * 0.45);
}

// ------------------------------------------------------------------- attack
export interface KickChoice { dir: number; power01: number; why: string }

export function aiChooseKick(m: Match): KickChoice {
  const { side, idx } = m.kicker();
  const me = m.disc(side, idx).p;
  const skill = m.opts.aiSkill;
  const rng = m.rng;
  interface Cand { dir: number; power01: number; score: number; why: string }
  const cands: Cand[] = [];
  const maxSpeed = m.maxKickSpeed();
  const toPower = (speed: number) => clamp((speed - TUNE.kickMin) / Math.max(1, maxSpeed - TUNE.kickMin), 0.08, 1);

  for (let i = 0; i < 5; i++) {
    if (i === idx) continue;
    const mate = m.disc(side, i);
    const pl = m.player(side, i);
    if (i === 0 && positionValue(me, side) > 0.1) continue;
    // targets: feet now, or the planned run's arrival point (a timed lead)
    const plan = m.planFor(side, i);
    const targets: { p: V2; lead: boolean }[] = [{ p: mate.p, lead: false }];
    if (plan) targets.push({ p: plan, lead: true });
    for (const tg of targets) {
      const d = dist(me, tg.p);
      if (d < 6 || d > 84) continue;
      // lead passes are hit FIRM — fast balls beat lunges; the runner's
      // control decides whether the gather sticks
      const speed = Math.min(speedForDistance(d * (tg.lead ? 1.5 : 1.06)), maxSpeed);
      const arrive = tg.lead ? speed * 0.45 : speed * 0.3;
      const safety = passSafety(m, side, me, tg.p, speed);
      const gain = positionValue(tg.p, side) - positionValue(me, side);
      const ctlF = 1.55 - pl.ctl / 99;
      const trapP = clamp(TUNE.trapBase + pl.ctl * TUNE.trapStat - arrive * TUNE.trapSpeed * ctlF - (tg.lead ? TUNE.trapMoving * (1.35 - pl.ctl / 99) : 0), 0.2, 0.97);
      const shotPot = positionValue(tg.p, side) > 0.30 ? 0.3 : 0;
      let minOpp = 99;
      for (const dd of m.discs) if (dd.side !== side) minOpp = Math.min(minOpp, dist(dd.p, tg.p));
      const open = clamp((minOpp - 6) / 22, 0, 0.3);
      let timing = 1;
      if (tg.lead) {
        const tRun = dist(mate.p, tg.p) / m.runSpeed(side, i) + 0.1;
        const tB = ballTime(d, speed);
        timing = Math.abs(tB - tRun) < Math.max(0.45, tB * 0.35) ? 1.25 : 0.75;
      }
      // pure possession is worth little when you're camped at your own goal
      const keepFloor = 0.025 * safety * (0.4 + positionValue(me, side) * 2);
      const score = (safety * trapP * (0.14 + gain * 3.6 + shotPot + open) + keepFloor) * timing;
      cands.push({ dir: angOf(sub(tg.p, me)), power01: toPower(speed), score, why: `pass->${pl.name}${tg.lead ? " (run)" : ""}` });
    }
  }

  // shots: aim pulls in from the posts as range grows
  const gy = side === 0 ? 0 : PITCH.H;
  const dGoal = dist(me, v(PITCH.W / 2, gy));
  const inset = 1.7 + dGoal * 0.055;
  for (const aimX of [
    PITCH.W / 2 - PITCH.goalHalf + inset, PITCH.W / 2 + PITCH.goalHalf - inset,
    PITCH.W / 2 - PITCH.goalHalf * 0.45, PITCH.W / 2 + PITCH.goalHalf * 0.45
  ]) {
    const p = shotChance(m, side, me, aimX);
    // shots stay just under the aerial band: a floaty chip is a bad shot
    cands.push({ dir: angOf(sub(v(aimX, gy), me)), power01: Math.min(0.8 + 0.18 * skill, TUNE.airThresh - 0.015), score: p * 4.2, why: `shot` });
  }

  const press = m.pressureOn(side, idx);
  const myVal = positionValue(me, side);
  if (press > 0.3 || myVal < 0.1) {
    // pinned deep, get it launched — staying is the worst option
    const wide = v(me.x < PITCH.W / 2 ? PITCH.W - 8 : 8, me.y + (side === 0 ? -38 : 38));
    const escape = myVal < 0.08 ? 0.2 : 0;
    cands.push({ dir: angOf(sub(wide, me)), power01: 0.95, score: 0.12 + press * 0.1 + escape, why: "clear" });
  }

  for (const c of cands) c.score *= 1 + rng.noise() * (1.05 - skill) * 0.55;
  cands.sort((a, b) => b.score - a.score);
  const pickIdx = rng.next() < 0.22 * (1 - skill) ? Math.min(1 + Math.floor(rng.next() * 2), cands.length - 1) : 0;
  const c = cands[pickIdx] ?? { dir: angOf(v(0, side === 0 ? -1 : 1)), power01: 0.7, score: 0, why: "hoof" };
  const power = clamp(c.power01 * (1 + rng.noise() * 0.1 * (1 - skill)), 0.08, 1);
  return { dir: c.dir, power01: power, why: c.why };
}

// ----------------------------------------------------------------- dribbling
/** Carry the ball forward when there's open grass: returns a path target or null. */
export function aiMaybeDribble(m: Match): V2 | null {
  if (m.phase !== "aim" || !m.owner) return null;
  const { side, idx } = m.kicker();
  const me = m.disc(side, idx).p;
  const skill = m.opts.aiSkill;
  const rng = m.rng;
  if (skill < 0.5 || rng.next() > 0.3) return null;
  const cur = positionValue(me, side);
  if (cur < 0.07) return null; // never carry it around your own box
  let minOpp = 99;
  for (const d of m.discs) if (d.side !== side) minOpp = Math.min(minOpp, dist(d.p, me));
  if (minOpp < 12) return null; // too crowded to carry
  const reach = m.runSpeed(side, idx) * 0.78 * 2.0;
  const gdir = side === 0 ? -1 : 1;
  let best: V2 | null = null;
  let bestS = cur + 0.09; // a carry must buy real ground, not jogging for its own sake
  for (let k = 0; k < 6; k++) {
    const cand = m.clampOnPitch(add(me, v((rng.next() - 0.5) * reach * 0.9, gdir * reach * (0.45 + 0.55 * rng.next()))));
    let candOpp = 99;
    for (const d of m.discs) if (d.side !== side) candOpp = Math.min(candOpp, dist(d.p, cand));
    if (candOpp < 8) continue; // don't dribble into traffic
    const s = positionValue(cand, side) + clamp((candOpp - 8) / 24, 0, 0.2);
    if (s > bestS) { bestS = s; best = cand; }
  }
  return best;
}

// ------------------------------------------------------------- attacking runs
/** Plan runs into space; they execute during the kick, pace-limited. */
export function aiAttackRuns(m: Match): void {
  if (m.phase !== "aim" || !m.owner) return;
  const side = m.kicker().side;
  const rng = m.rng;
  const skill = m.opts.aiSkill;
  const horizon = 2.1; // seconds of running a plan is sized for
  const spotScore = (p: V2): number => {
    let minOpp = 99;
    for (const dd of m.discs) if (dd.side !== side) minOpp = Math.min(minOpp, dist(dd.p, p));
    return positionValue(p, side) * 1.3 + clamp((minOpp - 5) / 18, 0, 1) * 0.55;
  };
  for (const i of [1, 2, 3, 4]) {
    if (!m.canPlan(i)) continue;
    if (rng.next() < 0.4 * (1 - skill)) continue;
    const d = m.disc(side, i);
    const R = m.runSpeed(side, i) * horizon;
    const cur = spotScore(d.p);
    let best: V2 | null = null;
    let bestS = cur + 0.045;
    for (let k = 0; k < 12; k++) {
      const ang = rng.next() * Math.PI * 2;
      const rad = R * (0.35 + 0.65 * rng.next());
      const cand = m.clampOnPitch(add(d.p, v(Math.cos(ang) * rad, Math.sin(ang) * rad)));
      const s = spotScore(cand);
      if (s > bestS) { bestS = s; best = cand; }
    }
    if (best) m.planMove(i, best);
  }
}

// ------------------------------------------------------------------ defense
/** Plan the defensive shift: press the carrier, cut the big lanes, recover
 *  shape with everyone else. Execution is pace-limited during the kick. */
export function aiDefense(m: Match): void {
  if (m.phase !== "defense") return;
  const dSide = m.defenseSide();
  const aSide = (1 - dSide) as Side;
  const kicker = m.owner!;
  const kp = m.disc(aSide, kicker.idx).p;
  const skill = m.opts.aiSkill;
  const rng = m.rng;

  interface Threat { value: number; from: V2; to: V2 }
  const threats: Threat[] = [];
  for (let i = 1; i < 5; i++) {
    if (i === kicker.idx) continue;
    const mate = m.disc(aSide, i).p;
    threats.push({ value: positionValue(mate, aSide) + 0.1, from: kp, to: mate });
  }
  const gy = aSide === 0 ? 0 : PITCH.H;
  threats.push({ value: positionValue(kp, aSide) * 1.6 + 0.05, from: kp, to: v(PITCH.W / 2, gy) });
  threats.sort((a, b) => b.value - a.value);

  const assigned = new Set<number>();

  // 1) press: nearest defender plans to arrive on the carrier's toes
  {
    let bi = -1, bd = 1e9;
    for (let i = 1; i < 5; i++) {
      const dd = dist(m.disc(dSide, i).p, kp);
      if (dd < bd && dd > 1) { bd = dd; bi = i; }
    }
    if (bi >= 0 && rng.next() > 0.3 * (1 - skill)) {
      // sharper sides throw in committed tackles, accepting the foul risk
      const tackle = skill > 0.55 && rng.next() < 0.3;
      m.planMove(bi, kp, tackle);
      assigned.add(bi);
    }
  }
  // 2) cut the two most dangerous lanes
  for (const th of threats.slice(0, 3)) {
    if (assigned.size >= 3) break;
    const mid = add(th.from, mul(sub(th.to, th.from), 0.62));
    let bi = -1, bd = 1e9;
    for (let i = 1; i < 5; i++) {
      if (assigned.has(i)) continue;
      const dd = dist(m.disc(dSide, i).p, mid);
      if (dd < bd) { bd = dd; bi = i; }
    }
    if (bi >= 0) {
      const seg = sub(th.to, th.from);
      const dp = m.disc(dSide, bi).p;
      const t = clamp(dot2(sub(dp, th.from), seg) / dot2(seg, seg), 0.3, 0.85);
      const spot = add(th.from, mul(seg, t));
      const noisy = skill < 0.65 ? add(spot, v(rng.noise() * 4 * (1 - skill), rng.noise() * 4 * (1 - skill))) : spot;
      if (dist(noisy, dp) > 1.5) {
        m.planMove(bi, noisy);
        assigned.add(bi);
      }
    }
  }
  // 3) everyone else recovers shape, but holds a line — only genuinely
  // stranded players run home, so the box doesn't fill with moving bodies
  for (let i = 1; i < 5; i++) {
    if (assigned.has(i)) continue;
    const a = m.anchor(dSide, i);
    const dir = m.attackDir(dSide);
    const home = v(a.x * 0.72 + m.ball.x * 0.28, 0.78 * a.y + 0.22 * (m.ball.y + dir * -9));
    if (dist(home, m.disc(dSide, i).p) > 9) m.planMove(i, home);
  }
  m.commitDefense();
}
