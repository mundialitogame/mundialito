import { h, statDots } from "./dom.ts";
import type { PlayerData } from "../data/types.ts";

/** Panini-style text sticker for a player. */
export function playerSticker(
  p: PlayerData,
  opts: { flag?: string; nation?: string; onclick?: () => void; picked?: boolean; disabled?: boolean } = {}
): HTMLElement {
  const star = p.ovr >= 87;
  const rows: [string, number][] = p.pos === "GK"
    ? [["GK", p.gk], ["PAS", p.pas], ["PAC", p.pac], ["CTL", p.ctl]]
    : [["SHO", p.sho], ["PAS", p.pas], ["PAC", p.pac], ["DEF", p.def]];
  const el = h("div", {
    class: `sticker pos-${p.pos}${star ? " star" : ""}${opts.picked ? " picked" : ""}${opts.disabled ? " disabled" : ""}`,
    onclick: opts.onclick
  },
    h("div", { class: "pos-tag" }, p.pos),
    h("div", { class: "p-name" }, `${opts.flag ? opts.flag + " " : ""}${p.name}`),
    h("div", { class: "p-club" }, `${p.club}${p.age ? " · " + p.age : ""}${p.caps ? " · " + p.caps + " caps" : ""}`),
    h("div", { class: "pips" },
      ...rows.map(([lbl, v]) =>
        h("div", { class: "pip-row" }, h("span", { class: "lbl" }, lbl), h("span", { class: "dots" }, statDots(v)))
      )
    ),
    h("div", { class: "p-ovr" }, String(p.ovr))
  );
  return el;
}
