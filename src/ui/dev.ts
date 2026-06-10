import { TUNE } from "../engine/tuning.ts";
import { h } from "./dom.ts";

/** Live physics tuning panel (?dev=1). Mutates TUNE in place. */
export function mountDevPanel() {
  const keys: [keyof typeof TUNE, number, number, number][] = [
    ["fricC0", 1, 14, 0.1], ["fricC1", 0.2, 3, 0.05],
    ["kickMin", 6, 30, 1], ["kickMax", 30, 100, 1],
    ["coneBase", 0.5, 6, 0.1], ["coneStat", 0.05, 0.6, 0.01], ["conePower", 0.3, 2.5, 0.05],
    ["intR", 0.5, 6, 0.1], ["intRStat", 0.01, 0.12, 0.002], ["intBase", 0.3, 1, 0.02],
    ["intSpeedRef", 40, 110, 2], ["intSpeedPow", 0.8, 2.2, 0.05],
    ["saveBase", 0.5, 5, 0.1], ["saveStat", 0.02, 0.14, 0.002], ["saveSpeedPen", 0.01, 0.08, 0.002],
    ["tackleR", 3, 11, 0.2], ["tackleBase", 0.03, 0.45, 0.01],
    ["lungeLen", 1.5, 7, 0.1], ["lungeWin", 0.1, 0.7, 0.02],
    ["foulThrough", 0.3, 1, 0.05], ["tackleHop", 1, 7, 0.25],
    ["freeKickSpace", 4, 13, 0.5],
    ["airThresh", 0.7, 0.97, 0.01], ["airMax", 15, 60, 1],
    ["airSavePen", 0.4, 1, 0.02], ["airOverBar", 0.2, 0.8, 0.02],
    ["throughSpeed", 0.001, 0.014, 0.0005], ["throughDef", 0, 0.006, 0.0002],
    ["challengeStat", 0.001, 0.014, 0.0005], ["trapMoving", 0, 0.5, 0.02],
    ["pressR", 3, 14, 0.2], ["trapBase", 0.3, 0.9, 0.02], ["heavyKeep", 0.2, 0.7, 0.02],
    ["runSpeed", 4, 16, 0.2], ["runSpeedStat", 0.02, 0.16, 0.005]
  ];
  const body = h("div", { style: "display:none;max-height:46vh;overflow-y:auto;padding:6px" });
  for (const [k, lo, hi, st] of keys) {
    const val = h("span", { style: "min-width:46px;text-align:right;font-variant-numeric:tabular-nums" }, String(TUNE[k]));
    const slider = h("input", { type: "range", min: String(lo), max: String(hi), step: String(st), value: String(TUNE[k]), style: "flex:1" }) as HTMLInputElement;
    slider.oninput = () => {
      (TUNE as any)[k] = parseFloat(slider.value);
      val.textContent = slider.value;
    };
    body.append(h("div", { style: "display:flex;gap:6px;align-items:center;font-size:11px;font-weight:700" },
      h("span", { style: "min-width:86px" }, String(k)), slider, val));
  }
  const toggle = h("button", {
    style: "font:inherit;font-weight:800;padding:4px 8px;border:2px solid #fff;background:#1b1a14;color:#fff;border-radius:4px",
    onclick: () => { body.style.display = body.style.display === "none" ? "block" : "none"; }
  }, "TUNE");
  document.body.append(h("div", {
    style: "position:fixed;left:6px;bottom:6px;z-index:99;background:#1b1a14ee;color:#fff;border-radius:6px;max-width:320px;font-family:monospace"
  }, toggle, body));
}
