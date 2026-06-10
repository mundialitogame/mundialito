// Headless engine validation. Run: node scripts/simtest.ts
import { readFileSync } from "node:fs";
import { Match } from "../src/engine/match.ts";
import { aiChooseKick, aiDefense, aiAttackRuns, aiMaybeDribble, buildNationTeam, nationFormation } from "../src/engine/ai.ts";
import { Draft, defaultStarters, PICKS } from "../src/game/draft.ts";
import {
  newRun, userNextOpponent, recordUserGroupMatch, buildR32, recordUserKnockout,
  completeKnockoutRound, simGroupMatchday, groupTable, userGroupIdx, USER
} from "../src/game/tournament.ts";
import type { SquadData } from "../src/data/types.ts";

const data: SquadData = JSON.parse(readFileSync(new URL("../src/data/squads.json", import.meta.url), "utf-8"));

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error("  ✗ FAIL:", msg); }
  else console.log("  ✓", msg);
};

// ---------------------------------------------------------------- data
console.log("[data]");
ok(data.nations.length === 48, "48 nations");
ok(data.nations.every((n) => n.players.length >= 23), "every squad ≥23 players");
ok(data.nations.every((n) => n.players.filter((p) => p.pos === "GK").length >= 3), "every squad ≥3 GKs");
ok(data.nations.every((n) => n.players.filter((p) => p.d).length === 10), "every nation lists 10 draftables");
ok(data.nations.every((n) => n.players.filter((p) => p.d && p.pos === "GK").length >= 2), "draftables include ≥2 GKs");
ok(data.nations.filter((n) => n.pot === 1).length === 12, "12 nations per pot");

// ---------------------------------------------------------------- match
const skillOf = (r: number) => Math.max(0.2, Math.min(0.97, 0.22 + ((r - 70) / 22) * 0.55));
function playMatch(aName: string, bName: string, seed: number, knockout = false) {
  const NA = data.nations.find((n) => n.name === aName)!;
  const NB = data.nations.find((n) => n.name === bName)!;
  const A = buildNationTeam(NA);
  const B = buildNationTeam(NB);
  const m = new Match([A, B], {
    seed, knockout, aiSkill: 0.8, kicksPerHalf: 24,
    formations: [nationFormation(A), nationFormation(B)]
  });
  const sk = [skillOf(NA.rating), skillOf(NB.rating)];
  let guard = 0;
  while (m.phase !== "over" && guard++ < 600) {
    if (m.phase === "defense") {
      m.opts.aiSkill = sk[m.defenseSide()];
      aiDefense(m);
    } else if (m.phase === "aim") {
      m.opts.aiSkill = sk[m.kicker().side];
      aiAttackRuns(m);
      const dribbleTo = aiMaybeDribble(m);
      if (dribbleTo) {
        m.dribble(dribbleTo);
        m.applyFlight();
        continue;
      }
      const c = aiChooseKick(m);
      m.kick(c.dir, c.power01);
      m.applyFlight();
    } else if (m.phase === "penalty") {
      const r = m.matchPenalty(m.rng.next() < 0.5 ? -0.8 : 0.8, 0.85);
      m.finishMatchPenalty(r.scored);
    } else if (m.phase === "shootout") {
      m.penKick(m.rng.next() < 0.5 ? -0.8 : 0.8, 0.85);
    } else break;
  }
  return m;
}

console.log("[match engine]");
const m1 = playMatch("France", "Cape Verde", 1234);
ok(m1.phase === "over", "match reaches full time");
ok(m1.kicks >= 48, `clock driven by kicks (${m1.kicks})`);
const m2 = playMatch("France", "Cape Verde", 1234);
ok(m1.score[0] === m2.score[0] && m1.score[1] === m2.score[1] && m1.log.length === m2.log.length,
  `deterministic for same seed (${m1.score.join("-")})`);

const mk = playMatch("Croatia", "Japan", 777, true);
ok(mk.winner() !== null, `knockout always produces a winner (${mk.score.join("-")}${mk.penWinner !== null ? " pens " + mk.penScore.join("-") : ""})`);

// strength expression: France should clearly beat Cape Verde across many seeds
let fw = 0, cw = 0, fg = 0, cg = 0, draws = 0;
for (let s = 0; s < 40; s++) {
  const m = playMatch("France", "Cape Verde", 9000 + s);
  fg += m.score[0]; cg += m.score[1];
  if (m.score[0] > m.score[1]) fw++;
  else if (m.score[1] > m.score[0]) cw++;
  else draws++;
}
console.log(`  France ${fw}W ${draws}D ${cw}L vs Cape Verde, goals ${fg}:${cg}`);
ok(fw >= cw * 2.2, "elite team wins much more than it loses vs minnow");
ok(fg > cg * 1.6, "elite team out-scores minnow");
ok(fg / 40 < 7, `scorelines stay football-shaped (avg ${(fg / 40).toFixed(1)} gpg)`);

