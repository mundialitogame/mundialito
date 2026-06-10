import { h, showScreen, mount } from "./dom.ts";
import { lineupEditor } from "./lineup.ts";
import type { SquadData } from "../data/types.ts";
import {
  USER, STAGES, userGroupIdx, groupLetter, groupTable, mdFixtures,
  userNextOpponent, buildUserTeam, buildOpponent, opponentFormation, aiSkill,
  recordUserGroupMatch, recordUserKnockout, completeKnockoutRound, buildR32, pickPlayer
} from "../game/tournament.ts";
import type { RunState } from "../game/tournament.ts";
import { saveRun, clearRun, addHonour, loadSettings } from "../game/save.ts";
import { startMatch } from "./matchUI.ts";
import type { MatchResult } from "./matchUI.ts";
import { hashStr } from "../engine/rng.ts";
import * as sfx from "../audio/sfx.ts";
import { makeShareCard } from "./shareCard.ts";

export function hubScreen(data: SquadData, run: RunState, goTitle: () => void) {
  if (run.stage === 6) return endScreen(data, run, goTitle);

  const flagOf = (id: string) => id === USER ? "⭐" : data.nations.find((n) => n.name === id)!.flag;
  const nameOf = (id: string) => id === USER ? run.teamName : id;

  const opp = userNextOpponent(run);
  const stageName = run.stage === 0 ? `GROUP ${groupLetter(userGroupIdx(run))} — MATCHDAY ${Math.min(run.groupMd + 1, 3)}` : STAGES[run.stage].toUpperCase();

  const nextCard = opp
    ? h("div", { class: "panel" },
        h("div", { class: "kicker" }, stageName),
        h("div", { class: "row spread", style: "margin:6px 0" },
          h("div", { style: "font-size:21px;font-weight:800" }, `⭐ ${run.teamName}`),
          h("span", { class: "kicker" }, "VS"),
          h("div", { style: "font-size:21px;font-weight:800;text-align:right" }, `${flagOf(opp)} ${nameOf(opp).toUpperCase()}`)
        ),
        h("div", { class: "sm muted center" },
          opp === USER ? "" : `their rating ${data.nations.find((n) => n.name === opp)!.rating.toFixed(0)} · yours ${buildUserTeam(data, run).rating.toFixed(0)}${run.stage > 0 ? " · knockout — draws go to penalties" : ""}`),
        h("button", { class: "btn hot", onclick: () => play() }, "PLAY MATCH")
      )
    : null;

  function play() {
    sfx.tick();
    const oppId = userNextOpponent(run)!;
    const user = buildUserTeam(data, run);
    const oppTeam = buildOpponent(data, oppId);
    const seed = (run.seed ^ hashStr(`${oppId}|s${run.stage}|m${run.groupMd}`)) >>> 0;
    const el = startMatch({
      user, opp: oppTeam,
      formations: [run.formation, opponentFormation(oppTeam)],
      knockout: run.stage > 0,
      aiSkill: aiSkill(data, run, oppId),
      kicksPerHalf: run.kicksPerHalf,
      seed,
      onDone: (res) => afterMatch(oppId, res)
    });
    mount(el);
  }

  function afterMatch(oppId: string, res: MatchResult) {
    if (run.stage === 0) {
      recordUserGroupMatch(data, run, res.sa, res.sb);
      if (run.groupMd > 2) buildR32(data, run);
    } else {
      recordUserKnockout(run, res.sa, res.sb, res.pens);
      completeKnockoutRound(data, run);
    }
    if (run.stage === 6) {
      addHonour({ date: new Date().toISOString().slice(0, 10), team: run.teamName, placed: run.placed ?? "", champion: run.champion });
    }
    saveRun(run);
    resultScreen(data, run, oppId, res, goTitle);
  }

  // ---------- lineup editor ----------
  const entries = run.picks.map((pk) => {
    const p = pickPlayer(data, pk);
    return { flag: p.flag, name: p.name, pos: p.pos, ovr: p.ovr, club: p.club };
  });
  const lineupEl = lineupEditor({
    entries,
    starters: run.starters,
    formation: run.formation,
    onChange: (_s, f) => {
      run.formation = f;
      saveRun(run);
    }
  });

  // ---------- group/bracket view ----------
  const compEl = h("div");
  if (run.stage === 0) {
    const gi = userGroupIdx(run);
    compEl.append(groupTableEl(data, run, gi, true));
    const fixtures = h("div", { class: "panel flat" });
    for (let md = 0; md < 3; md++) {
      for (const [a, b] of mdFixtures(run.groups[gi], md)) {
        const r = run.groupResults[`${a}@${b}`];
        fixtures.append(h("div", { class: "row spread sm", style: "padding:2px 0;font-weight:600" },
          h("span", {}, `${flagOf(a)} ${nameOf(a)}`),
          h("span", { class: "tag" + (r ? "" : " ") }, r ? `${r[0]}–${r[1]}` : `MD${md + 1}`),
          h("span", { style: "text-align:right" }, `${nameOf(b)} ${flagOf(b)}`)
        ));
      }
    }
    compEl.append(h("h3", { style: "margin-top:10px" }, "FIXTURES"), fixtures);
    // all groups, collapsed
    const all = h("details", {},
      h("summary", { class: "kicker", style: "cursor:pointer;padding:8px 0" }, "VIEW ALL 12 GROUPS"));
    for (let g = 0; g < 12; g++) if (g !== gi) all.append(groupTableEl(data, run, g, false));
    compEl.append(all);
  } else {
    compEl.append(bracketEl(data, run));
  }

  showScreen(
    h("div", { class: "row spread" },
      h("h2", { style: "margin:4px 0" }, `⭐ ${run.teamName}`),
      h("button", { class: "btn small ghost", onclick: goTitle }, "MENU")
    ),
    h("div", { class: "stripe-rule" }),
    nextCard,
    h("h2", {}, run.stage === 0 ? `GROUP ${groupLetter(userGroupIdx(run))}` : "THE ROAD TO THE FINAL"),
    compEl,
    h("h2", {}, "SQUAD & LINEUP"),
    lineupEl
  );
}

