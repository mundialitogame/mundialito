import { Rng } from "./rng.ts";
import { PITCH, TUNE } from "./tuning.ts";
import {
  v, add, sub, mul, len, dist, norm, lerpV, clamp, angOf, fromAng,
  applyFriction, sweepCircle, bounce
} from "./physics.ts";
import type { V2 } from "./physics.ts";
import type { Team, MatchPlayer } from "../data/types.ts";

export type Side = 0 | 1; // 0 attacks UP (toward y=0), 1 attacks DOWN
export type Phase = "defense" | "aim" | "flight" | "penalty" | "shootout" | "over";

export interface Disc {
  side: Side;
  idx: number; // 0 = GK
  p: V2;
}

export interface FlightFrame { t: number; x: number; y: number; air?: number }
export interface DiscMove { side: Side; idx: number; from: V2; to: V2; t0: number; t1: number }
export type EventKind =
  | "kick" | "intercept" | "intercept-miss" | "trap" | "heavy" | "steal"
  | "deflect" | "post" | "save-catch" | "save-parry" | "goal" | "own-goal"
  | "out" | "corner" | "goalkick" | "kickin" | "loose" | "block" | "tackle"
  | "through" | "challenge" | "foul";
export interface MatchEvent { kind: EventKind; t: number; side?: Side; idx?: number; text?: string }

export interface FlightResult {
  frames: FlightFrame[];
  discMoves: DiscMove[];
  events: MatchEvent[];
  duration: number;
}

export interface TurnTween { side: Side; idx: number; from: V2; to: V2 }
export interface TurnAdvance {
  tweens: TurnTween[];
  banner?: string;
  goal?: { side: Side; scorer?: string; own?: boolean };
  halfTime?: boolean;
  fullTime?: boolean;
  shootout?: boolean;
  penalty?: boolean;
}

export interface PenRound { shooter: Side; scored?: boolean; saved?: boolean; off?: boolean }

export const FORMATIONS: Record<string, [number, number][]> = {
  // [x01, y01] for the side defending the BOTTOM goal (y01: 0 = opp goal line).
  // Slot order is depth order: players[1..4] map straight onto slots 1..4.
  diamond: [[0.5, 0.955], [0.5, 0.80], [0.22, 0.58], [0.78, 0.58], [0.5, 0.38]],
  box: [[0.5, 0.955], [0.3, 0.78], [0.7, 0.78], [0.3, 0.48], [0.7, 0.48]],
  wall: [[0.5, 0.955], [0.24, 0.79], [0.5, 0.81], [0.76, 0.79], [0.5, 0.42]]
};

export const SLOT_LABELS: Record<string, string[]> = {
  diamond: ["GK", "SWEEPER", "LEFT", "RIGHT", "STRIKER"],
  box: ["GK", "BACK L", "BACK R", "FWD L", "FWD R"],
  wall: ["GK", "BACK L", "SWEEPER", "BACK R", "STRIKER"]
};

export interface MatchOpts {
  seed: number;
  knockout: boolean;
  aiSkill: number; // 0..1
  kicksPerHalf?: number;
  formations?: [string, string];
}

/**
 * Turn structure (planned simultaneous movement):
 *  1. defense phase — the defending side PLANS moves (dotted arrows, any
 *     number of discs, any distance). Nothing moves yet.
 *  2. aim phase — the attacker sees those arrows, plans runs of his own,
 *     then kicks.
 *  3. flight — every planned disc runs toward its target at pace-limited
 *     speed while the ball travels. Defensive reaction is bounded by how
 *     long the ball is live: harder kicks = less time to reorganise.
 * Positions persist between turns (no auto-repositioning), so dragging a
 * defence out of shape is real, spendable progress.
 */
export class Match {
  teams: [Team, Team];
  rng: Rng;
  opts: MatchOpts;
  phase: Phase = "defense";
  discs: Disc[] = [];
  ball: V2 = v(PITCH.W / 2, PITCH.H / 2);
  owner: { side: Side; idx: number } | null = null;
  lastTouch: Side = 0;
  score: [number, number] = [0, 0];
  half: 1 | 2 = 1;
  kicks = 0;
  kicksPerHalf: number;
  /** planned movement, key = side*5+idx -> target; executed during flight.
      A long plan ending at the carrier is a lunge: a committed challenge. */
  plans = new Map<number, V2 & { lunge: boolean }>();
  /** set after a foul: the next kick is a protected free kick */
  kickProtected = false;
  log: MatchEvent[] = [];
  pendingFlight: FlightResult | null = null;
  pendingOutcome: {
    owner: { side: Side; idx: number } | null;
    ball: V2;
    goalFor?: Side; ownGoal?: boolean; scorerIdx?: number;
    restart?: "kickoff" | "kickin" | "corner" | "goalkick";
    foul?: { side: Side; idx: number };
  } | null = null;
  /** set when a keeper's foul has earned the attacker a spot kick */
  penaltyFor: Side | null = null;
  kickoffSide: Side = 0;
  // shootout
  pens: PenRound[] = [];
  penScore: [number, number] = [0, 0];
  penShooterIdx: [number, number] = [0, 0];
  penWinner: Side | null = null;
  penDiveZone: number | null = null;

  constructor(teams: [Team, Team], opts: MatchOpts) {
    this.teams = teams;
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.kicksPerHalf = opts.kicksPerHalf ?? TUNE.kicksPerHalf;
    for (const side of [0, 1] as Side[])
      for (let i = 0; i < 5; i++) this.discs.push({ side, idx: i, p: v(0, 0) });
    this.kickoffSide = 0;
    this.setupKickoff(this.kickoffSide);
  }

  player(side: Side, idx: number): MatchPlayer { return this.teams[side].players[idx]; }
  disc(side: Side, idx: number): Disc { return this.discs[side * 5 + idx]; }
  attackDir(side: Side): number { return side === 0 ? -1 : 1; }
  goalY(side: Side): number { return side === 0 ? PITCH.H : 0; } // own goal line
  oppGoalY(side: Side): number { return side === 0 ? 0 : PITCH.H; }

  /** formation anchor for a disc: players[i] owns slot i (user-arranged) */
  anchor(side: Side, idx: number): V2 {
    const fname = this.opts.formations?.[side] ?? "diamond";
    const f = FORMATIONS[fname] ?? FORMATIONS.diamond;
    const [x01, y01] = f[idx] ?? f[1];
    const y = side === 0 ? y01 * PITCH.H : (1 - y01) * PITCH.H;
    const x = side === 0 ? x01 * PITCH.W : (1 - x01) * PITCH.W;
    return v(x, y);
  }

  runSpeed(side: Side, idx: number): number {
    return TUNE.runSpeed + this.player(side, idx).pac * TUNE.runSpeedStat;
  }

  setupKickoff(kicking: Side) {
    this.plans.clear();
    const centre = v(PITCH.W / 2, PITCH.H / 2);
    const t = this.teams[kicking];
    let taker = 1;
    for (let i = 1; i < 5; i++) if (t.players[i].pas > t.players[taker].pas) taker = i;
    for (const d of this.discs) {
      const a = this.anchor(d.side, d.idx);
      const ownY = this.goalY(d.side);
      d.p = v(a.x, ownY + (a.y - ownY) * 0.82);
    }
    this.disc(kicking, taker).p = v(PITCH.W / 2, PITCH.H / 2 + this.attackDir(kicking) * -2.5);
    this.ball = v(PITCH.W / 2, PITCH.H / 2);
    this.owner = { side: kicking, idx: taker };
    this.lastTouch = kicking;
    this.separate();
    // only the taker stands inside the centre circle — push everyone else
    // out along a direction that keeps them in their own half, and re-check
    // after separation so nobody gets shoved back in
    for (let pass = 0; pass < 2; pass++) {
      for (const d of this.discs) {
        if (d.side === kicking && d.idx === taker) continue;
        if (dist(d.p, centre) >= TUNE.kickoffR - 0.01) continue;
        let dir = norm(sub(d.p, centre));
        const ownYDir = d.side === 0 ? 1 : -1; // toward own goal
        if (dir.y * ownYDir < 0.32 || (dir.x === 0 && dir.y === 0)) {
          dir = norm(v(dir.x || (d.p.x < PITCH.W / 2 ? -0.6 : 0.6), ownYDir * 0.55));
        }
        d.p = this.clampOnPitch(add(centre, mul(dir, TUNE.kickoffR + 0.4)), d.idx === 0 ? d.side : undefined);
      }
      this.separate();
    }
    this.startDefensePhase();
  }

