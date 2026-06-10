import { Rng, hashStr } from "../engine/rng.ts";
import type { SquadData, Team, MatchPlayer } from "../data/types.ts";
import type { DraftPick } from "./draft.ts";
import { buildNationTeam, nationFormation } from "../engine/ai.ts";

export const USER = "YOU";
export const STAGES = ["Group Stage", "Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"] as const;

export interface TieResult { a: string; b: string; sa?: number; sb?: number; pa?: number; pb?: number; winner?: string }

export interface RunState {
  v: 1;
  seed: number;
  teamName: string;
  picks: DraftPick[];
  starters: number[]; // 5 indices into picks, [0] = GK
  formation: string;
  kicksPerHalf: number;
  groups: string[][]; // 12 groups of 4 ids (nation name or USER)
  groupResults: Record<string, [number, number]>; // "a@b" in fixture order
  stage: number; // 0 group (sub-stage groupMd), 1..5 knockout rounds, 6 finished
  groupMd: number; // 0..2 user matchday
  bracket: TieResult[][]; // [round][tie]
  alive: boolean;
  champion?: string;
  placed?: string; // text of final outcome
}

const MD_PAIRS: [number, number][][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]]
];

export function userTeamRating(data: SquadData, picks: DraftPick[], starters: number[]): number {
  const ps = starters.map((i) => pickPlayer(data, picks[i]));
  return Math.round((ps.reduce((a, p) => a + p.ovr, 0) / ps.length) * 10) / 10;
}

export function pickPlayer(data: SquadData, pk: DraftPick): MatchPlayer {
  const n = data.nations.find((x) => x.name === pk.nation)!;
  const p = n.players.find((x) => x.name === pk.player)!;
  return { ...p, nationCode: n.code, flag: n.flag };
}

export function buildUserTeam(data: SquadData, run: RunState): Team {
  const players = run.starters.map((i) => pickPlayer(data, run.picks[i]));
  return {
    name: run.teamName, code: USER, flag: "⭐", kit: ["#f4efe1", "#e8542f"], pat: "sash",
    players, rating: userTeamRating(data, run.picks, run.starters), isUser: true
  } as unknown as Team;
}

export function teamRating(data: SquadData, run: RunState, id: string): number {
  if (id === USER) return userTeamRating(data, run.picks, run.starters);
  return data.nations.find((n) => n.name === id)!.rating;
}

/** Create a run: seed the user by rating into the right pot, displace the weakest of that pot, draw 12 groups. */
export function newRun(data: SquadData, teamName: string, picks: DraftPick[], starters: number[], formation: string, kicksPerHalf: number, seed: number): RunState {
  const run: RunState = {
    v: 1, seed, teamName, picks, starters, formation, kicksPerHalf,
    groups: [], groupResults: {}, stage: 0, groupMd: 0, bracket: [], alive: true
  };
  const rng = new Rng(seed ^ 0xbeef);
  const myRating = userTeamRating(data, picks, starters);
  const sorted = data.nations.slice().sort((a, b) => b.rating - a.rating);
  let myPot = 4;
  for (let p = 1; p <= 4; p++) {
    const potTeams = sorted.filter((n) => n.pot === p);
    if (myRating >= potTeams[potTeams.length - 1].rating || p === 4) { myPot = p; break; }
  }
  // displace the weakest nation of my pot
  const potTeams = sorted.filter((n) => n.pot === myPot);
  const displaced = potTeams[potTeams.length - 1].name;
  const pots: string[][] = [1, 2, 3, 4].map((p) =>
    rng.shuffle(sorted.filter((n) => n.pot === p && n.name !== displaced).map((n) => n.name))
  );
  pots[myPot - 1].push(USER);
  const shuffled = pots.map((pot) => rng.shuffle(pot));
  for (let g = 0; g < 12; g++) run.groups.push([shuffled[0][g], shuffled[1][g], shuffled[2][g], shuffled[3][g]]);
  return run;
}

