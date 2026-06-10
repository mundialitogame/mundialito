import { TUNE } from "./tuning.ts";

export interface V2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): V2 => ({ x, y });
export const add = (a: V2, b: V2): V2 => v(a.x + b.x, a.y + b.y);
export const sub = (a: V2, b: V2): V2 => v(a.x - b.x, a.y - b.y);
export const mul = (a: V2, k: number): V2 => v(a.x * k, a.y * k);
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const len = (a: V2): number => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: V2): V2 => {
  const l = len(a) || 1;
  return v(a.x / l, a.y / l);
};
export const lerpV = (a: V2, b: V2, t: number): V2 => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const angOf = (a: V2) => Math.atan2(a.y, a.x);
export const fromAng = (rad: number, l = 1): V2 => v(Math.cos(rad) * l, Math.sin(rad) * l);

/** Apply rolling friction for dt: dv/dt = -(c0 + c1 v). Returns new speed. */
export function applyFriction(speed: number, dt: number): number {
  const s = speed - (TUNE.fricC0 + TUNE.fricC1 * speed) * dt;
  return s < TUNE.stopSpeed ? 0 : s;
}

/** Total distance the ball will roll if kicked at v0 (numeric, deterministic). */
export function rollDistance(v0: number): number {
  let s = v0, d = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * TUNE.maxFlight && s > 0; i++) {
    d += s * dt;
    s = applyFriction(s, dt);
  }
  return d;
}

/** Initial speed needed to roll ~distance d (binary search on rollDistance). */
export function speedForDistance(d: number): number {
  let lo = TUNE.stopSpeed, hi = 140;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Swept circle-circle: earliest t in [0, dt] when a point at p moving with
 * velocity w comes within radius R of centre c. Returns -1 if none.
 */
export function sweepCircle(p: V2, w: V2, c: V2, R: number, dt: number): number {
  const d = sub(p, c);
  const a = dot(w, w);
  if (a < 1e-9) return -1;
  const b = 2 * dot(d, w);
  const cc = dot(d, d) - R * R;
  if (cc <= 0) return 0; // already overlapping
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= dt ? t : -1;
}

/** Reflect velocity w off the normal from c to p, with restitution e. */
export function bounce(w: V2, p: V2, c: V2, e: number): V2 {
  const n = norm(sub(p, c));
  const vn = dot(w, n);
  if (vn >= 0) return w; // separating already
  return sub(w, mul(n, (1 + e) * vn));
}

/** Closest approach of segment p -> p+w*dt to point c. Returns {t, d}. */
export function closestOnStep(p: V2, w: V2, c: V2, dt: number): { t: number; d: number } {
  const wd = mul(w, dt);
  const l2 = dot(wd, wd);
  if (l2 < 1e-9) return { t: 0, d: dist(p, c) };
  let t = dot(sub(c, p), wd) / l2;
  t = clamp(t, 0, 1);
  return { t: t * dt, d: dist(add(p, mul(wd, t)), c) };
}
