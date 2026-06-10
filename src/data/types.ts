export type Pos = "GK" | "DF" | "MF" | "FW";

export interface PlayerData {
  name: string;
  pos: Pos;
  club: string;
  age: number;
  caps: number;
  num: number;
  ovr: number;
  sho: number;
  pas: number;
  def: number;
  ctl: number;
  pac: number;
  gk: number;
  d: 0 | 1; // draftable
}

export interface NationData {
  name: string;
  code: string;
  flag: string;
  kit: [string, string];
  pat: "solid" | "stripes" | "hoop" | "check";
  realGroup: string;
  rating: number;
  pot: 1 | 2 | 3 | 4;
  players: PlayerData[];
}

export interface SquadData {
  generated: string;
  nations: NationData[];
}

/** A player fielded in a match (drafted teams mix nations). */
export interface MatchPlayer extends PlayerData {
  nationCode: string;
  flag: string;
}

export interface Team {
  name: string;
  code: string; // 3-letter or "YOU"
  flag: string;
  kit: [string, string];
  pat: string;
  /** index 0 is always the GK, then 4 outfield */
  players: MatchPlayer[];
  rating: number;
  isUser: boolean;
}