export function userGroupIdx(run: RunState): number {
  return run.groups.findIndex((g) => g.includes(USER));
}

export function groupLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

/** fixture ids for a group matchday */
export function mdFixtures(group: string[], md: number): [string, string][] {
  return MD_PAIRS[md].map(([i, j]) => [group[i], group[j]]);
}

export function userNextOpponent(run: RunState): string | null {
  if (run.stage === 0) {
    if (run.groupMd > 2) return null;
    const g = run.groups[userGroupIdx(run)];
    const fx = mdFixtures(g, run.groupMd).find((f) => f.includes(USER))!;
    return fx[0] === USER ? fx[1] : fx[0];
  }
  const round = run.bracket[run.stage - 1];
  if (!round) return null;
  const tie = round.find((t) => t.a === USER || t.b === USER);
  if (!tie || tie.winner) return null;
  return tie.a === USER ? tie.b : tie.a;
}

/** Difficulty knob: opponent quality + how deep we are. */
export function aiSkill(data: SquadData, run: RunState, oppId: string): number {
  const r = teamRating(data, run, oppId);
  const s = 0.22 + ((r - 70) / 22) * 0.55 + run.stage * 0.05;
  return Math.max(0.2, Math.min(0.97, s));
}

// ------------------------------------------------------------- background sim
function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 9);
  return k - 1;
}

export function simScore(data: SquadData, run: RunState, a: string, b: string, salt: string): [number, number] {
  const rng = new Rng(run.seed ^ hashStr(salt + a + b));
  const ra = teamRating(data, run, a), rb = teamRating(data, run, b);
  const diff = ra - rb;
  const la = Math.min(4.4, Math.max(0.18, 1.28 * Math.exp(diff * 0.052)));
  const lb = Math.min(4.4, Math.max(0.18, 1.28 * Math.exp(-diff * 0.052)));
  return [poisson(rng, la), poisson(rng, lb)];
}

/** record the user's played match, then sim the rest of the matchday */
export function recordUserGroupMatch(data: SquadData, run: RunState, userGoals: number, oppGoals: number) {
  const g = run.groups[userGroupIdx(run)];
  const fx = mdFixtures(g, run.groupMd).find((f) => f.includes(USER))!;
  const key = `${fx[0]}@${fx[1]}`;
  run.groupResults[key] = fx[0] === USER ? [userGoals, oppGoals] : [oppGoals, userGoals];
  simGroupMatchday(data, run, run.groupMd);
  run.groupMd++;
}

export function simGroupMatchday(data: SquadData, run: RunState, md: number) {
  for (let gi = 0; gi < 12; gi++) {
    for (const [a, b] of mdFixtures(run.groups[gi], md)) {
      const key = `${a}@${b}`;
      if (run.groupResults[key]) continue;
      if (a === USER || b === USER) continue;
      run.groupResults[key] = simScore(data, run, a, b, `g${gi}m${md}`);
    }
  }
}

export interface Standing { id: string; pts: number; gf: number; ga: number; gd: number; played: number }

export function groupTable(run: RunState, gi: number): Standing[] {
  const g = run.groups[gi];
  const st: Record<string, Standing> = {};
  for (const id of g) st[id] = { id, pts: 0, gf: 0, ga: 0, gd: 0, played: 0 };
  for (let md = 0; md < 3; md++)
    for (const [a, b] of mdFixtures(g, md)) {
      const r = run.groupResults[`${a}@${b}`];
      if (!r) continue;
      st[a].gf += r[0]; st[a].ga += r[1]; st[b].gf += r[1]; st[b].ga += r[0];
      st[a].played++; st[b].played++;
      if (r[0] > r[1]) st[a].pts += 3;
      else if (r[0] < r[1]) st[b].pts += 3;
      else { st[a].pts++; st[b].pts++; }
    }
  for (const s of Object.values(st)) s.gd = s.gf - s.ga;
  return Object.values(st).sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || hashStr(x.id) - hashStr(y.id));
}