// GK value: identical shot barrage vs an elite keeper and a weak one
{
  const shotsAt = (gkName: string, gkStat: number): number => {
    const A = buildNationTeam(data.nations.find((n) => n.name === "Argentina")!);
    const B = buildNationTeam(data.nations.find((n) => n.name === "Belgium")!);
    B.players[0] = { ...B.players[0], name: gkName, gk: gkStat };
    let goals = 0;
    for (let s = 0; s < 220; s++) {
      const m = new Match([A, B], { seed: 4000 + s, knockout: false, aiSkill: 0.8, kicksPerHalf: 24 });
      // hand-craft a clean strike from 22u, aimed just inside the post,
      // with every outfielder parked far away: pure striker vs keeper
      for (let i = 1; i < 5; i++) {
        m.disc(1, i).p = { x: 6 + i * 13, y: 80 };
        if (i !== 4) m.disc(0, i).p = { x: 6 + i * 13, y: 88 };
      }
      m.disc(0, 0).p = { x: 32, y: 93 };
      m.disc(0, 4).p = { x: 30, y: 22 };
      m.ball = { x: 30, y: 22 };
      m.owner = { side: 0, idx: 4 };
      m.phase = "aim";
      // grounded drive (below the aerial band) — this probes the keeper duel
      const r = m.kick(Math.atan2(-22, (32 + 6.2) - 30), 0.78);
      for (const e of r.events) if (e.kind === "goal") goals++;
    }
    return goals;
  };
  const vsElite = shotsAt("EliteGK", 92);
  const vsWeak = shotsAt("WeakGK", 64);
  console.log(`  identical 220-shot barrage: ${vsElite} goals past elite GK, ${vsWeak} past weak GK`);
  ok(vsWeak > vsElite * 1.3, "a top keeper measurably reduces goals conceded");
  ok(vsElite > 8, "even elite keepers are beatable by good strikes");
}

// ---------------------------------------------------------------- draft
console.log("[draft]");
{
  const d = new Draft(data, 42);
  let skipsUsed = 0;
  while (!d.state.done) {
    if (skipsUsed < 2 && d.canSkip() && d.state.round === 2) { d.skip(); skipsUsed++; continue; }
    const list = d.pickable();
    ok(list.length > 0, `round ${d.state.round}: pickable list non-empty (${d.state.nation})`);
    // deliberately avoid GK until forced, to test the constraint
    const nonGk = list.filter((p) => p.pos !== "GK");
    const choice = d.mustPickGk() ? list[0] : (nonGk[0] ?? list[0]);
    d.pick(choice.name);
  }
  ok(d.state.picks.length === PICKS, `draft completes with ${PICKS} picks`);
  ok(d.hasGk(), "GK constraint enforced by final round");
  ok(new Set(d.state.picks.map((p) => p.nation)).size === PICKS, "one player per nation");
  const starters = defaultStarters(data, d.state.picks);
  ok(starters.length === 5, "default starting five chosen");
  const gk = d.playerOf(d.state.picks[starters[0]]);
  ok(gk?.pos === "GK", "starter slot 0 is the GK");
}

// ------------------------------------------------------------- tournament
console.log("[tournament]");
{
  const d = new Draft(data, 7);
  while (!d.state.done) {
    const list = d.pickable();
    const pick = d.mustPickGk() ? list[0] : list.slice().sort((a, b) => b.ovr - a.ovr)[0];
    d.pick(pick.name);
  }
  const starters = defaultStarters(data, d.state.picks);
  const run = newRun(data, "THE GAFFERS XI", d.state.picks, starters, "diamond", 24, 99);
  ok(run.groups.length === 12 && run.groups.every((g) => g.length === 4), "12 groups of 4");
  ok(run.groups.flat().includes(USER), "user team is in the draw");
  ok(new Set(run.groups.flat()).size === 48, "48 distinct teams in groups");

  // play group stage (user matches via quick sim: use engine-level random result)
  for (let md = 0; md < 3; md++) {
    const opp = userNextOpponent(run)!;
    ok(!!opp, `matchday ${md + 1} has an opponent (${opp})`);
    recordUserGroupMatch(data, run, md === 2 ? 2 : 1, md === 1 ? 1 : 0); // 2W 1D
  }
  simGroupMatchday(data, run, 0); simGroupMatchday(data, run, 1); simGroupMatchday(data, run, 2);
  const tbl = groupTable(run, userGroupIdx(run));
  ok(tbl.every((s) => s.played === 3), "all group matches resolved");
  buildR32(data, run);
  ok(run.bracket[0].length === 16, "R32 has 16 ties");
  ok(run.alive, "user qualifies after 2W 1D");

  // knockout: user wins every round 1-0
  let rounds = 0;
  while (run.alive && run.stage >= 1 && run.stage <= 5 && rounds++ < 6) {
    const opp = userNextOpponent(run);
    ok(!!opp, `stage ${run.stage}: user has an opponent (${opp})`);
    recordUserKnockout(run, 1, 0);
    completeKnockoutRound(data, run);
  }
  ok(run.stage === 6 && run.champion === USER, `user lifts the trophy (${run.placed})`);
  ok(run.bracket.map((r) => r.length).join(",") === "16,8,4,2,1", "bracket telescopes 16,8,4,2,1");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall good");
process.exit(failures ? 1 : 0);
