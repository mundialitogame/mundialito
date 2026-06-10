import { h, showScreen } from "./dom.ts";
import { loadRun, clearRun, loadSettings, saveSettings, loadHonours } from "../game/save.ts";
import * as sfx from "../audio/sfx.ts";

const WORDMARK = `
<svg class="wordmark" viewBox="0 0 340 185" xmlns="http://www.w3.org/2000/svg">
  <g font-family="Avenir Next Condensed, Arial Narrow, sans-serif" text-anchor="middle">
    <rect x="20" y="14" width="300" height="10" fill="#e8542f" stroke="#1b1a14" stroke-width="3"/>
    <rect x="20" y="28" width="300" height="10" fill="#d9a521" stroke="#1b1a14" stroke-width="3"/>
    <rect x="20" y="42" width="300" height="10" fill="#0e7c66" stroke="#1b1a14" stroke-width="3"/>
    <text x="166" y="112" font-size="52" font-weight="800" fill="#1b1a14"
      textLength="280" lengthAdjust="spacingAndGlyphs">MUNDIALITO</text>
    <text x="318" y="92" font-size="24" font-weight="800" fill="#e8542f" text-anchor="end"
      transform="rotate(7 318 92)">’26</text>
    <circle cx="170" cy="148" r="14" fill="#f7f4e8" stroke="#1b1a14" stroke-width="3"/>
    <circle cx="170" cy="148" r="3.4" fill="#1b1a14"/>
    <circle cx="163" cy="142" r="2.2" fill="#1b1a14"/>
    <circle cx="177" cy="142" r="2.2" fill="#1b1a14"/>
    <circle cx="170" cy="156" r="2.2" fill="#1b1a14"/>
    <line x1="24" y1="148" x2="148" y2="148" stroke="#1b1a14" stroke-width="3"/>
    <line x1="192" y1="148" x2="316" y2="148" stroke="#1b1a14" stroke-width="3"/>
  </g>
</svg>`;

export function titleScreen(actions: { onContinue: () => void; onNew: () => void }) {
  const run = loadRun();
  const settings = loadSettings();
  const honours = loadHonours();

  const soundBtn = h("button", {
    class: "btn small", onclick: () => {
      settings.sound = !settings.sound;
      saveSettings(settings);
      sfx.setSound(settings.sound);
      sfx.unlockAudio();
      if (settings.sound) sfx.tick();
      soundBtn.textContent = settings.sound ? "SOUND ON" : "SOUND OFF";
    }
  }, settings.sound ? "SOUND ON" : "SOUND OFF");

  const lenBtn = h("button", {
    class: "btn small", onclick: () => {
      settings.matchLen = settings.matchLen === "short" ? "full" : "short";
      saveSettings(settings);
      sfx.tick();
      lenBtn.textContent = settings.matchLen === "short" ? "MATCH: SHORT" : "MATCH: FULL";
    }
  }, settings.matchLen === "short" ? "MATCH: SHORT" : "MATCH: FULL");

  showScreen(
    h("div", { html: WORDMARK }),
    h("div", { class: "tagline" }, "DRAFT · FLICK · LIFT THE TROPHY"),
    run ? h("button", { class: "btn primary", onclick: actions.onContinue }, "CONTINUE TOURNAMENT") : null,
    h("button", {
      class: "btn" + (run ? "" : " primary"), onclick: () => {
        if (run && !confirm("Abandon the current tournament and start a new draft?")) return;
        clearRun();
        actions.onNew();
      }
    }, run ? "NEW DRAFT" : "START THE DRAW"),
    h("button", { class: "btn", onclick: howTo }, "HOW TO PLAY"),
    h("div", { class: "row" }, soundBtn, lenBtn),
    honours.length
      ? h("div", { class: "panel", style: "margin-top:18px" },
          h("div", { class: "kicker" }, "HONOURS BOARD"),
          ...honours.slice(0, 6).map((hn) =>
            h("div", { class: "row spread sm", style: "padding:3px 0" },
              h("span", { style: "font-weight:700" }, `${hn.champion === "YOU" ? "🏆 " : ""}${hn.team}`),
              h("span", { class: "muted" }, hn.placed))))
      : null,
    h("div", { class: "row", style: "margin-top:auto;padding-top:18px" },
      h("button", {
        class: "btn small gold",
        onclick: () => window.open("https://ko-fi.com/mundialito", "_blank", "noopener")
      }, "☕ SUPPORT THE GAME")
    ),
    h("p", { class: "center sm muted", style: "padding-top:10px" },
      "A fan-made flick football game. Not affiliated with FIFA or any player. ",
      h("a", { href: "./terms.html", style: "color:var(--green)" }, "Terms"),
      " · ",
      h("a", { href: "./privacy.html", style: "color:var(--green)" }, "Privacy"))
  );
}

function howTo() {
  const dlg = h("dialog", { class: "modal" },
    h("h3", {}, "HOW TO PLAY"),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "THE DRAW — "), "5 nations are drawn from the pots. Take one player from each — that's your starting five. 3 skips. You must end up with a keeper."),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "KICKING — "), "Drag back anywhere and release — snap the drag faster for extra power. WHITE power is a short pass, GOLD is a firm drive, RED goes AERIAL: the ball flies over everyone and drops at the marked ring. Lofted shots dip in hard to save — or sail over the bar if you're too close or too hot."),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "PLANNED RUNS — "), "Drag any teammate to sketch a run (dotted arrow); runs execute WITH your kick, covering ground at the player's pace. Nobody moves between kicks — space you create stays created. Even a tiny touch gives everyone's runs a moment to play out, so no stalling on the ball."),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "DRIBBLING — "), "Tap MODE to switch the kick for a carry: drag a path and your player runs it with the ball while everyone's planned runs execute. Defenders who get close will challenge — control and pace keep the ball, open grass keeps you safe."),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "DEFENDING — "), "You plan too: press the kicker (arrive close and you'll attempt tackles on his next touch), cut lanes, recover shape. Plans are hidden from the attacker — defence is prediction, not reaction. Faster kicks give everyone less time to move."),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "TACKLES — "), "While defending, tap MOVE/TACKLE to switch. A tackle drag is a short aggressive dash in that direction (longer for better defenders, red arrow). Reach the ball cleanly and you'll usually win it — and hop clear with it. Dash THROUGH the man to get there and it's a foul: free kick with everyone backed off, or a PENALTY if your keeper did it."),
    h("p", { class: "sm", style: "margin:8px 0" }, h("b", {}, "THE TOURNAMENT — "), "12 groups of 4, top two and the best thirds reach the round of 32. Knockout draws go to penalties. Win six matches and the cup is yours."),
    h("button", { class: "btn primary", onclick: () => (dlg as HTMLDialogElement).close() }, "GOT IT")
  ) as HTMLDialogElement;
  document.body.append(dlg);
  dlg.showModal();
  dlg.onclose = () => dlg.remove();
}
