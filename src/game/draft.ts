import { Rng } from "../engine/rng.ts";
import type { SquadData, NationData, PlayerData } from "../data/types.ts";

/**
 * The Draw Ceremony: 5 rounds, one per starting spot. Each round a nation is
 * drawn from a fixed pot sequence; pick one player (one player per nation,
 * ever) or burn a skip to redraw from the same pot. A GK must be picked by
 * the final round.
 */
export const POT_ORDER = [1, 2, 1, 3, 4];
export const SKIPS = 3;
export const PICKS = POT_ORDER.length; // the starting five — no bench

export interface DraftPick {
  nation: string;
  player: string;
}

export interface DraftState {
  seed: number;
  round: number;
  nation: string | null; // currently drawn nation
  picks: DraftPick[];
  skipsLeft: number;
  used: string[]; // nations no longer in the bowl
  done: boolean;
}

export class Draft {
  state: DraftState;
  data: SquadData;
  private rng: Rng;
  constructor(data: SquadData, seed: number) {
    this.data = data;
    this.rng = new Rng(seed);
    this.state = { seed, round: 0, nation: null, picks: [], skipsLeft: SKIPS, used: [], done: false };
    this.drawNation();
  }

  nation(): NationData | null {
    return this.state.nation ? this.data.nations.find((n) => n.name === this.state.nation) ?? null : null;
  }

  pot(): number {
    return POT_ORDER[this.state.round];
  }

  private drawNation() {
    const pot = this.pot();
    let pool = this.data.nations.filter((n) => n.pot === pot && !this.state.used.includes(n.name));
    if (!pool.length) pool = this.data.nations.filter((n) => !this.state.used.includes(n.name));
    const n = pool[Math.floor(this.rng.next() * pool.length)];
    this.state.nation = n.name;
    this.state.used.push(n.name);
  }

  hasGk(): boolean {
    return this.state.picks.some((p) => this.playerOf(p)?.pos === "GK");
  }

  /** must the current pick be a GK? (last round, none yet) */
  mustPickGk(): boolean {
    return !this.hasGk() && this.state.round === PICKS - 1;
  }

  pickable(): PlayerData[] {
    const n = this.nation();
    if (!n) return [];
    let list = n.players.filter((p) => p.d === 1);
    if (this.mustPickGk()) list = list.filter((p) => p.pos === "GK");
    return list;
  }

  canSkip(): boolean {
    return this.state.skipsLeft > 0 && !this.state.done && !this.mustPickGk();
  }

  skip(): boolean {
    if (!this.canSkip()) return false;
    this.state.skipsLeft--;
    this.drawNation();
    return true;
  }

  pick(playerName: string): boolean {
    const n = this.nation();
    if (!n || this.state.done) return false;
    if (!this.pickable().some((p) => p.name === playerName)) return false;
    this.state.picks.push({ nation: n.name, player: playerName });
    this.state.round++;
    if (this.state.round >= PICKS) {
      this.state.done = true;
      this.state.nation = null;
    } else {
      this.drawNation();
    }
    return true;
  }

  playerOf(pick: DraftPick): PlayerData | undefined {
    return this.data.nations.find((n) => n.name === pick.nation)?.players.find((p) => p.name === pick.player);
  }
}

/** Default starting five from 7 picks: best GK + best 4 outfield. */
export function defaultStarters(data: SquadData, picks: DraftPick[]): number[] {
  const info = picks.map((pk, i) => {
    const n = data.nations.find((x) => x.name === pk.nation)!;
    const p = n.players.find((x) => x.name === pk.player)!;
    return { i, p };
  });
  const gks = info.filter((x) => x.p.pos === "GK").sort((a, b) => b.p.gk - a.p.gk);
  const out = info.filter((x) => !gks.length || x.i !== gks[0].i)
    .filter((x) => x.p.pos !== "GK")
    .sort((a, b) => b.p.ovr - a.p.ovr);
  const rest = info.filter((x) => x.p.pos === "GK" && (!gks.length || x.i !== gks[0].i));
  const four = [...out, ...rest].slice(0, 4).map((x) => x.i);
  return [gks[0]?.i ?? 0, ...four];
}