  // ---------------------------------------------------------------- planning
  defenseSide(): Side { return this.owner ? ((1 - this.owner.side) as Side) : 1; }

  startDefensePhase() {
    this.phase = "defense";
    this.shadeGk(this.defenseSide());
  }

  /** which side may currently lay plans? */
  planningSide(): Side | null {
    if (this.phase === "defense") return this.defenseSide();
    if (this.phase === "aim" && this.owner) return this.owner.side;
    return null;
  }

  canPlan(idx: number): boolean {
    const side = this.planningSide();
    if (side === null) return false;
    if (this.phase === "aim") {
      if (idx === 0) return false; // keepers don't join attacks
      if (this.owner && idx === this.owner.idx) return false; // the kicker kicks
    }
    return true;
  }

  /** set (or update) a planned run; nothing moves until the kick.
      tackle=true (defense only) plans a committed challenge AT the ball:
      better odds of winning it, but a foul risk — and a keeper's foul
      concedes a penalty. */
  planMove(idx: number, target: V2, tackle = false): boolean {
    const side = this.planningSide();
    if (side === null || !this.canPlan(idx)) return false;
    if (tackle && this.phase === "defense") {
      // a lunge: short aggressive dash in the dragged direction,
      // longer for better defenders (keepers use their GK stat)
      const from = this.disc(side, idx).p;
      const pl = this.player(side, idx);
      const maxL = TUNE.lungeLen + (idx === 0 ? pl.gk : pl.def) * TUNE.lungeLenStat;
      let dirv = sub(target, from);
      if (len(dirv) < 0.5) dirv = sub(this.ball, from);
      const to = this.clampOnPitch(add(from, mul(norm(dirv), maxL)), idx === 0 ? side : undefined);
      this.plans.set(side * 5 + idx, { x: to.x, y: to.y, lunge: true });
      return true;
    }
    let to = this.clampOnPitch(target, idx === 0 ? side : undefined);
    // don't plan onto the ball carrier's toes — arrive next to him
    if (this.owner && dist(to, this.ball) < TUNE.discR + TUNE.ballR + 1.4) {
      const away = norm(sub(to, this.ball));
      to = add(this.ball, mul(away, TUNE.discR + TUNE.ballR + 1.4));
    }
    this.plans.set(side * 5 + idx, { x: to.x, y: to.y, lunge: false });
    return true;
  }

  clearPlan(idx: number) {
    const side = this.planningSide();
    if (side === null) return;
    this.plans.delete(side * 5 + idx);
  }

  planFor(side: Side, idx: number): (V2 & { lunge: boolean }) | null {
    return this.plans.get(side * 5 + idx) ?? null;
  }

  clampOnPitch(p: V2, gkSide?: Side): V2 {
    const m = TUNE.discR + 0.4;
    let x = clamp(p.x, m, PITCH.W - m);
    let y = clamp(p.y, m, PITCH.H - m);
    if (gkSide !== undefined) {
      const gy = this.goalY(gkSide);
      x = clamp(x, PITCH.W / 2 - PITCH.boxW / 2, PITCH.W / 2 + PITCH.boxW / 2);
      y = gkSide === 0 ? clamp(y, PITCH.H - PITCH.boxD, PITCH.H - 1.8) : clamp(y, 1.8, PITCH.boxD);
      if (Math.abs(y - gy) > PITCH.boxD) y = gy - Math.sign(gy - PITCH.H / 2) * PITCH.boxD;
    }
    return v(x, y);
  }

  commitDefense() {
    if (this.phase !== "defense") return;
    this.phase = "aim";
  }

  shadeGk(side: Side) {
    const gk = this.disc(side, 0);
    const gy = this.goalY(side);
    const target = lerpV(v(PITCH.W / 2, 0), v(this.ball.x, 0), TUNE.gkShade);
    const x = clamp(target.x, PITCH.W / 2 - PITCH.goalHalf - 1, PITCH.W / 2 + PITCH.goalHalf + 1);
    gk.p = v(x, gy + (side === 0 ? -PITCH.gkY : PITCH.gkY));
  }

  // -------------------------------------------------------------------- aim
  kicker(): { side: Side; idx: number } {
    if (!this.owner) throw new Error("no owner");
    return this.owner;
  }

  pressureOn(side: Side, idx: number): number {
    if (this.kickProtected) return 0; // free kicks are taken in peace
    const kp = this.disc(side, idx).p;
    let press = 0;
    for (const d of this.discs) {
      if (d.side === side) continue;
      const dp = this.player(d.side, d.idx);
      const R = TUNE.pressR + dp.def * TUNE.pressRStat;
      const dd = dist(d.p, kp);
      if (dd < R) press += (1 - dd / R) * (0.55 + dp.def / 200);
    }
    return clamp(press, 0, 1);
  }

  kickStat(p: MatchPlayer, power01: number): number {
    const w = Math.pow(power01, 1.5);
    return p.pas * (1 - w) + p.sho * w;
  }

  coneDeg(power01: number): number {
    const { side, idx } = this.kicker();
    const p = this.player(side, idx);
    const stat = this.kickStat(p, power01);
    const press = this.pressureOn(side, idx);
    const base = TUNE.coneBase + (99 - stat) * TUNE.coneStat;
    return base * (0.55 + power01 * TUNE.conePower) + press * TUNE.conePressure;
  }

  maxKickSpeed(): number {
    const { side, idx } = this.kicker();
    const p = this.player(side, idx);
    const press = this.pressureOn(side, idx);
    let s = TUNE.kickMin + TUNE.kickMax + p.sho * TUNE.kickStatBoost;
    s *= 1 - press * TUNE.pressPowerCap;
    return s;
  }

  kickSpeed(power01: number): number {
    const max = this.maxKickSpeed();
    return TUNE.kickMin + (max - TUNE.kickMin) * power01;
  }

  kick(dir: number, power01: number): FlightResult {
    if (this.phase !== "aim") throw new Error("not aiming");
    const { side, idx } = this.kicker();
    power01 = clamp(power01, 0.05, 1);
    // own-goal guard: damp full-blooded kicks aimed straight at our own mouth
    const gy = this.goalY(side);
    const tGoal = (gy - this.ball.y) / (Math.sin(dir) || 1e-6);
    if (tGoal > 0 && Math.abs(gy - this.ball.y) < 34) {
      const crossX = this.ball.x + Math.cos(dir) * tGoal;
      if (Math.abs(crossX - PITCH.W / 2) < PITCH.goalHalf + 3)
        power01 = Math.min(power01, TUNE.ownGoalGuard + 0.2);
    }
    const cone = (this.coneDeg(power01) * Math.PI) / 180;
    const aDir = dir + this.rng.noise() * cone * 0.5;
    let speed = this.kickSpeed(power01);
    speed *= 1 + this.rng.noise() * TUNE.powerNoise * (0.6 + power01);
    const protectedKick = this.kickProtected;
    this.kickProtected = false;
    // the red top of the power band is its own trajectory: low-red is a high
    // chip that drops short and dies; max-red is the full punt
    let airTotal = 0;
    let airLand = 0;
    if (power01 >= TUNE.airThresh) {
      const redFrac = (power01 - TUNE.airThresh) / (1 - TUNE.airThresh);
      airTotal = (8 + redFrac * TUNE.airMax) * (1 + this.rng.noise() * TUNE.airScatter);
      const airTime = 0.85 + redFrac * 0.75; // short chips hang, punts drive
      speed = (airTotal / airTime) * (1 + this.rng.noise() * 0.04);
      airLand = TUNE.airLandSpeed + redFrac * TUNE.airLandSpeedMax;
    }
    const vel = fromAng(aDir, speed);
    this.kicks++;
    this.owner = null;
    this.lastTouch = side;
    const res = this.simulate(side, vel, idx, protectedKick, airTotal, airLand);
    this.pendingFlight = res;
    this.phase = "flight";
    return res;
  }

