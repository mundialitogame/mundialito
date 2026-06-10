import { Match } from "../engine/match.ts";
import type { FlightResult, TurnAdvance, Side } from "../engine/match.ts";
import { aiChooseKick, aiDefense, aiAttackRuns, aiMaybeDribble } from "../engine/ai.ts";
import { TUNE, PITCH } from "../engine/tuning.ts";
import type { Team } from "../data/types.ts";
import { PitchRenderer, freshRenderState } from "./pitch.ts";
import type { RenderState } from "./pitch.ts";
import { h, clear, surname } from "./dom.ts";
import * as sfx from "../audio/sfx.ts";

export interface MatchResult {
  sa: number;
  sb: number;
  pens?: [number, number];
  resigned?: boolean;
}

export interface MatchOptions {
  user: Team;
  opp: Team;
  formations: [string, string];
  knockout: boolean;
  aiSkill: number;
  kicksPerHalf: number;
  seed: number;
  onDone: (r: MatchResult) => void;
}

type InputMode = "none" | "defense" | "aim" | "pen-aim";

export function startMatch(o: MatchOptions): HTMLElement {
  const m = new Match([o.user, o.opp], {
    seed: o.seed, knockout: o.knockout, aiSkill: o.aiSkill,
    kicksPerHalf: o.kicksPerHalf, formations: o.formations
  });

  // ---- DOM scaffold -------------------------------------------------------
  const canvas = h("canvas", { class: "pitch" });
  const hint = h("div", { class: "hint" }, "");
  const doneBtn = h("button", { class: "btn small primary", style: "display:none" }, "DONE");
  const modeBtn = h("button", { class: "btn small gold", style: "display:none" }, "PASS");
  const menuBtn = h("button", { class: "btn small ghost", style: "color:var(--paper);border-color:var(--paper)" }, "II");
  const score = h("div", { class: "scoreboard" });
  const bannerLayer = h("div");
  const pensLayer = h("div");
  const root = h("div", { class: "match-root" },
    canvas,
    h("div", { class: "hud-top" }, score),
    h("div", { class: "hud-bottom" }, hint, h("div", { class: "row" }, modeBtn, doneBtn, menuBtn)),
    bannerLayer, pensLayer
  );

  const R = new PitchRenderer(canvas);
  const rs: RenderState = freshRenderState();
  let mode: InputMode = "none";
  let raf = 0;
  let finished = false;
  const onResize = () => R.fit();
  window.addEventListener("resize", onResize);

  function updateScore() {
    clear(score);
    const remaining = m.kicksPerHalf * m.half - m.kicks;
    score.append(
      h("span", {}, `${o.user.code}`),
      h("span", { class: "clock" }, `${String(m.score[0])}–${String(m.score[1])}`),
      h("span", {}, `${o.opp.code}`),
      h("span", { class: "clock" + (remaining <= 3 ? " late" : "") },
        `${m.clockMin()}’${remaining <= 3 ? (m.half === 1 ? " HT⏳" : " FT⏳") : ""}`)
    );
  }

  function lastName(n: string): string {
    return surname(n).toUpperCase();
  }

  function setHint(t: string) { hint.textContent = t; }

  let kickMode: "kick" | "dribble" = "kick";
  let defMode: "move" | "tackle" = "move";
  function updateDone() {
    const userDef = m.phase === "defense" && m.defenseSide() === 0;
    const userAim = m.phase === "aim" && m.owner?.side === 0;
    doneBtn.style.display = userDef ? "" : "none";
    modeBtn.style.display = userDef || userAim ? "" : "none";
    if (userDef) {
      modeBtn.textContent = defMode === "move" ? "MOVE" : "TACKLE";
      modeBtn.classList.toggle("hot", defMode === "tackle");
    } else {
      modeBtn.textContent = kickMode === "kick" ? "KICK" : "DRIBBLE";
      modeBtn.classList.remove("hot");
    }
  }

  modeBtn.onclick = () => {
    sfx.tick();
    if (m.phase === "defense" && m.defenseSide() === 0) {
      defMode = defMode === "move" ? "tackle" : "move";
      setHint(defMode === "move"
        ? "DEFEND — DRAG PLAYERS TO PLAN RUNS, THEN DONE"
        : "TACKLE — DRAG A PLAYER TO COMMIT A CHALLENGE (FOUL RISK!)");
    } else {
      kickMode = kickMode === "kick" ? "dribble" : "kick";
      rs.dribbleTarget = null;
      rs.aim = null;
      setHint(kickMode === "kick"
        ? `${lastName(m.player(0, m.kicker().idx).name)} ON THE BALL — PLAN RUNS, THEN DRAG TO KICK`
        : "DRAG A PATH TO RUN WITH THE BALL — DEFENDERS NEARBY WILL CHALLENGE");
    }
    updateDone();
  };

  function banner(text: string, sub = false, ms = 1100): Promise<void> {
    const b = h("div", { class: "banner" + (sub ? " sub" : "") }, text);
    bannerLayer.append(b);
    return new Promise((res) => setTimeout(() => { b.remove(); res(); }, ms));
  }

  // ---- render loop --------------------------------------------------------
  function loop() {
    rs.shake *= 0.86;
    rs.flash *= 0.9;
    for (const p of rs.particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life -= 0.012;
    }
    rs.particles = rs.particles.filter((p) => p.life > 0);
    for (const t of rs.trail) t.a *= 0.86;
    rs.trail = rs.trail.filter((t) => t.a > 0.04);
    R.draw(m, rs);
    raf = requestAnimationFrame(loop);
  }

  function confetti() {
    const w = canvas.clientWidth;
    const cols = ["#e8542f", "#d9a521", "#0e7c66", "#2b6cb0", "#f4f1e4"];
    for (let i = 0; i < 90; i++) {
      rs.particles.push({
        x: Math.random() * w, y: -10 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 2.4, vy: 1.5 + Math.random() * 2.5,
        life: 1 + Math.random() * 0.6, col: cols[i % cols.length], r: 2 + Math.random() * 2.5
      });
    }
  }

  // ---- input --------------------------------------------------------------
  // dragging from one of your discs lays a planned run (dotted arrow);
  // a quick tap on a disc clears its plan; dragging anywhere else aims
  // (or, in dribble mode, draws the carry path).
  let dragStart: { x: number; y: number } | null = null;
  let dragDiscIdx: number | null = null;
  let downAt: { x: number; y: number } | null = null;
  let dragMoved = false;
  let flickVel = 0;
  let lastMove: { x: number; y: number; t: number } | null = null;

  function grabOwnDisc(cx: number, cy: number): number {
    let best = -1, bd = 38;
    for (let i = 0; i < 5; i++) {
      const d = m.disc(0, i);
      const dd = Math.hypot(R.px(d.p.x) - cx, R.py(d.p.y) - cy);
      if (dd < bd && m.canPlan(i)) { bd = dd; best = i; }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    sfx.unlockAudio();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    downAt = { x: cx, y: cy };
    dragMoved = false;
    if (mode === "defense" || mode === "aim") {
      const best = grabOwnDisc(cx, cy);
      if (best >= 0 && m.planningSide() === 0) {
        dragDiscIdx = best;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (mode === "aim" || mode === "pen-aim") {
      dragStart = { x: cx, y: cy };
      flickVel = 0;
      lastMove = { x: cx, y: cy, t: performance.now() };
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    if (downAt && Math.hypot(cx - downAt.x, cy - downAt.y) > 9) dragMoved = true;
    if (dragDiscIdx !== null) {
      if (dragMoved) m.planMove(dragDiscIdx, R.toPitch(cx, cy), mode === "defense" && defMode === "tackle");
    } else if ((mode === "aim" || mode === "pen-aim") && dragStart) {
      if (mode === "aim" && kickMode === "dribble") {
        rs.dribbleTarget = R.toPitch(cx, cy);
        return;
      }
      // flick speed adds power — a sharp snap beats running out of screen
      const now = performance.now();
      if (lastMove) {
        const inst = Math.hypot(cx - lastMove.x, cy - lastMove.y) / Math.max(1, now - lastMove.t);
        flickVel = flickVel * 0.72 + inst * 0.28;
      }
      lastMove = { x: cx, y: cy, t: now };
      const dx = dragStart.x - cx, dy = dragStart.y - cy; // drag back -> kick forward
      const lenPx = Math.hypot(dx, dy);
      const maxPx = canvas.clientHeight * 0.3;
      const boost = Math.max(0, Math.min(0.55, flickVel * 0.22 - 0.12));
      rs.aim = { dir: Math.atan2(dy, dx), power: Math.min(1, lenPx / maxPx + boost) };
    }
  });

  const endDrag = (e: PointerEvent) => {
    if (dragDiscIdx !== null) {
      if (!dragMoved) m.clearPlan(dragDiscIdx); // tap = cancel the run
      dragDiscIdx = null;
      downAt = null;
      return;
    }
    downAt = null;
    if (mode === "aim" && kickMode === "dribble" && rs.dribbleTarget) {
      const target = rs.dribbleTarget;
      rs.dribbleTarget = null;
      dragStart = null;
      const carrier = m.disc(0, m.kicker().idx).p;
      if (Math.hypot(target.x - carrier.x, target.y - carrier.y) > 4.5) {
        mode = "none";
        rs.showRadii = null;
        void takeDribble(target);
      }
      return;
    }
    if ((mode === "aim" || mode === "pen-aim") && dragStart && rs.aim) {
      const a = rs.aim;
      dragStart = null;
      rs.aim = null;
      if (a.power < 0.07) return; // cancelled
      if (mode === "aim") {
        // releasing on top of the kicker = never mind (mis-grab safety)
        const rect = canvas.getBoundingClientRect();
        const kd = m.disc(0, m.kicker().idx).p;
        const rel = Math.hypot(e.clientX - rect.left - R.px(kd.x), e.clientY - rect.top - R.py(kd.y));
        if (rel < 48) return;
        mode = "none";
        rs.showRadii = null;
        void takeKick(a.dir, a.power);
      } else {
        mode = "none";
        void resolveUserPen(a.dir, a.power);
      }
    }
    dragStart = null;
    void e;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  doneBtn.onclick = () => {
    if (m.phase !== "defense" || m.defenseSide() !== 0) return;
    sfx.tick();
    mode = "none";
    m.commitDefense();
    updateDone();
    void pump();
  };

  menuBtn.onclick = () => {
    const dlg = h("dialog", { class: "modal" },
      h("h3", {}, "PAUSED"),
      h("button", { class: "btn primary", onclick: () => dlg.close() }, "RESUME"),
      h("button", {
        class: "btn hot", onclick: () => { dlg.close(); finish({ sa: m.score[0], sb: Math.max(m.score[1], m.score[0] + 2), resigned: true }); }
      }, "RESIGN MATCH"),
      h("p", { class: "sm muted center" }, "Resigning forfeits this fixture 0–2.")
    );
    document.body.append(dlg);
    dlg.showModal();
    dlg.onclose = () => dlg.remove();
  };

  // ---- turn pump ----------------------------------------------------------
  async function pump(): Promise<void> {
    if (finished) return;
    updateScore();
    updateDone();
    if (m.phase === "over") {
      finish({ sa: m.score[0], sb: m.score[1], pens: m.penWinner !== null ? [m.penScore[0], m.penScore[1]] : undefined });
      return;
    }
    if (m.phase === "shootout") return pumpShootout();
    if (m.phase === "penalty") return pumpMatchPenalty();
    if (m.phase === "defense") {
      if (m.defenseSide() === 0) {
        mode = "defense";
        defMode = "move";
        rs.showRadii = 0;
        setHint("DEFEND — DRAG PLAYERS TO PLAN RUNS, THEN DONE");
        updateDone();
        return; // wait for Done
      }
      aiDefense(m);
      await wait(240);
      return pump();
    }
    if (m.phase === "aim") {
      if (m.kicker().side === 0) {
        mode = "aim";
        kickMode = "kick";
        rs.showRadii = 1;
        setHint(`${lastName(m.player(0, m.kicker().idx).name)} ON THE BALL — PLAN RUNS, THEN DRAG TO KICK`);
        updateDone();
        return; // wait for release
      }
      const carrier = m.player(1, m.kicker().idx);
      setHint(`${lastName(carrier.name)} ON THE BALL…`);
      await wait(TUNE.aiThinkMs * (0.5 + Math.random() * 0.6));
      aiAttackRuns(m);
      const dribbleTo = aiMaybeDribble(m);
      if (dribbleTo) return takeDribble(dribbleTo);
      const c = aiChooseKick(m);
      return takeKick(c.dir, c.power01);
    }
  }

  async function takeKick(dir: number, power: number): Promise<void> {
    setHint("");
    rs.hidePlans = true;
    const fr = m.kick(dir, power);
    sfx.thock(power);
    await playFlight(fr);
    rs.hidePlans = false;
    const adv = m.applyFlight();
    await playAdvance(adv);
    return pump();
  }

  async function takeDribble(target: { x: number; y: number }): Promise<void> {
    setHint("");
    rs.hidePlans = true;
    kickMode = "kick"; // next turn starts fresh
    const fr = m.dribble(target);
    sfx.tick();
    await playFlight(fr);
    rs.hidePlans = false;
    const adv = m.applyFlight();
    await playAdvance(adv);
    return pump();
  }

  function glide(before: Map<number, { x: number; y: number }>, ms: number): Promise<void> {
    return new Promise((res) => {
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        for (const [key, from] of before) {
          const d = m.discs[key];
          rs.discOverride.set(key, { x: from.x + (d.p.x - from.x) * e, y: from.y + (d.p.y - from.y) * e });
        }
        if (k < 1) requestAnimationFrame(step);
        else { rs.discOverride.clear(); res(); }
      };
      step();
    });
  }

  function playFlight(fr: FlightResult): Promise<void> {
    return new Promise((res) => {
      const t0 = performance.now();
      const dur = fr.duration;
      let evIdx = 0;
      const step = () => {
        const t = Math.min(dur, (performance.now() - t0) / 1000);
        // ball position from frames
        let lo = 0, hi = fr.frames.length - 1;
        while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (fr.frames[mid].t <= t) lo = mid; else hi = mid; }
        const a = fr.frames[lo], b = fr.frames[hi];
        const k = Math.min(1, Math.max(0, b.t > a.t ? (t - a.t) / (b.t - a.t) : 1));
        const bx = a.x + (b.x - a.x) * k;
        const by = a.y + (b.y - a.y) * k;
        rs.ballOverride = { x: bx, y: by };
        rs.ballAir = (a.air ?? 0) + ((b.air ?? 0) - (a.air ?? 0)) * k;
        rs.trail.push({ x: bx, y: by, a: 0.8 });
        // disc moves
        for (const mv of fr.discMoves) {
          const key = mv.side * 5 + mv.idx;
          if (t < mv.t0) continue;
          const kk = mv.t1 > mv.t0 ? Math.min(1, (t - mv.t0) / (mv.t1 - mv.t0)) : 1;
          const e = 1 - Math.pow(1 - kk, 2);
          rs.discOverride.set(key, { x: mv.from.x + (mv.to.x - mv.from.x) * e, y: mv.from.y + (mv.to.y - mv.from.y) * e });
        }
        // event SFX
        while (evIdx < fr.events.length && fr.events[evIdx].t <= t) {
          const ev = fr.events[evIdx++];
          if (ev.kind === "post") { sfx.ping(); sfx.cheer(0.4); }
          else if (ev.kind === "foul") { sfx.thud(); sfx.whistle(2); }
          else if (ev.kind === "intercept" || ev.kind === "steal" || ev.kind === "block" || ev.kind === "tackle" || ev.kind === "challenge") sfx.thud();
          else if (ev.kind === "save-catch" || ev.kind === "save-parry") { sfx.thud(); sfx.cheer(0.35); }
          else if (ev.kind === "trap" || ev.kind === "loose" || ev.kind === "through") sfx.tick();
          else if (ev.kind === "goal" || ev.kind === "own-goal") { sfx.cheer(1); rs.shake = 13; rs.flash = 1; confetti(); }
          else if (ev.kind === "corner" || ev.kind === "kickin" || ev.kind === "goalkick") sfx.whistle(1);
        }
        if (t < dur) requestAnimationFrame(step);
        else { rs.ballOverride = null; rs.ballAir = 0; rs.discOverride.clear(); res(); }
      };
      step();
    });
  }

  async function playAdvance(adv: TurnAdvance): Promise<void> {
    updateScore();
    if (adv.goal) {
      const who = adv.goal.scorer && !adv.goal.own ? ` ${lastName(adv.goal.scorer)}` : "";
      await banner(adv.goal.own ? "OWN GOAL!" : `GOAL!${who}`, false, 1450);
    } else if (adv.banner && adv.banner !== "GOAL") {
      await banner(adv.banner, true, 750);
    }
    if (adv.tweens.length) {
      const before = new Map<number, { x: number; y: number }>();
      for (const tw of adv.tweens) before.set(tw.side * 5 + tw.idx, tw.from);
      await glide(before, 430);
    }
    if (adv.halfTime) {
      sfx.whistle(2);
      await banner("HALF TIME", true, 1500);
    }
    if (adv.shootout) {
      sfx.whistle(2);
      await banner("PENALTIES", false, 1500);
    }
    if (adv.fullTime) sfx.whistle(3);
  }

  // ---- shootout -----------------------------------------------------------
  const pensBoard = h("div", { class: "pens-board" });
  function showPensBoard() {
    clear(pensLayer);
    pensLayer.append(h("div", { class: "pens-overlay" }, pensBoard));
  }

  function pensDots(side: Side): HTMLElement {
    const row = h("div", { class: "pens-dots" });
    const taken = m.pens.filter((p) => p.shooter === side);
    const total = Math.max(5, taken.length);
    for (let i = 0; i < total; i++) {
      const p = taken[i];
      row.append(h("span", { class: "pen-dot" + (p ? (p.scored ? " s" : " m") : "") }));
    }
    return row;
  }

  function stagePenalty(side: Side, idx: number) {
    // theatre: everyone to the halfway line, keeper in goal, ball on the spot
    rs.discOverride.clear();
    let slot = 0;
    for (const d of m.discs) {
      rs.discOverride.set(d.side * 5 + d.idx, { x: 6 + slot * 5.3, y: 55 });
      slot++;
    }
    rs.discOverride.set((1 - side) * 5, { x: PITCH.W / 2, y: PITCH.gkY });
    rs.discOverride.set(side * 5 + idx, { x: PITCH.W / 2 + 4, y: 17.5 });
    rs.ballOverride = { x: PITCH.W / 2, y: 13 };
  }

  function clearPenStage() {
    rs.ballOverride = null;
    rs.discOverride.clear();
    clear(pensLayer);
  }

  let penContext: "shootout" | "single" = "shootout";

  // ---- in-match penalty (keeper's foul) ----
  async function pumpMatchPenalty(): Promise<void> {
    const tk = m.penaltyTaker();
    const taker = m.player(tk.side, tk.idx);
    penContext = "single";
    showPensBoard();
    stagePenalty(tk.side, tk.idx);
    clear(pensBoard);
    pensBoard.append(
      h("div", { class: "kicker" }, "PENALTY"),
      h("h3", {}, `${taker.name} steps up`)
    );
    if (tk.side === 0) {
      mode = "pen-aim";
      setHint("DRAG BACK TO PLACE YOUR PENALTY");
    } else {
      mode = "none";
      setHint("PICK A SIDE TO DIVE");
      const zr = h("div", { class: "zone-row" });
      for (const [label, z] of [["LEFT", -1], ["MIDDLE", 0], ["RIGHT", 1]] as const) {
        zr.append(h("button", {
          class: "btn small", onclick: () => { zr.remove(); void resolveAiMatchPen(z); }
        }, label));
      }
      pensBoard.append(zr);
    }
  }

  async function finishSinglePen(res: { scored: boolean; saved: boolean; off: boolean; ballX: number; diveX: number }, shooter: Side): Promise<void> {
    await animatePen(res, shooter);
    clearPenStage();
    const adv = m.finishMatchPenalty(res.scored);
    await playAdvance(adv);
    return pump();
  }

  async function resolveAiMatchPen(zone: -1 | 0 | 1): Promise<void> {
    m.penDiveZone = zone;
    const aim = m.rng.next() < 0.5 ? -0.78 : 0.78;
    return finishSinglePen(m.matchPenalty(aim, 0.75 + m.rng.next() * 0.25), 1);
  }

  async function pumpShootout(): Promise<void> {
    if (m.penWinner !== null) {
      rs.ballOverride = null;
      rs.discOverride.clear();
      finish({ sa: m.score[0], sb: m.score[1], pens: [m.penScore[0], m.penScore[1]] });
      return;
    }
    penContext = "shootout";
    showPensBoard();
    const nx = m.penNextShooter();
    stagePenalty(nx.side, nx.idx);
    const shooter = m.player(nx.side, nx.idx);
    clear(pensBoard);
    pensBoard.append(
      h("div", { class: "kicker" }, `ROUND ${nx.round} — ${nx.side === 0 ? "YOU" : o.opp.name.toUpperCase()}`),
      h("h3", {}, `${shooter.name} steps up`),
      pensDots(0), pensDots(1)
    );
    if (nx.side === 0) {
      mode = "pen-aim";
      setHint("DRAG BACK TO PLACE YOUR PENALTY");
    } else {
      mode = "none";
      setHint("PICK A SIDE TO DIVE");
      const zr = h("div", { class: "zone-row" });
      for (const [label, z] of [["LEFT", -1], ["MIDDLE", 0], ["RIGHT", 1]] as const) {
        zr.append(h("button", {
          class: "btn small", onclick: () => { zr.remove(); void resolveAiPen(z); }
        }, label));
      }
      pensBoard.append(zr);
    }
  }

  async function resolveUserPen(dir: number, power: number): Promise<void> {
    // where does this aim line cross the goal line?
    const spot = { x: PITCH.W / 2, y: 13 };
    const sin = Math.sin(dir);
    let aimX01 = 0;
    if (sin < -0.05) {
      const tT = (0 - spot.y) / sin;
      aimX01 = (spot.x + Math.cos(dir) * tT - PITCH.W / 2) / PITCH.goalHalf;
    } else {
      aimX01 = 1.5; // ballooned it
    }
    if (penContext === "single") return finishSinglePen(m.matchPenalty(aimX01, power), 0);
    await animatePen(m.penKick(aimX01, power), 0);
    return pumpShootout();
  }

  async function resolveAiPen(zone: -1 | 0 | 1): Promise<void> {
    m.penDiveZone = zone;
    const aim = m.rng.next() < 0.5 ? -0.78 : 0.78;
    await animatePen(m.penKick(aim, 0.75 + m.rng.next() * 0.25), 1);
    return pumpShootout();
  }

  function animatePen(res: { scored: boolean; saved: boolean; off: boolean; ballX: number; diveX: number }, shooter: Side): Promise<void> {
    sfx.thock(0.9);
    return new Promise((done) => {
      const gkKey = (1 - shooter) * 5;
      const t0 = performance.now();
      const from = { x: PITCH.W / 2, y: 13 };
      const to = { x: PITCH.W / 2 + res.ballX * PITCH.goalHalf, y: res.off ? -2.5 : -0.6 };
      const gkFrom = { x: PITCH.W / 2, y: PITCH.gkY };
      const gkTo = { x: PITCH.W / 2 + res.diveX * PITCH.goalHalf, y: PITCH.gkY * 0.8 };
      const step = async () => {
        const k = Math.min(1, (performance.now() - t0) / 330);
        rs.ballOverride = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        rs.discOverride.set(gkKey, { x: gkFrom.x + (gkTo.x - gkFrom.x) * k, y: gkFrom.y + (gkTo.y - gkFrom.y) * k });
        if (k < 1) { requestAnimationFrame(step); return; }
        if (res.scored) { sfx.cheer(shooter === 0 ? 1 : 0.4); rs.shake = 8; rs.flash = 0.7; }
        else { sfx.thud(); sfx.cheer(0.3); }
        await banner(res.scored ? "GOAL!" : res.off ? "WIDE!" : "SAVED!", true, 850);
        done();
      };
      step();
    });
  }

  // ---- lifecycle ----------------------------------------------------------
  function finish(r: MatchResult) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    root.remove();
    o.onDone(r);
  }

  const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

  // boot
  requestAnimationFrame(() => {
    R.fit();
    loop();
    sfx.unlockAudio();
    sfx.whistle(1);
    updateScore();
    void pump();
  });

  return root;
}
