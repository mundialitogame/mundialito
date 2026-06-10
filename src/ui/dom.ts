/** Tiny DOM helpers — no framework, just honest elements. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") (el as any)[k.toLowerCase()] = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const root = () => document.getElementById("app")!;

export function showScreen(...nodes: (Node | null | undefined)[]) {
  const r = root();
  clear(r);
  const s = h("div", { class: "screen fade-in" });
  for (const n of nodes) if (n) s.append(n);
  r.append(s);
  r.scrollTop = 0;
  return s;
}

export function mount(node: Node) {
  const r = root();
  clear(r);
  r.append(node);
}

export function statDots(v: number): string {
  // 1..5 pips with halves, rendered as ●◐○
  const pips = Math.max(0.5, Math.min(5, Math.round(((v - 45) / 11) * 2) / 2));
  let s = "";
  for (let i = 1; i <= 5; i++) {
    if (pips >= i) s += "●";
    else if (pips >= i - 0.5) s += "◐";
    else s += "○";
  }
  return s;
}