  // ----------------------------------------------------------------- flight
  private simulate(kickSide: Side, vel0: V2, kickerIdx = -1, protectedKick = false, airTotal = 0, airLand = 0): FlightResult {
    const frames: FlightFrame[] = [];
    const moves: DiscMove[] = [];
    const events: MatchEvent[] = [];
    const dt = TUNE.dt;
    let p = v(this.ball.x, this.ball.y);
    const origin = v(this.ball.x, this.ball.y);
    let w = v(vel0.x, vel0.y);
    let t = 0;
    let lastTouch = kickSide;
    const out: Match["pendingOutcome"] = { owner: null, ball: p };
    events.push({ kind: "kick", t: 0, side: kickSide });

    // live positions; planned discs run toward their targets during flight
    const live = new Map<number, V2>();
    for (const d of this.discs) live.set(d.side * 5 + d.idx, v(d.p.x, d.p.y));
    const discAt = (s: Side, i: number) => live.get(s * 5 + i)!;
    const kickerKey = kickerIdx >= 0 ? kickSide * 5 + kickerIdx : -99;
    let kickerClear = kickerIdx < 0;
    const whiffed = new Set<number>(); // beaten defenders stop colliding this flight
    const phasing = new Set<number>(); // discs the ball is currently skidding through

    interface Mover { key: number; side: Side; idx: number; target: V2; speed: number; done: boolean; start: V2; tEnd: number }
    const movers: Mover[] = [];
    for (const d of this.discs) {
      const key = d.side * 5 + d.idx;
      const target = this.plans.get(key);
      if (!target || key === kickerKey) continue;
      movers.push({
        key, side: d.side, idx: d.idx, target: v(target.x, target.y),
        speed: this.runSpeed(d.side, d.idx), done: false, start: v(d.p.x, d.p.y), tEnd: 0
      });
    }
    const challenged = new Set<string>(); // mover-vs-blocker pairs already resolved
    const isMoving = (key: number) => movers.some((mv) => mv.key === key && !mv.done);

    // pre-kick contest: a committed lunge first, else a standing charge-down.
    // Protected free kicks face neither.
    if (kickerIdx >= 0 && !protectedKick) {
      const kp = this.player(kickSide, kickerIdx);
      const kPos = this.disc(kickSide, kickerIdx).p;
      interface Lg { side: Side; idx: number; A: V2; B: V2; dBall: number; tBall: number }
      let lg: Lg | null = null;
      let near: { side: Side; idx: number; d: number } | null = null;
      for (const d of this.discs) {
        if (d.side === kickSide) continue;
        const plan = this.plans.get(d.side * 5 + d.idx);
        if (plan?.lunge) {
          // closest approach of the dash segment to the ball
          const A = v(d.p.x, d.p.y), B = v(plan.x, plan.y);
          const seg = sub(B, A);
          const L2 = Math.max(seg.x * seg.x + seg.y * seg.y, 1e-6);
          const tB = clamp(((p.x - A.x) * seg.x + (p.y - A.y) * seg.y) / L2, 0, 1);
          const dBall = dist(add(A, mul(seg, tB)), p);
          if (dBall < TUNE.discR + TUNE.ballR + 0.8 && (!lg || dBall < lg.dBall))
            lg = { side: d.side, idx: d.idx, A, B, dBall, tBall: tB };
        } else {
          const dd = dist(d.p, p);
          if (dd < TUNE.tackleR && (!near || dd < near.d)) near = { side: d.side, idx: d.idx, d: dd };
        }
      }
      if (lg) {
        const df = this.player(lg.side, lg.idx);
        const stat = lg.idx === 0 ? df.gk * 1.12 : df.def;
        // does the dash cross the man before it reaches the ball? → foul
        const seg = sub(lg.B, lg.A);
        const L2 = Math.max(seg.x * seg.x + seg.y * seg.y, 1e-6);
        const tK = clamp(((kPos.x - lg.A.x) * seg.x + (kPos.y - lg.A.y) * seg.y) / L2, 0, 1);
        const dK = dist(add(lg.A, mul(seg, tK)), kPos);
        const through = dK < TUNE.discR * 2.1 && tK < lg.tBall - 0.02;
        if (through && this.rng.next() < TUNE.foulThrough) {
          // show the dash arriving THROUGH the man, then the whistle and the
          // march back — so the foul never looks like it came from nowhere
          const contact = add(lg.A, mul(seg, lg.tBall));
          events.push({ kind: "foul", t: 0.45, side: lg.side, idx: lg.idx });
          moves.push({ side: lg.side, idx: lg.idx, from: lg.A, to: contact, t0: 0, t1: 0.4 });
          const ownGoalDir = lg.side === 0 ? 1 : -1;
          const back = this.clampOnPitch(add(contact, v(this.rng.noise() * 3, ownGoalDir * 9)), lg.idx === 0 ? lg.side : undefined);
          moves.push({ side: lg.side, idx: lg.idx, from: contact, to: back, t0: 0.65, t1: 1.25 });
          this.disc(lg.side, lg.idx).p = v(back.x, back.y);
          this.plans.clear();
          this.pendingOutcome = { owner: { side: kickSide, idx: kickerIdx }, ball: v(p.x, p.y), foul: { side: lg.side, idx: lg.idx } };
          frames.push({ t: 0, x: p.x, y: p.y }, { t: 1.35, x: p.x, y: p.y });
          this.log.push(...events);
          return { frames, discMoves: moves, events, duration: 1.4 };
        }
        const key = lg.side * 5 + lg.idx;
        const pWin = clamp(TUNE.lungeWin + stat * TUNE.lungeWinStat - kp.ctl * TUNE.lungeCtl, 0.12, 0.85);
        if (this.rng.next() < pWin) {
          // clean take — plus a hop onward in the dash direction, so the
          // winner has room to use the ball straight away
          events.push({ kind: "tackle", t: 0.05, side: lg.side, idx: lg.idx });
          const dashDir = norm(seg);
          const grab = this.clampOnPitch(add(p, mul(dashDir, TUNE.tackleHop)));
          moves.push({ side: lg.side, idx: lg.idx, from: lg.A, to: grab, t0: 0, t1: 0.35 });
          live.set(key, grab);
          const mv = movers.find((mm) => mm.key === key && !mm.done);
          if (mv) mv.done = true;
          out.owner = { side: lg.side, idx: lg.idx };
          out.ball = v(grab.x, grab.y);
          w = v(0, 0);
        } else {
          // dived past: he slides through and is out of this play
          events.push({ kind: "intercept-miss", t: 0.05, side: lg.side, idx: lg.idx });
          whiffed.add(key);
        }
      } else if (near) {
        const tk = this.player(near.side, near.idx);
        const prox = 1 - near.d / TUNE.tackleR;
        const pTackle = clamp(TUNE.tackleBase + tk.def * TUNE.tackleDef * (0.4 + 0.6 * prox) - kp.ctl * TUNE.tackleCtl, 0.04, 0.62);
        if (this.rng.next() < pTackle) {
          events.push({ kind: "tackle", t: 0, side: near.side, idx: near.idx });
          // the kick is smothered: ball squirts loose between the two
          w = fromAng(this.rng.next() * Math.PI * 2, 7 + this.rng.next() * 8);
          lastTouch = near.side;
        }
      }
    }

    const trapRoll = (s: Side, i: number, speed: number, moving: boolean, bouncing = false): boolean => {
      const pl = this.player(s, i);
      // a gentle ball to a standing, unpressured receiver always sticks
      if (speed < TUNE.softTrapSpeed && !moving && !bouncing) {
        let minOpp = 99;
        const rp = discAt(s, i);
        for (const d of this.discs) if (d.side !== s) minOpp = Math.min(minOpp, dist(discAt(d.side, d.idx), rp));
        if (minOpp > TUNE.softTrapSpace) return true;
      }
      // control shrinks the speed penalty AND the on-the-run penalty
      const ctlF = 1.55 - pl.ctl / 99;
      let pTrap = TUNE.trapBase + pl.ctl * TUNE.trapStat - speed * TUNE.trapSpeed * ctlF;
      if (moving) pTrap -= TUNE.trapMoving * (1.35 - pl.ctl / 99);
      if (bouncing) pTrap -= TUNE.bounceTrap * (1.35 - pl.ctl / 99);
      return this.rng.next() < clamp(pTrap, 0.1, 0.97);
    };

    const finishMover = (mv: Mover, atT: number) => {
      mv.done = true;
      mv.tEnd = atT;
      moves.push({ side: mv.side, idx: mv.idx, from: mv.start, to: v(discAt(mv.side, mv.idx).x, discAt(mv.side, mv.idx).y), t0: 0, t1: Math.max(atT, 0.08) });
    };

    const lastD = new Map<number, number>();
    let airLeft = airTotal;
    let bounceLeft = 0;
    const airAll = Math.max(airTotal, 1e-6);
    let frameAcc = 0;
    let stepCount = 0;
    const maxSteps = Math.ceil(TUNE.maxFlight / dt);

    while (stepCount++ < maxSteps) {
      const speed = len(w);
      if (speed <= 0) break;
      if (out.owner || out.goalFor !== undefined || out.restart) break;
      const airborne = airLeft > 0;
      const airFrac = airborne ? airLeft / airAll : 0;

      // ---- planned movement executes while the ball is live ----
      for (const mv of movers) {
        if (mv.done) continue;
        const cur = discAt(mv.side, mv.idx);
        const remaining = sub(mv.target, cur);
        const stepLen = mv.speed * dt;
        if (len(remaining) <= stepLen) {
          live.set(mv.key, v(mv.target.x, mv.target.y));
          finishMover(mv, t);
          continue;
        }
        const next = add(cur, mul(norm(remaining), stepLen));
        // a stationary opponent in the path forces a shoulder challenge
        let blocked = false;
        for (const o of this.discs) {
          if (o.side === mv.side) continue;
          const oKey = o.side * 5 + o.idx;
          if (isMoving(oKey)) continue;
          const op = discAt(o.side, o.idx);
          if (dist(next, op) < TUNE.discR * 2.0) {
            const pairKey = `${mv.key}:${oKey}`;
            if (challenged.has(pairKey)) { blocked = true; break; }
            challenged.add(pairKey);
            const runner = this.player(mv.side, mv.idx);
            const blocker = this.player(o.side, o.idx);
            const pWin = clamp(0.5 + ((runner.ctl * 0.5 + runner.pac * 0.5) - blocker.def) * TUNE.challengeStat, 0.15, 0.88);
            if (this.rng.next() < pWin) {
              events.push({ kind: "challenge", t, side: mv.side, idx: mv.idx });
              // shoulder past: nudge the blocker aside
              const push = mul(norm(sub(op, next)), 1.4);
              const np = this.clampOnPitch(add(op, push), o.idx === 0 ? o.side : undefined);
              moves.push({ side: o.side, idx: o.idx, from: v(op.x, op.y), to: np, t0: t, t1: t + 0.25 });
              live.set(oKey, np);
            } else {
              events.push({ kind: "challenge", t, side: o.side, idx: o.idx });
              finishMover(mv, t); // run dies on the shoulder
              blocked = true;
            }
            break;
          }
        }
        if (!blocked && !mv.done) live.set(mv.key, next);
      }

      // 1) post collisions (an airborne ball sails over everything)
      let hitPost = -1;
      let toi = dt;
      const posts: V2[] = [
        v(PITCH.W / 2 - PITCH.goalHalf, 0), v(PITCH.W / 2 + PITCH.goalHalf, 0),
        v(PITCH.W / 2 - PITCH.goalHalf, PITCH.H), v(PITCH.W / 2 + PITCH.goalHalf, PITCH.H)
      ];
      if (!airborne) posts.forEach((post, i) => {
        const tt = sweepCircle(p, w, post, PITCH.postR + TUNE.ballR, dt);
        if (tt >= 0 && tt < toi) { toi = tt; hitPost = i; }
      });

      // 2) disc body collisions (teammates get a small gather margin)
      if (!kickerClear && dist(p, discAt(kickSide, kickerIdx)) > TUNE.discR + TUNE.ballR + 0.45) kickerClear = true;
      for (const key of phasing) {
        const d = this.discs[key];
        if (dist(p, discAt(d.side, d.idx)) > TUNE.discR + TUNE.ballR + 0.8) phasing.delete(key);
      }
      let hitDisc: Disc | null = null;
      if (!airborne) for (const d of this.discs) {
        const key = d.side * 5 + d.idx;
        if ((key === kickerKey && !kickerClear) || whiffed.has(key) || phasing.has(key)) continue;
        const dp = discAt(d.side, d.idx);
        const gather = d.side === kickSide ? 0.65 : 0;
        const tt = sweepCircle(p, w, dp, TUNE.discR + TUNE.ballR + gather, dt);
        if (tt >= 0 && tt < toi) { toi = tt; hitDisc = d; hitPost = -1; }
      }

      // 3) GK save plane (a high ball clears the keeper; a dipping one is
      // reachable but awkward)
      for (const s of [0, 1] as Side[]) {
        if (hitDisc || hitPost >= 0) break;
        if (airborne && airFrac > TUNE.airOverBar) break;
        const gk = discAt(s, 0);
        const gy = this.goalY(s);
        const movingIn = Math.sign(w.y) === Math.sign(gy - p.y) && Math.abs(w.y) > 18;
        if (!movingIn) continue;
        const tt = (gk.y - p.y) / (w.y * dt);
        if (tt >= 0 && tt <= 1) {
          const cross = add(p, mul(w, tt * dt));
          if (Math.abs(cross.x - PITCH.W / 2) < PITCH.goalHalf + 4 && Math.abs(gy - cross.y) < PITCH.boxD) {
            const pl = this.player(s, 0);
            // a dipping ball's raw pace matters less than its drop
            const effSpeed = airborne ? Math.min(speed, 70) : speed;
            const reach = Math.max(0.8, (TUNE.saveBase + pl.gk * TUNE.saveStat - effSpeed * TUNE.saveSpeedPen) * (airborne ? TUNE.airSavePen : 1));
            const gap = Math.abs(cross.x - gk.x);
            const key = s * 5;
            if (gap <= reach && !lastD.has(-1 - s) && s !== kickSide) {
              lastD.set(-1 - s, 1); // one save attempt per flight per keeper
              const diveX = clamp(cross.x, gk.x - reach, gk.x + reach);
              moves.push({ side: s, idx: 0, from: v(gk.x, gk.y), to: v(diveX, gk.y), t0: t + tt * dt - 0.12, t1: t + tt * dt + 0.1 });
              live.set(key, v(diveX, gk.y));
              const canCatch = gap < reach * TUNE.catchMargin &&
                this.rng.next() < TUNE.catchBase + pl.gk * TUNE.catchStat - speed * 0.002;
              p = add(p, mul(w, tt * dt));
              t += tt * dt;
              if (canCatch) {
                events.push({ kind: "save-catch", t, side: s, idx: 0 });
                out.owner = { side: s, idx: 0 };
                out.ball = v(p.x, p.y);
                w = v(0, 0);
              } else {
                events.push({ kind: "save-parry", t, side: s, idx: 0 });
                const safe = this.rng.next() < TUNE.parrySafe * (0.5 + pl.gk / 150);
                const lateral = Math.sign(cross.x - PITCH.W / 2 || this.rng.noise());
                const outDir = s === 0 ? -1 : 1;
                const ang = Math.atan2(outDir * (safe ? 0.55 : 1.3), lateral * (safe ? 1.6 : 0.45));
                w = fromAng(ang, speed * 0.42);
                lastTouch = s;
              }
              break;
            }
          }
        }
      }
      if (out.owner) { frames.push({ t, x: p.x, y: p.y }); break; }

      // 4) goal line / out of bounds
      if (!hitDisc && hitPost < 0) {
        const nx = p.x + w.x * dt, ny = p.y + w.y * dt;
        let crossed: "top" | "bottom" | "side" | null = null;
        let ct = 1;
        if (ny < -TUNE.ballR) { crossed = "top"; ct = (p.y - -TUNE.ballR) / (p.y - ny); }
        else if (ny > PITCH.H + TUNE.ballR) { crossed = "bottom"; ct = (PITCH.H + TUNE.ballR - p.y) / (ny - p.y); }
        else if (nx < -TUNE.ballR || nx > PITCH.W + TUNE.ballR) { crossed = "side"; ct = nx < 0 ? (p.x + TUNE.ballR) / (p.x - nx) : (PITCH.W + TUNE.ballR - p.x) / (nx - p.x); }
        if (crossed) {
          const cp = add(p, mul(w, clamp(ct, 0, 1) * dt));
          t += ct * dt;
          p = cp;
          if (crossed !== "side" && Math.abs(cp.x - PITCH.W / 2) < PITCH.goalHalf && !(airborne && airFrac > TUNE.airOverBar)) {
            const scoredOn: Side = crossed === "top" ? 1 : 0;
            const scorer: Side = (1 - scoredOn) as Side;
            const own = lastTouch === scoredOn;
            events.push({ kind: own ? "own-goal" : "goal", t, side: scorer });
            out.goalFor = scorer;
            out.ownGoal = own;
            out.scorerIdx = !own && scorer === kickSide ? kickerIdx : -1;
            out.ball = v(cp.x, crossed === "top" ? -2 : PITCH.H + 2);
          } else {
            const goalLine = crossed !== "side";
            if (goalLine) {
              const defendsHere: Side = crossed === "top" ? 1 : 0;
              if (lastTouch === defendsHere) {
                events.push({ kind: "corner", t });
                const cornerX = cp.x < PITCH.W / 2 ? 1.8 : PITCH.W - 1.8;
                out.restart = "corner";
                out.ball = v(cornerX, crossed === "top" ? 1.8 : PITCH.H - 1.8);
                out.owner = null;
              } else {
                events.push({ kind: "goalkick", t });
                out.restart = "goalkick";
              }
            } else {
              events.push({ kind: "kickin", t });
              out.restart = "kickin";
              out.ball = v(clamp(cp.x, 1.5, PITCH.W - 1.5), clamp(cp.y, 1.5, PITCH.H - 1.5));
            }
          }
          frames.push({ t, x: p.x, y: p.y });
          break;
        }
      }

      // 5) interception lunges, computed live (defenders may be mid-run).
      // Roll when the ball passes its closest approach inside the radius.
      if (!airborne && !hitDisc && hitPost < 0) {
        for (const d of this.discs) {
          if (d.side === kickSide || d.idx === 0) continue;
          const key = d.side * 5 + d.idx;
          if (whiffed.has(key) || lastD.get(key) === -1) continue; // -1 = already rolled
          const pl = this.player(d.side, d.idx);
          const R = TUNE.intR + pl.def * TUNE.intRStat + TUNE.discR;
          const dd = dist(discAt(d.side, d.idx), p);
          const prev = lastD.get(key);
          if (dd < R && prev !== undefined && dd > prev) {
            lastD.set(key, -1);
            const spdF = clamp(1.18 - Math.pow(speed / TUNE.intSpeedRef, TUNE.intSpeedPow), 0.06, 1);
            const prox = clamp(1 - dd / R, 0, 1);
            const pInt = clamp(TUNE.intBase * Math.pow(pl.def / 100, 1.4) * (0.35 + 0.65 * prox) * spdF, 0, 0.93);
            if (this.rng.next() < pInt) {
              const grab = v(p.x + w.x * 0.02, p.y + w.y * 0.02);
              moves.push({ side: d.side, idx: d.idx, from: v(discAt(d.side, d.idx).x, discAt(d.side, d.idx).y), to: grab, t0: t, t1: t + TUNE.lungeTime });
              live.set(key, grab);
              const mv = movers.find((mm) => mm.key === key && !mm.done);
              if (mv) finishMover(mv, t);
              events.push({ kind: "intercept", t, side: d.side, idx: d.idx });
              out.owner = { side: d.side, idx: d.idx };
              out.ball = v(p.x, p.y);
              w = v(0, 0);
            } else {
              whiffed.add(key);
              const mv = movers.find((mm) => mm.key === key && !mm.done);
              if (mv) finishMover(mv, t);
              events.push({ kind: "intercept-miss", t, side: d.side, idx: d.idx });
            }
            if (out.owner) break;
          } else if (dd < R + 2) {
            lastD.set(key, dd);
          } else {
            lastD.delete(key);
          }
        }
        if (out.owner) { frames.push({ t, x: p.x, y: p.y }); break; }
      }

      // 6) hard contacts
      if (hitPost >= 0) {
        p = add(p, mul(w, toi));
        t += toi;
        const minD = PITCH.postR + TUNE.ballR + 0.03;
        if (dist(p, posts[hitPost]) < minD) p = add(posts[hitPost], mul(norm(sub(p, posts[hitPost])), minD));
        w = bounce(w, p, posts[hitPost], TUNE.restPost);
        events.push({ kind: "post", t });
        frames.push({ t, x: p.x, y: p.y });
        continue;
      }
      if (hitDisc) {
        const key = hitDisc.side * 5 + hitDisc.idx;
        p = add(p, mul(w, toi));
        t += toi;
        const dp = discAt(hitDisc.side, hitDisc.idx);
        const minD = TUNE.discR + TUNE.ballR + 0.03;
        if (dist(p, dp) < minD) p = add(dp, mul(norm(sub(p, dp)), minD));
        const pl = this.player(hitDisc.side, hitDisc.idx);
        const sNow = len(w);
        const bouncing = bounceLeft > 0;
        if (hitDisc.side === kickSide) {
          // a ball too hot to handle skids straight past (your striker isn't
          // going to "trap" your own shot) — occasionally it clips him
          if (sNow > TUNE.gatherMax) {
            if (this.rng.next() < TUNE.gatherDeflect) {
              events.push({ kind: "heavy", t, side: hitDisc.side, idx: hitDisc.idx });
              const jit = ((this.rng.noise() * TUNE.heavyJitter) * Math.PI) / 180;
              w = fromAng(angOf(w) + jit, sNow * 0.75);
              lastTouch = hitDisc.side;
            }
            phasing.add(key);
            frames.push({ t, x: p.x, y: p.y });
            continue;
          }
          // teammate receives (harder on the run or off a bounce,
          // easier with good control)
          const mv = movers.find((mm) => mm.key === key && !mm.done);
          if (trapRoll(hitDisc.side, hitDisc.idx, sNow, !!mv, bouncing)) {
            if (mv) finishMover(mv, t);
            events.push({ kind: "trap", t, side: hitDisc.side, idx: hitDisc.idx });
            out.owner = { side: hitDisc.side, idx: hitDisc.idx };
            out.ball = v(p.x, p.y);
            w = v(0, 0);
          } else {
            if (mv) finishMover(mv, t);
            events.push({ kind: "heavy", t, side: hitDisc.side, idx: hitDisc.idx });
            w = bounce(w, p, dp, TUNE.restDisc);
            const jit = ((this.rng.noise() * TUNE.heavyJitter) * Math.PI) / 180;
            w = fromAng(angOf(w) + jit, sNow * TUNE.heavyKeep);
            lastTouch = hitDisc.side;
          }
        } else {
          // a fast, well-struck ball can squeeze straight past a defender —
          // and a defender right on top of the kicker is easiest to poke past
          const nearOrigin = dist(dp, origin) < TUNE.closeZone;
          const pThrough = clamp(
            (sNow - 32) * TUNE.throughSpeed + (99 - pl.def) * TUNE.throughDef + (nearOrigin ? TUNE.throughCloseBoost : 0),
            0, 0.8);
          if (this.rng.next() < pThrough) {
            events.push({ kind: "through", t, side: kickSide });
            whiffed.add(key);
            const jit = ((this.rng.noise() * 7) * Math.PI) / 180;
            w = fromAng(angOf(w) + jit, sNow * 0.93);
          } else {
            const stat = hitDisc.idx === 0 ? pl.gk : pl.def * 0.75 + pl.ctl * 0.25;
            const pSteal = clamp(0.14 + stat * 0.005 - sNow * 0.0062, 0.07, 0.8) * (nearOrigin ? 0.6 : 1);
            if (this.rng.next() < pSteal) {
              events.push({ kind: "steal", t, side: hitDisc.side, idx: hitDisc.idx });
              out.owner = { side: hitDisc.side, idx: hitDisc.idx };
              out.ball = v(p.x, p.y);
              w = v(0, 0);
            } else {
              events.push({ kind: hitDisc.idx === 0 ? "save-parry" : "block", t, side: hitDisc.side, idx: hitDisc.idx });
              w = bounce(w, p, dp, TUNE.restDisc);
              w = mul(w, 0.55);
              lastTouch = hitDisc.side;
            }
          }
        }
        frames.push({ t, x: p.x, y: p.y });
        if (out.owner) break;
        continue;
      }

      // integrate ball (a lofted ball holds its arc speed, then drops dead-ish)
      p = add(p, mul(w, dt));
      const ns = airborne ? len(w) : applyFriction(len(w), dt);
      w = ns > 0 ? mul(norm(w), ns) : v(0, 0);
      if (airLeft > 0) {
        airLeft -= speed * dt;
        if (airLeft <= 0) {
          airLeft = 0;
          // touchdown: the pace dies, the ball skips on awkwardly for a while
          const jit = ((this.rng.noise() * 5) * Math.PI) / 180;
          w = fromAng(angOf(w) + jit, Math.min(len(w), airLand || 14));
          bounceLeft = TUNE.bounceRun;
        }
      } else if (bounceLeft > 0) {
        bounceLeft -= speed * dt;
        if (bounceLeft < 0) bounceLeft = 0;
      }
      t += dt;
      frameAcc += dt;
      if (frameAcc >= 1 / 60) {
        const air = airLeft > 0 ? airLeft / airAll : bounceLeft > 0 ? 0.24 * (bounceLeft / TUNE.bounceRun) : 0;
        frames.push({ t, x: p.x, y: p.y, air });
        frameAcc = 0;
      }
    }

    // a feather-touch kick doesn't freeze the world: planned moves always get
    // a minimum window, so a zero-power touch gifts the defence a free shift
    if (movers.some((mv) => !mv.done) && t < TUNE.minMoveWindow) {
      const extra = TUNE.minMoveWindow - t;
      for (const mv of movers) {
        if (mv.done) continue;
        const cur = discAt(mv.side, mv.idx);
        const rem = sub(mv.target, cur);
        const cover = Math.min(len(rem), mv.speed * extra);
        if (cover > 0.05) live.set(mv.key, add(cur, mul(norm(rem), cover)));
        finishMover(mv, Math.min(t + cover / mv.speed, TUNE.minMoveWindow));
      }
      t = TUNE.minMoveWindow;
    }
    for (const mv of movers) if (!mv.done) finishMover(mv, t);

    // ball at rest unowned -> loose ball contest
    if (!out.owner && out.goalFor === undefined && !out.restart) {
      out.ball = v(p.x, p.y);
      let best: { side: Side; idx: number; tt: number } | null = null;
      let second: { side: Side; idx: number; tt: number } | null = null;
      for (const d of this.discs) {
        const dp = discAt(d.side, d.idx);
        const pl = this.player(d.side, d.idx);
        if (d.idx === 0 && dist(dp, p) > 14) continue;
        const spd = TUNE.runSpeed + pl.pac * TUNE.runSpeedStat;
        const tt = Math.max(0, dist(dp, p) - (TUNE.discR + TUNE.ballR)) / spd;
        if (!best || tt < best.tt) { second = best; best = { side: d.side, idx: d.idx, tt }; }
        else if (!second || tt < second.tt) second = { side: d.side, idx: d.idx, tt };
      }
      if (best) {
        let win = best;
        if (second && second.side !== best.side && (second.tt - best.tt) / Math.max(best.tt, 0.01) < TUNE.looseTieBand) {
          const a = this.player(best.side, best.idx).ctl;
          const b = this.player(second.side, second.idx).ctl;
          if (this.rng.next() > a / (a + b)) win = second;
        }
        events.push({ kind: "loose", t, side: win.side, idx: win.idx });
        const arrive = clamp(win.tt, 0.25, 1.1);
        const from = v(discAt(win.side, win.idx).x, discAt(win.side, win.idx).y);
        const to = this.clampOnPitch(v(p.x, p.y - 0.1), win.idx === 0 ? win.side : undefined);
        moves.push({ side: win.side, idx: win.idx, from, to, t0: t, t1: t + arrive });
        live.set(win.side * 5 + win.idx, to);
        out.owner = { side: win.side, idx: win.idx };
        t += arrive;
      }
    }

    frames.push({ t, x: p.x, y: p.y });
    this.lastTouch = lastTouch;
    // persist all live positions (planned runs really happened)
    for (const d of this.discs) {
      const np = live.get(d.side * 5 + d.idx)!;
      d.p = v(np.x, np.y);
    }
    this.plans.clear();
    this.pendingOutcome = out;
    this.log.push(...events);
    return { frames, discMoves: moves, events, duration: t };
  }

