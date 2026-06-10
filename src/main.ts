import "./ui/style.css";
import squadsJson from "./data/squads.json";
import type { SquadData } from "./data/types.ts";
import { titleScreen } from "./ui/title.ts";
import { draftScreen } from "./ui/draftUI.ts";
import { hubScreen } from "./ui/hubUI.ts";
import { newRun } from "./game/tournament.ts";
import { loadRun, saveRun, loadSettings } from "./game/save.ts";
import * as sfx from "./audio/sfx.ts";

const data = squadsJson as unknown as SquadData;

const settings = loadSettings();
sfx.setSound(settings.sound);
document.addEventListener("pointerdown", () => sfx.unlockAudio(), { once: true });

function goTitle() {
  titleScreen({
    onContinue: () => {
      const run = loadRun();
      if (run) hubScreen(data, run, goTitle);
      else goTitle();
    },
    onNew: () => {
      draftScreen(data, (d) => {
        const s = loadSettings();
        const seed = (Math.random() * 0xffffffff) >>> 0;
        const run = newRun(data, d.teamName, d.picks, d.starters, d.formation, s.matchLen === "short" ? 24 : 34, seed);
        saveRun(run);
        hubScreen(data, run, goTitle);
      });
    }
  });
}

goTitle();

if (new URLSearchParams(location.search).has("dev")) {
  void import("./ui/dev.ts").then((m) => m.mountDevPanel());
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline play unavailable */ });
  });
}