function groupTableEl(data: SquadData, run: RunState, gi: number, you: boolean): HTMLElement {
  const flagOf = (id: string) => id === USER ? "⭐" : data.nations.find((n) => n.name === id)!.flag;
  const nameOf = (id: string) => id === USER ? run.teamName : id;
  const t = groupTable(run, gi);
  const tbl = h("table", { class: "tbl" },
    h("tr", {}, h("th", {}, `GROUP ${groupLetter(gi)}`), h("th", { class: "num" }, "P"), h("th", { class: "num" }, "GD"), h("th", { class: "num" }, "PTS"))
  );
  for (const s of t) {
    tbl.append(h("tr", { class: s.id === USER ? "you" : "" },
      h("td", {}, `${flagOf(s.id)} ${nameOf(s.id)}`),
      h("td", { class: "num" }, String(s.played)),
      h("td", { class: "num" }, String(s.gd)),
      h("td", { class: "num" }, h("b", {}, String(s.pts)))
    ));
  }
  return you ? tbl : h("div", {}, tbl);
}

function bracketEl(data: SquadData, run: RunState): HTMLElement {
  const flagOf = (id: string) => id === USER ? "⭐" : data.nations.find((n) => n.name === id)?.flag ?? "";
  const nameOf = (id: string) => id === USER ? run.teamName : id;
  const wrap = h("div", { class: "bracket" });
  const labels = ["R32", "R16", "QF", "SF", "FINAL"];
  run.bracket.forEach((round, ri) => {
    const col = h("div", { class: "round" }, h("div", { class: "kicker" }, labels[ri] ?? ""));
    for (const tie of round) {
      const score = (sa?: number, sb?: number, pa?: number, pb?: number) =>
        sa == null ? "" : `${sa}${pa != null ? ` (${pa})` : ""}`;
      col.append(h("div", { class: "tie" },
        h("div", { class: (tie.winner === tie.a ? "w " : "") + (tie.a === USER ? "you-row" : "") },
          h("span", {}, `${flagOf(tie.a)} ${nameOf(tie.a)}`), h("span", {}, score(tie.sa, tie.sb, tie.pa))),
        h("div", { class: (tie.winner === tie.b ? "w " : "") + (tie.b === USER ? "you-row" : "") },
          h("span", {}, `${flagOf(tie.b)} ${nameOf(tie.b)}`), h("span", {}, tie.sb == null ? "" : `${tie.sb}${tie.pb != null ? ` (${tie.pb})` : ""}`))
      ));
    }
    wrap.append(col);
  });
  return wrap;
}

function resultScreen(data: SquadData, run: RunState, oppId: string, res: MatchResult, goTitle: () => void) {
  const won = res.pens ? res.pens[0] > res.pens[1] : res.sa > res.sb;
  const draw = !res.pens && res.sa === res.sb;
  const oppName = oppId === USER ? "" : oppId;
  sfx.unlockAudio();
  if (won) sfx.cheer(0.7);
  showScreen(
    h("div", { class: "kicker center", style: "margin-top:7vh" }, won ? "VICTORY" : draw ? "ALL SQUARE" : "DEFEAT"),
    h("div", { class: "bigscore" }, `${res.sa}–${res.sb}`),
    res.pens ? h("div", { class: "center", style: "font-weight:800;font-size:19px" }, `PENALTIES ${res.pens[0]}–${res.pens[1]}`) : null,
    h("p", { class: "center muted", style: "margin:6px 0 18px" }, `vs ${oppName}`),
    h("div", { class: "stripe-rule" }),
    h("button", { class: "btn primary", onclick: () => hubScreen(data, run, goTitle) }, "CONTINUE")
  );
}

function endScreen(data: SquadData, run: RunState, goTitle: () => void) {
  const champion = run.champion === USER;
  const sub = champion
    ? "CHAMPIONS OF THE WORLD"
    : run.placed ?? (run.champion ? `Champions: ${run.champion}` : "");
  const card = makeShareCard(data, run);
  const img = h("img", { style: "width:100%;border:3px solid var(--ink);border-radius:6px;box-shadow:var(--shadow)" }) as HTMLImageElement;
  card.toBlob((b) => { if (b) img.src = URL.createObjectURL(b); });

  if (champion) sfx.cheer(1);
  showScreen(
    champion ? h("div", { class: "trophy" }, "🏆") : h("div", { class: "trophy" }, "🧳"),
    h("h1", { class: "center" }, champion ? "WORLD CHAMPIONS!" : "THE RUN ENDS"),
    h("p", { class: "center", style: "font-weight:700;letter-spacing:0.08em" }, sub.toUpperCase()),
    h("div", { class: "stripe-rule" }),
    img,
    h("button", {
      class: "btn gold", onclick: async () => {
        card.toBlob(async (b) => {
          if (!b) return;
          const file = new File([b], "mundialito.png", { type: "image/png" });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            try { await navigator.share({ files: [file], title: "Mundialito ’26" }); } catch { /* cancelled */ }
          } else {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b);
            a.download = "mundialito.png";
            a.click();
          }
        });
      }
    }, "SHARE THE STORY"),
    h("button", { class: "btn primary", onclick: () => { clearRun(); goTitle(); } }, "NEW DRAFT"),
    h("button", { class: "btn ghost", onclick: goTitle }, "BACK TO TITLE")
  );
  void loadSettings;
}