  // --------------------------------------------------------------- dribbling
  /** Spend the turn carrying the ball along a path. Everyone's planned runs
   *  still execute; defenders who get close challenge for the ball. */
  dribble(target: V2): FlightResult {
    if (this.phase !== "aim") throw new Error("not aiming");
    const { side, idx } = this.kicker();
    const edge = TUNE.discR + TUNE.ballR + 0.9;
    const to = v(clamp(target.x, edge, PITCH.W - edge), clamp(target.y, edge, PITCH.H - edge));
    this.kicks++;
    this.owner = null;
    const res = this.simulateDribble(side, idx, to);
    this.pendingFlight = res;
    this.phase = "flight";
    return res;
  }

  private simulateDribble(side: Side, carrierIdx: number, target: V2): FlightResult {
    const frames: FlightFrame[] = [];
    const moves: DiscMove[] = [];
    const events: MatchEvent[] = [];
    const dt = TUNE.dt;
    const carrierKey = side * 5 + carrierIdx;
    const live = new Map<number, V2>();
    for (const d of this.discs) live.set(d.side * 5 + d.idx, v(d.p.x, d.p.y));
    const discAt = (s: Side, i: number) => live.get(s * 5 + i)!;
    let lastTouch: Side = side;
    const out: Match["pendingOutcome"] = { owner: { side, idx: carrierIdx }, ball: v(this.ball.x, this.ball.y) };

    interface Mover { key: number; side: Side; idx: number; target: V2; speed: number; done: boolean; start: V2 }
    const movers: Mover[] = [];
    for (const d of this.discs) {
      const key = d.side * 5 + d.idx;
      const tg = this.plans.get(key);
      if (!tg || key === carrierKey) continue;
      movers.push({ key, side: d.side, idx: d.idx, target: v(tg.x, tg.y), speed: this.runSpeed(d.side, d.idx), done: false, start: v(d.p.x, d.p.y) });
    }
    const finishMover = (mv: Mover, atT: number) => {
      mv.done = true;
      moves.push({ side: mv.side, idx: mv.idx, from: mv.start, to: v(discAt(mv.side, mv.idx).x, discAt(mv.side, mv.idx).y), t0: 0, t1: Math.max(atT, 0.08) });
    };

    const cStart = v(this.disc(side, carrierIdx).p.x, this.disc(side, carrierIdx).p.y);
    const cSpeed = this.runSpeed(side, carrierIdx) * TUNE.dribbleSpeed;
    const carryT = Math.min(dist(cStart, target) / cSpeed, TUNE.dribbleMax);
    const window = Math.max(carryT, TUNE.minMoveWindow);
    const tried = new Set<number>();
    let lostAt = -1;
    let fouledAt = -1;
    let fouledBy: { side: Side; idx: number } | null = null;
    let wonBy: { side: Side; idx: number } | null = null;
    let ballP = v(this.ball.x, this.ball.y);
    let ballV = v(0, 0);
    let t = 0;
    let frameAcc = 0;

    while (t < window) {
      // carrier runs the path with the ball at his feet
      if (lostAt < 0 && fouledAt < 0 && t < carryT) {
        const cur = discAt(side, carrierIdx);
        const step = Math.min(cSpeed * dt, dist(cur, target));
        if (step > 1e-4) {
          const dirv = norm(sub(target, cur));
          const np = add(cur, mul(dirv, step));
          live.set(carrierKey, np);
          ballP = add(np, mul(dirv, TUNE.discR + TUNE.ballR + 0.1));
        }
      }
      // everyone else's planned runs
      for (const mv of movers) {
        if (mv.done) continue;
        const cur = discAt(mv.side, mv.idx);
        const rem = sub(mv.target, cur);
        const stepLen = mv.speed * dt;
        if (len(rem) <= stepLen) {
          live.set(mv.key, v(mv.target.x, mv.target.y));
          finishMover(mv, t);
        } else {
          live.set(mv.key, add(cur, mul(norm(rem), stepLen)));
        }
      }
      // defenders close to the carrier challenge for the ball (once each);
      // a planned lunge (incl. a rushing keeper) is stronger but can foul
      if (lostAt < 0 && fouledAt < 0) {
        const cp = discAt(side, carrierIdx);
        for (const d of this.discs) {
          if (d.side === side) continue;
          const key = d.side * 5 + d.idx;
          if (tried.has(key)) continue;
          if (dist(discAt(d.side, d.idx), cp) < TUNE.dribbleChallengeR) {
            tried.add(key);
            const df = this.player(d.side, d.idx);
            const ca = this.player(side, carrierIdx);
            const lunging = !!this.plans.get(key)?.lunge;
            const defStat = d.idx === 0
              ? df.gk * (lunging ? 1.12 : 0.8)
              : df.def * (lunging ? 1.1 : 1);
            const dp = discAt(d.side, d.idx);
            if (lunging) {
              // the carrier's body between challenger and ball = through the man
              const through = dist(dp, ballP) > dist(dp, cp) + 0.3;
              if (through && this.rng.next() < TUNE.foulThrough) {
                events.push({ kind: "foul", t, side: d.side, idx: d.idx });
                fouledAt = t;
                fouledBy = { side: d.side, idx: d.idx };
                const ownGoalDir = d.side === 0 ? 1 : -1;
                const back = this.clampOnPitch(add(dp, v(this.rng.noise() * 3, ownGoalDir * 9)), d.idx === 0 ? d.side : undefined);
                moves.push({ side: d.side, idx: d.idx, from: v(dp.x, dp.y), to: back, t0: t, t1: t + 0.5 });
                live.set(key, back);
                break;
              }
            }
            const pT = clamp(
              (TUNE.dispossessBase + defStat * TUNE.dispossessDef * (lunging ? 1.35 : 1)) - (ca.ctl * 0.7 + ca.pac * 0.3) * TUNE.dispossessCtl,
              0.08, 0.9);
            if (this.rng.next() < pT) {
              events.push({ kind: lunging ? "tackle" : "steal", t, side: d.side, idx: d.idx });
              lastTouch = d.side;
              if (lunging) {
                // clean lunge: take the ball and hop clear of the carrier
                const plan = this.plans.get(key)!;
                const dashDir = norm(sub(v(plan.x, plan.y), dp));
                ballP = this.clampOnPitch(add(ballP, mul(dashDir, TUNE.tackleHop)));
                moves.push({ side: d.side, idx: d.idx, from: v(dp.x, dp.y), to: v(ballP.x, ballP.y), t0: t, t1: t + 0.35 });
                live.set(key, v(ballP.x, ballP.y));
                wonBy = { side: d.side, idx: d.idx };
                lostAt = t;
              } else {
                lostAt = t;
                ballV = fromAng(this.rng.next() * Math.PI * 2, 7 + this.rng.next() * 7);
              }
            } else {
              events.push({ kind: "challenge", t, side, idx: carrierIdx });
            }
            break;
          }
        }
      } else if (lostAt >= 0) {
        // the loose ball rolls on
        ballP = add(ballP, mul(ballV, dt));
        const ns = applyFriction(len(ballV), dt);
        ballV = ns > 0 ? mul(norm(ballV), ns) : v(0, 0);
        ballP = v(clamp(ballP.x, TUNE.ballR, PITCH.W - TUNE.ballR), clamp(ballP.y, TUNE.ballR, PITCH.H - TUNE.ballR));
      }
      if (fouledAt >= 0) { t += 0.5; break; } // whistle stops play
      t += dt;
      frameAcc += dt;
      if (frameAcc >= 1 / 60) {
        frames.push({ t, x: ballP.x, y: ballP.y });
        frameAcc = 0;
      }
    }
    // carrier's movement entry
    const cEnd = fouledAt >= 0 ? fouledAt : lostAt >= 0 ? lostAt : carryT;
    moves.push({ side, idx: carrierIdx, from: cStart, to: v(discAt(side, carrierIdx).x, discAt(side, carrierIdx).y), t0: 0, t1: Math.max(cEnd, 0.08) });
    for (const mv of movers) if (!mv.done) finishMover(mv, t);

    if (fouledAt >= 0) {
      out.owner = { side, idx: carrierIdx };
      out.ball = v(ballP.x, ballP.y);
      out.foul = fouledBy!;
    } else if (wonBy) {
      out.owner = wonBy;
      out.ball = v(ballP.x, ballP.y);
    } else if (lostAt >= 0) {
      // loose-ball contest from wherever everyone ended up
      let best: { side: Side; idx: number; tt: number } | null = null;
      let second: { side: Side; idx: number; tt: number } | null = null;
      for (const d of this.discs) {
        const dp = discAt(d.side, d.idx);
        const pl = this.player(d.side, d.idx);
        if (d.idx === 0 && dist(dp, ballP) > 14) continue;
        const spd = TUNE.runSpeed + pl.pac * TUNE.runSpeedStat;
        const tt = Math.max(0, dist(dp, ballP) - (TUNE.discR + TUNE.ballR)) / spd;
        if (!best || tt < best.tt) { second = best; best = { side: d.side, idx: d.idx, tt }; }
        else if (!second || tt < second.tt) second = { side: d.side, idx: d.idx, tt };
      }
      if (best) {
        let win = best;
        if (second && second.side !== best.side && (second.tt - best.tt) / Math.max(best.tt, 0.01) < TUNE.looseTieBand) {
          const a = this.player(best.side, best.idx).ctl;
          const b = this.player(second.side, second.idx).ctl;
          if (this.rng.next() > a / (a + b)) win = second;
        }
        events.push({ kind: "loose", t, side: win.side, idx: win.idx });
        const arrive = clamp(win.tt, 0.25, 1.1);
        const from = v(discAt(win.side, win.idx).x, discAt(win.side, win.idx).y);
        const to = this.clampOnPitch(v(ballP.x, ballP.y - 0.1), win.idx === 0 ? win.side : undefined);
        moves.push({ side: win.side, idx: win.idx, from, to, t0: t, t1: t + arrive });
        live.set(win.side * 5 + win.idx, to);
        out.owner = { side: win.side, idx: win.idx };
        t += arrive;
      }
      out.ball = v(ballP.x, ballP.y);
    } else {
      out.owner = { side, idx: carrierIdx };
      out.ball = v(ballP.x, ballP.y);
    }

    frames.push({ t, x: ballP.x, y: ballP.y });
    this.lastTouch = lastTouch;
    for (const d of this.discs) {
      const np = live.get(d.side * 5 + d.idx)!;
      d.p = v(np.x, np.y);
    }
    this.plans.clear();
    this.pendingOutcome = out;
    this.log.push(...events);
    return { frames, discMoves: moves, events, duration: t };
  }

