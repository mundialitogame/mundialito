import { h, clear, surname } from "./dom.ts";
import { FORMATIONS, SLOT_LABELS } from "../engine/match.ts";
import * as sfx from "../audio/sfx.ts";

export interface LineupEntry {
  flag: string;
  name: string;
  pos: string;
  ovr: number;
  club: string;
}

export interface LineupOpts {
  entries: LineupEntry[]; // all 7 picks; index = entry id
  starters: number[]; // 5 entry ids in slot order, [0] = GK slot
  formation: string;
  onChange: (starters: number[], formation: string) => void;
}

/** Formation laid out on a pitch; drag players between spots and the bench. */
export function lineupEditor(opts: LineupOpts): HTMLElement {
  const root = h("div");
  let selected: number | null = null; // entry id (tap-tap fallback)

  function slotXY(f: string, slot: number): { x: number; y: number } {
    const [x01, y01] = (FORMATIONS[f] ?? FORMATIONS.diamond)[slot];
    return { x: x01 * 100, y: ((y01 - 0.3) / 0.7) * 82 + 6 };
  }

  const lastName = surname;

  function render() {
    clear(root);
    const { entries, starters, formation } = opts;

    // formation switcher
    const formRow = h("div", { class: "row" });
    for (const [label, f] of [["DIAMOND", "diamond"], ["BOX", "box"], ["THE WALL", "wall"]] as const) {
      formRow.append(h("button", {
        class: "btn small" + (formation === f ? " primary" : ""),
        onclick: () => { sfx.tick(); opts.formation = f; opts.onChange(starters, f); render(); }
      }, label));
    }

    const pitch = h("div", { class: "lpitch" });
    // halfway line + centre arc + box arc for flavour
    pitch.append(h("div", { class: "lp-line", style: "top:4%" }), h("div", { class: "lp-arc" }));

    const chipAt = (entryId: number, slot: number | null) => {
      const p = entries[entryId];
      const isGkSlot = slot === 0;
      const chip = h("div", {
        class: "lchip" + (isGkSlot ? " gk" : "") + (selected === entryId ? " sel" : ""),
        "data-entry": String(entryId)
      },
        h("div", { class: "lc-top" }, p.flag),
        h("div", { class: "lc-ovr" }, String(p.ovr)),
        h("div", { class: "lc-name" }, lastName(p.name))
      );
      attachDrag(chip, entryId);
      return chip;
    };

    // slots + starter chips
    starters.forEach((entryId, slot) => {
      const { x, y } = slotXY(formation, slot);
      const wrap = h("div", { class: "lslot", style: `left:${x}%;top:${y}%`, "data-slot": String(slot) },
        chipAt(entryId, slot),
        h("div", { class: "lslot-label" }, (SLOT_LABELS[formation] ?? SLOT_LABELS.diamond)[slot])
      );
      pitch.append(wrap);
    });

    // bench (only shown for legacy 7-pick squads)
    const benchIds = entries.map((_, i) => i).filter((i) => !starters.includes(i));
    const bench = benchIds.length
      ? h("div", { class: "lbench" },
          h("span", { class: "kicker", style: "margin-right:4px" }, "BENCH"),
          ...benchIds.map((i) => h("div", { class: "lslot bench", "data-bench": String(i) }, chipAt(i, null))))
      : null;

    root.append(formRow, pitch);
    if (bench) root.append(bench);
    root.append(h("p", { class: "sm muted", style: "margin-top:4px" }, "Drag players between spots. The keeper spot only takes a GK."));
  }

  function dropTargets(): { el: HTMLElement; slot: number | null; benchId: number | null }[] {
    return [...root.querySelectorAll<HTMLElement>(".lslot")].map((el) => ({
      el,
      slot: el.dataset.slot != null ? parseInt(el.dataset.slot) : null,
      benchId: el.dataset.bench != null ? parseInt(el.dataset.bench) : null
    }));
  }

  function applyDrop(entryId: number, target: { slot: number | null; benchId: number | null }) {
    const { entries, starters } = opts;
    const fromSlot = starters.indexOf(entryId);
    if (target.slot != null) {
      const occupant = starters[target.slot];
      if (occupant === entryId) return;
      // GK slot only takes keepers; and a keeper leaving slot 0 must be replaced by one
      if (target.slot === 0 && entries[entryId].pos !== "GK") return deny();
      if (fromSlot === 0 && target.slot !== 0 && entries[occupant].pos !== "GK") return deny();
      if (fromSlot >= 0) {
        starters[fromSlot] = occupant;
        starters[target.slot] = entryId;
      } else {
        starters[target.slot] = entryId; // occupant drops to bench
      }
    } else if (target.benchId != null) {
      if (fromSlot < 0) return; // bench to bench
      if (fromSlot === 0 && entries[target.benchId].pos !== "GK") return deny();
      starters[fromSlot] = target.benchId;
    } else {
      return;
    }
    sfx.tick();
    opts.onChange(opts.starters, opts.formation);
    render();
  }

  function deny() {
    sfx.thud();
    const note = h("div", { class: "tag gold", style: "margin:4px 0" }, "THE KEEPER SPOT NEEDS A GK");
    root.prepend(note);
    setTimeout(() => note.remove(), 1300);
  }

  function attachDrag(chip: HTMLElement, entryId: number) {
    chip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      let ghost: HTMLElement | null = null;
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 9) {
          moved = true;
          ghost = chip.cloneNode(true) as HTMLElement;
          ghost.classList.add("ghost");
          document.body.append(ghost);
          chip.style.opacity = "0.35";
        }
        if (ghost) {
          ghost.style.left = ev.clientX + "px";
          ghost.style.top = ev.clientY + "px";
        }
      };
      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        ghost?.remove();
        chip.style.opacity = "";
        if (moved) {
          // nearest drop target to release point
          let best: ReturnType<typeof dropTargets>[number] | null = null;
          let bd = 72;
          for (const t of dropTargets()) {
            const r = t.el.getBoundingClientRect();
            const d = Math.hypot(r.left + r.width / 2 - ev.clientX, r.top + r.height / 2 - ev.clientY);
            if (d < bd) { bd = d; best = t; }
          }
          if (best) applyDrop(entryId, best);
          selected = null;
        } else {
          // tap: select, or complete a swap with the previous selection
          if (selected === null) {
            selected = entryId;
            sfx.tick();
            render();
          } else if (selected === entryId) {
            selected = null;
            render();
          } else {
            const targetSlot = opts.starters.indexOf(entryId);
            const sel = selected;
            selected = null;
            applyDrop(sel, targetSlot >= 0 ? { slot: targetSlot, benchId: null } : { slot: null, benchId: entryId });
          }
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  }

  render();
  return root;
}
