import type { RunState } from "./tournament.ts";

const RUN_KEY = "mundialito.run.v1";
const SET_KEY = "mundialito.settings.v1";
const BEST_KEY = "mundialito.honours.v1";

export interface Settings {
  sound: boolean;
  matchLen: "short" | "full"; // 18 or 26 kicks per half
}

export interface Honour { date: string; team: string; placed: string; champion?: string }

const store = typeof localStorage !== "undefined" ? localStorage : null;

export function saveRun(run: RunState) {
  store?.setItem(RUN_KEY, JSON.stringify(run));
}
export function loadRun(): RunState | null {
  try {
    const s = store?.getItem(RUN_KEY);
    if (!s) return null;
    const r = JSON.parse(s);
    return r?.v === 1 ? (r as RunState) : null;
  } catch {
    return null;
  }
}
export function clearRun() {
  store?.removeItem(RUN_KEY);
}

export function loadSettings(): Settings {
  try {
    const s = store?.getItem(SET_KEY);
    if (s) return { sound: true, matchLen: "short", ...JSON.parse(s) };
  } catch { /* fall through */ }
  return { sound: true, matchLen: "short" };
}
export function saveSettings(s: Settings) {
  store?.setItem(SET_KEY, JSON.stringify(s));
}

export function addHonour(h: Honour) {
  const all = loadHonours();
  all.unshift(h);
  store?.setItem(BEST_KEY, JSON.stringify(all.slice(0, 30)));
}
export function loadHonours(): Honour[] {
  try {
    return JSON.parse(store?.getItem(BEST_KEY) ?? "[]");
  } catch {
    return [];
  }
}