  // ------------------------------------------------------------------ apply
  applyFlight(): TurnAdvance {
    if (this.phase !== "flight" || !this.pendingOutcome) throw new Error("nothing to apply");
    const out = this.pendingOutcome;
    this.pendingFlight = null;
    this.pendingOutcome = null;
    const adv: TurnAdvance = { tweens: [] };

    this.ball = v(out.ball.x, out.ball.y);

    if (out.goalFor !== undefined) {
      this.score[out.goalFor]++;
      const scorer = out.scorerIdx != null && out.scorerIdx >= 0
        ? this.player(out.goalFor, out.scorerIdx).name : undefined;
      adv.goal = { side: out.goalFor, own: out.ownGoal, scorer };
      const conceding = (1 - out.goalFor) as Side;
      if (this.checkClock(adv)) return adv;
      this.setupKickoff(conceding);
      adv.banner = out.ownGoal ? "OWN GOAL" : "GOAL";
      return adv;
    }

    if (out.foul) {
      this.owner = out.owner;
      if (out.foul.idx === 0) {
        // the keeper brought him down: spot kick
        this.penaltyFor = out.owner!.side;
        this.phase = "penalty";
        adv.penalty = true;
        adv.banner = "PENALTY!";
        return adv;
      }
      // free kick: possession kept, the defence stays frozen, no pressure —
      // and anyone crowding the taker is marched back to give him room
      this.kickProtected = true;
      if (this.checkClock(adv)) return adv;
      const dSide = this.defenseSide();
      this.pushBackFrom(this.ball, dSide, adv);
      adv.banner = "FREE KICK";
      this.shadeGk(dSide);
      this.phase = "aim";
      return adv;
    }

    if (out.restart === "kickin" || out.restart === "corner") {
      const toSide = (1 - this.lastTouch) as Side;
      let bi = 1, bd = 1e9;
      for (let i = 1; i < 5; i++) {
        const d = dist(this.disc(toSide, i).p, this.ball);
        if (d < bd) { bd = d; bi = i; }
      }
      const taker = this.disc(toSide, bi);
      const spot = this.spotNear(this.ball);
      adv.tweens.push({ side: toSide, idx: bi, from: v(taker.p.x, taker.p.y), to: spot });
      taker.p = spot;
      this.owner = { side: toSide, idx: bi };
      adv.banner = out.restart === "corner" ? "CORNER" : "KICK-IN";
    } else if (out.restart === "goalkick") {
      const s = (1 - this.lastTouch) as Side;
      this.shadeGk(s);
      this.ball = v(this.disc(s, 0).p.x, this.disc(s, 0).p.y + (s === 0 ? -2 : 2));
      this.owner = { side: s, idx: 0 };
      this.pushBackFrom(this.ball, (1 - s) as Side, adv);
      adv.banner = "GOAL KICK";
    } else if (out.owner) {
      this.owner = out.owner;
    } else {
      this.owner = { side: this.lastTouch, idx: 1 };
    }

    if (this.checkClock(adv)) return adv;
    this.separate(adv);
    this.startDefensePhase();
    return adv;
  }

