import { h, showScreen } from "./dom.ts";
import { playerSticker } from "./cards.ts";
import { lineupEditor } from "./lineup.ts";
import { Draft, PICKS, defaultStarters } from "../game/draft.ts";
import type { SquadData } from "../data/types.ts";
import * as sfx from "../audio/sfx.ts";

const TEAM_NAMES = [
  "GOLDEN GENERATION", "THE GAFFER'S XI", "PANINI ALL-STARS", "MUNDIALITO XI",
  "TOTAL FOOTBALL CLUB", "THE MAGIC SPONGES", "CLASS OF '26", "GALÁCTICOS POCKET",
  "ROUTE ONE ROVERS", "THE FALSE NINES", "JOGA BONITO SC", "CATENACCIO KIDS"
];

export interface DraftDone {
  picks: { nation: string; player: string }[];
  starters: number[];
  formation: string;
  teamName: string;
}

export function draftScreen(data: SquadData, onDone: (d: DraftDone) => void) {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const draft = new Draft(data, seed);

  const intro = showScreen(
    h("div", { class: "kicker center", style: "margin-top:6vh" }, "FIFA WORLD CUP 2026 — POCKET EDITION"),
    h("h1", { class: "center" }, "THE DRAW", h("br"), "CEREMONY"),
    h("div", { class: "stripe-rule" }),
    h("p", { style: "margin:8px 2px 4px;font-size:16px" },
      `Five nations will be drawn from the pots. Pick one player from each — `,
      h("b", {}, "one per country, ever"), ` — and that's your starting five. No bench, no hiding.`),
    h("p", { style: "margin:8px 2px;font-size:16px" },
      `You hold `, h("b", {}, "3 skips"), `. Skipping burns the nation. And every squad needs a `,
      h("b", {}, "goalkeeper"), ` — leave it late and the draw will force your hand.`),
    h("button", { class: "btn primary", style: "margin-top:18px", onclick: () => { sfx.unlockAudio(); round(); } }, "BEGIN THE DRAW"),
  );
  void intro;

  function round() {
    const nation = draft.nation()!;
    const potNo = draft.pot();
    const bowl = h("div", { class: "bowl spinning" }, h("div", { class: "ball" }));
    const slipWrap = h("div");
    const gridWrap = h("div");
    const actions = h("div");

    const trayEl = tray();
    showScreen(
      h("div", { class: "row spread" },
        h("span", { class: "kicker" }, `PICK ${draft.state.round + 1} OF ${PICKS}`),
        h("span", { class: "kicker" }, `POT ${potNo}`)
      ),
      trayEl,
      h("div", { class: "bowl-wrap" }, bowl, slipWrap),
      gridWrap,
      actions
    );

    sfx.tick();
    setTimeout(() => {
      bowl.classList.remove("spinning");
      sfx.cheer(0.18);
      slipWrap.append(
        h("div", { class: "slip reveal" },
          h("div", { class: "flag" }, nation.flag),
          h("div", { class: "nation" }, nation.name),
          h("div", { class: "sm muted" }, `team rating ${nation.rating.toFixed(0)} · pot ${nation.pot}`)
        )
      );
      const grid = h("div", { class: "draft-grid" });
      const must = draft.mustPickGk();
      for (const p of draft.pickable()) {
        grid.append(playerSticker(p, {
          onclick: () => {
            sfx.tick();
            draft.pick(p.name);
            if (draft.state.done) setup();
            else round();
          }
        }));
      }
      if (must) gridWrap.append(h("div", { class: "tag gold", style: "margin:6px 0" }, "GOALKEEPER REQUIRED — LAST PICK"));
      gridWrap.append(grid);
      actions.append(
        h("button", {
          class: "btn", disabled: !draft.canSkip() || undefined,
          onclick: () => { sfx.tick(); draft.skip(); round(); }
        }, `SKIP NATION (${draft.state.skipsLeft} LEFT)`)
      );
    }, 1000);
  }

  function tray(): HTMLElement {
    const t = h("div", { class: "picks-tray" });
    for (let i = 0; i < PICKS; i++) {
      const pk = draft.state.picks[i];
      if (!pk) { t.append(h("div", { class: "tray-slot" }, `PICK ${i + 1}`)); continue; }
      const n = data.nations.find((x) => x.name === pk.nation)!;
      const p = draft.playerOf(pk)!;
      t.append(h("div", { class: "tray-slot filled" },
        h("div", { class: "f" }, n.flag),
        h("div", { class: "n" }, lastName(p.name)),
        h("div", { class: "muted" }, p.pos)
      ));
    }
    return t;
  }

  function setup() {
    const starters = defaultStarters(data, draft.state.picks);
    let formation = "diamond";
    let teamName = TEAM_NAMES[Math.floor(Math.random() * TEAM_NAMES.length)];

    const nameInput = h("input", {
      value: teamName, maxlength: "22",
      style: "font:inherit;font-weight:800;font-size:22px;text-transform:uppercase;width:100%;padding:8px;border:3px solid var(--ink);border-radius:4px;background:#fff;box-shadow:var(--shadow)"
    }) as HTMLInputElement;

    const entries = draft.state.picks.map((pk) => {
      const n = data.nations.find((x) => x.name === pk.nation)!;
      const p = draft.playerOf(pk)!;
      return { flag: n.flag, name: p.name, pos: p.pos, ovr: p.ovr, club: p.club };
    });
    const editor = lineupEditor({
      entries, starters, formation,
      onChange: (_s, f) => { formation = f; }
    });

    showScreen(
      h("span", { class: "kicker" }, "YOUR SQUAD"),
      h("h2", {}, "NAME THE TEAM"),
      nameInput,
      h("h2", {}, "SET THE TEAM UP"),
      editor,
      h("button", {
        class: "btn primary", style: "margin-top:10px",
        onclick: () => {
          teamName = (nameInput.value.trim() || teamName).toUpperCase();
          onDone({ picks: draft.state.picks, starters, formation, teamName });
        }
      }, "ENTER THE TOURNAMENT")
    );
  }
}

function lastName(n: string): string {
  const parts = n.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : n;
}