/** after all 3 matchdays: build R32 from winners, runners-up and 8 best thirds */
export function buildR32(data: SquadData, run: RunState) {
  const winners: Standing[] = [], runners: Standing[] = [], thirds: Standing[] = [];
  for (let gi = 0; gi < 12; gi++) {
    const t = groupTable(run, gi);
    winners.push(t[0]); runners.push(t[1]); thirds.push(t[2]);
  }
  const rank = (arr: Standing[]) => arr.slice().sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || teamRating(data, run, y.id) - teamRating(data, run, x.id));
  const seeds = [...rank(winners), ...rank(runners), ...rank(thirds).slice(0, 8)];
  const ties: TieResult[] = [];
  for (let i = 0; i < 16; i++) ties.push({ a: seeds[i].id, b: seeds[31 - i].id });
  run.bracket = [ties];
  run.stage = 1;
  run.alive = seeds.some((s) => s.id === USER);
  if (!run.alive) { run.stage = 6; run.placed = "Out in the group stage"; }
}

/** sim all non-user ties of the current knockout round; called after user's tie resolves */
export function completeKnockoutRound(data: SquadData, run: RunState) {
  const round = run.bracket[run.stage - 1];
  for (const tie of round) {
    if (tie.winner) continue;
    const [sa, sb] = simScore(data, run, tie.a, tie.b, `k${run.stage}`);
    tie.sa = sa; tie.sb = sb;
    if (sa === sb) {
      const rng = new Rng(run.seed ^ hashStr(`pens${run.stage}${tie.a}`));
      const ga = gkRating(data, run, tie.a), gb = gkRating(data, run, tie.b);
      const pa = rng.next() < ga / (ga + gb);
      tie.pa = pa ? 4 : 3; tie.pb = pa ? 3 : 4;
      tie.winner = pa ? tie.a : tie.b;
    } else {
      tie.winner = sa > sb ? tie.a : tie.b;
    }
  }
  // build next round
  const winners = round.map((t) => t.winner!);
  if (winners.length === 1) {
    run.stage = 6;
    run.champion = winners[0];
    run.placed = winners[0] === USER ? "WORLD CHAMPIONS" : run.placed ?? `Champions: ${winners[0]}`;
    return;
  }
  const next: TieResult[] = [];
  for (let i = 0; i < winners.length / 2; i++) next.push({ a: winners[i], b: winners[winners.length - 1 - i] });
  run.bracket.push(next);
  run.stage++;
  if (!winners.includes(USER) && run.alive) {
    run.alive = false;
    run.placed = `Out at the ${STAGES[run.stage - 1] ?? "knockouts"}`;
  }
}

export function recordUserKnockout(run: RunState, sa: number, sb: number, pens?: [number, number]) {
  const tie = run.bracket[run.stage - 1].find((t) => t.a === USER || t.b === USER)!;
  const userFirst = tie.a === USER;
  tie.sa = userFirst ? sa : sb;
  tie.sb = userFirst ? sb : sa;
  if (pens) { tie.pa = userFirst ? pens[0] : pens[1]; tie.pb = userFirst ? pens[1] : pens[0]; }
  const userWon = pens ? pens[0] > pens[1] : sa > sb;
  tie.winner = userWon ? USER : (userFirst ? tie.b : tie.a);
  if (!userWon) { run.alive = false; run.placed = `Out at the ${STAGES[run.stage]}`; }
}

function gkRating(data: SquadData, run: RunState, id: string): number {
  if (id === USER) {
    const gk = pickPlayer(data, run.picks[run.starters[0]]);
    return gk.gk;
  }
  const n = data.nations.find((x) => x.name === id)!;
  return Math.max(...n.players.filter((p) => p.pos === "GK").map((p) => p.gk));
}

export function buildOpponent(data: SquadData, id: string): Team {
  const n = data.nations.find((x) => x.name === id)!;
  return buildNationTeam(n);
}

export function opponentFormation(team: Team): string {
  return nationFormation(team);
}