  /** march one side's crowders back from a restart spot */
  private pushBackFrom(spot: V2, side: Side, adv: TurnAdvance) {
    for (let i = 0; i < 5; i++) {
      const d = this.disc(side, i);
      const dd = dist(d.p, spot);
      if (dd < TUNE.freeKickSpace) {
        const dir = dd > 0.01 ? norm(sub(d.p, spot)) : v(0, side === 0 ? 1 : -1);
        const np = this.clampOnPitch(add(spot, mul(dir, TUNE.freeKickSpace)), i === 0 ? side : undefined);
        adv.tweens.push({ side, idx: i, from: v(d.p.x, d.p.y), to: np });
        d.p = np;
      }
    }
  }

  private spotNear(ballPos: V2): V2 {
    const off = fromAng(angOf(sub(v(PITCH.W / 2, PITCH.H / 2), ballPos)), TUNE.discR + TUNE.ballR + 0.4);
    return this.clampOnPitch(add(ballPos, mul(off, -1)));
  }

  private checkClock(adv: TurnAdvance): boolean {
    const perHalf = this.kicksPerHalf;
    if (this.half === 1 && this.kicks >= perHalf) {
      this.half = 2;
      adv.halfTime = true;
      adv.banner = "HALF TIME";
      this.setupKickoff((1 - this.kickoffSide) as Side);
      return true;
    }
    if (this.half === 2 && this.kicks >= perHalf * 2) {
      if (this.opts.knockout && this.score[0] === this.score[1]) {
        adv.shootout = true;
        adv.banner = "PENALTIES";
        this.beginShootout();
      } else {
        adv.fullTime = true;
        adv.banner = "FULL TIME";
        this.phase = "over";
      }
      return true;
    }
    return false;
  }

  clockMin(): number {
    return Math.min(90, Math.floor((this.kicks / (this.kicksPerHalf * 2)) * 90));
  }

  private separate(adv?: TurnAdvance) {
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < this.discs.length; i++)
        for (let j = i + 1; j < this.discs.length; j++) {
          const a = this.discs[i], b = this.discs[j];
          const dd = dist(a.p, b.p);
          const min = TUNE.discR * 2.05;
          if (dd < min) {
            const push = mul(norm(sub(b.p, a.p)), (min - dd) / 2 + 0.01);
            if (!(this.owner && a.side === this.owner.side && a.idx === this.owner.idx)) a.p = this.clampOnPitch(sub(a.p, push), a.idx === 0 ? a.side : undefined);
            if (!(this.owner && b.side === this.owner.side && b.idx === this.owner.idx)) b.p = this.clampOnPitch(add(b.p, push), b.idx === 0 ? b.side : undefined);
          }
        }
    }
    if (adv) {
      for (const tw of adv.tweens) {
        const d = this.disc(tw.side, tw.idx);
        tw.to = v(d.p.x, d.p.y);
      }
    }
  }

  // --------------------------------------------------------------- shootout
  beginShootout() {
    this.phase = "shootout";
    this.pens = [];
    this.penScore = [0, 0];
    this.penShooterIdx = [0, 0];
    this.penWinner = null;
  }

  penShooters(side: Side): number[] {
    const t = this.teams[side];
    return [1, 2, 3, 4, 0].sort((a, b) => t.players[b].sho - t.players[a].sho);
  }

  penNextShooter(): { side: Side; idx: number; round: number } {
    const round = this.pens.length;
    const side = (round % 2 === 0 ? 0 : 1) as Side;
    const order = this.penShooters(side);
    const idx = order[this.penShooterIdx[side] % order.length];
    return { side, idx, round: Math.floor(round / 2) + 1 };
  }

  /** shared spot-kick resolution (shootout rounds and in-match penalties) */
  private resolvePen(shooter: MatchPlayer, gk: MatchPlayer, aimX01: number, power01: number) {
    const cone = (TUNE.coneBase + (99 - shooter.sho) * TUNE.coneStat) * (0.6 + power01);
    const spread = (cone / 28) * this.rng.noise();
    const bx = clamp(aimX01 + spread, -1.35, 1.35);
    const off = Math.abs(bx) > 1.04;
    let diveX: number;
    if (this.penDiveZone !== null) {
      diveX = this.penDiveZone * 0.62;
      this.penDiveZone = null;
    } else {
      const err = this.rng.noise() * (1.55 - gk.gk / 99) * 1.35;
      diveX = clamp(bx + err, -1, 1);
    }
    const reach = clamp(0.13 + gk.gk * 0.0024 - power01 * 0.06, 0.12, 0.42);
    const saved = !off && Math.abs(diveX - bx) < reach;
    return { scored: !off && !saved, saved, off, ballX: bx, diveX };
  }

  penKick(aimX01: number, power01: number): { scored: boolean; saved: boolean; off: boolean; ballX: number; diveX: number } {
    const { side, idx } = this.penNextShooter();
    const res = this.resolvePen(this.player(side, idx), this.player((1 - side) as Side, 0), aimX01, power01);
    this.pens.push({ shooter: side, scored: res.scored, saved: res.saved, off: res.off });
    if (res.scored) this.penScore[side]++;
    this.penShooterIdx[side]++;
    this.checkPenWinner();
    return res;
  }

  // ----------------------------------------------------- in-match penalties
  penaltyTaker(): { side: Side; idx: number } {
    const side = this.penaltyFor!;
    return { side, idx: this.penShooters(side)[0] };
  }

  matchPenalty(aimX01: number, power01: number): { scored: boolean; saved: boolean; off: boolean; ballX: number; diveX: number } {
    if (this.phase !== "penalty" || this.penaltyFor === null) throw new Error("no penalty pending");
    const { side, idx } = this.penaltyTaker();
    return this.resolvePen(this.player(side, idx), this.player((1 - side) as Side, 0), aimX01, power01);
  }

  /** apply the spot kick's result and restart play */
  finishMatchPenalty(scored: boolean): TurnAdvance {
    const side = this.penaltyFor!;
    this.penaltyFor = null;
    const adv: TurnAdvance = { tweens: [] };
    if (scored) {
      this.score[side]++;
      adv.goal = { side, scorer: this.player(side, this.penShooters(side)[0]).name };
      if (this.checkClock(adv)) return adv;
      this.setupKickoff((1 - side) as Side);
      adv.banner = "GOAL";
      return adv;
    }
    const s = (1 - side) as Side;
    this.shadeGk(s);
    this.ball = v(this.disc(s, 0).p.x, this.disc(s, 0).p.y + (s === 0 ? -2 : 2));
    this.owner = { side: s, idx: 0 };
    this.pushBackFrom(this.ball, (1 - s) as Side, adv);
    if (this.checkClock(adv)) return adv;
    this.startDefensePhase();
    return adv;
  }

  private checkPenWinner() {
    const a = this.penScore[0], b = this.penScore[1];
    const taken = [this.pens.filter((p) => p.shooter === 0).length, this.pens.filter((p) => p.shooter === 1).length];
    const left = [Math.max(0, 5 - taken[0]), Math.max(0, 5 - taken[1])];
    if (taken[0] >= 5 && taken[1] >= 5) {
      if (taken[0] === taken[1] && a !== b) this.penWinner = a > b ? 0 : 1;
    } else {
      if (a > b + left[1]) this.penWinner = 0;
      else if (b > a + left[0]) this.penWinner = 1;
    }
    if (this.penWinner !== null) this.phase = "over";
  }

  winner(): Side | null {
    if (this.score[0] !== this.score[1]) return this.score[0] > this.score[1] ? 0 : 1;
    if (this.penWinner !== null) return this.penWinner;
    return null;
  }
}
