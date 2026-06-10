// End-to-end smoke test: drives the real UI in headless Chromium.
// Prereq: npm run build. Run: node scripts/uitest.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const SHOTS = new URL("../shots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const preview = spawn("npx", ["vite", "preview", "--port", "4317", "--strictPort"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "ignore"
});
await new Promise((r) => setTimeout(r, 1800));

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });

const shot = async (name) => { await sleep(450); await page.screenshot({ path: SHOTS + name + ".png" }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto("http://localhost:4317/");
  await page.getByText("HOW TO PLAY").waitFor({ timeout: 9000 });
  await shot("1-title");

  // start draft
  await page.getByText("START THE DRAW").click();
  await page.getByText("BEGIN THE DRAW").waitFor();
  await shot("2-draw-intro");
  await page.getByText("BEGIN THE DRAW").click();

  // 5 rounds; use one skip on round 2 to exercise it
  for (let round = 0; round < 5; round++) {
    await page.locator(".draft-grid .sticker").first().waitFor({ timeout: 8000 });
    if (round === 1) {
      await shot("3-draw-round");
      await page.getByText(/SKIP NATION/).click();
      await page.locator(".draft-grid .sticker").first().waitFor({ timeout: 8000 });
    }
    await page.locator(".draft-grid .sticker").first().click();
    await sleep(150);
  }

  await page.getByText("ENTER THE TOURNAMENT").waitFor({ timeout: 8000 });
  await shot("4-team-setup");
  await page.getByText("ENTER THE TOURNAMENT").click();

  await page.getByText("PLAY MATCH").waitFor({ timeout: 8000 });
  await shot("5-hub");
  await page.getByText("PLAY MATCH").click();
  await page.locator("canvas.pitch").waitFor({ timeout: 8000 });
  await sleep(1200);

  // play ~10 turns: kick when prompted, press DONE when defending
  let kicks = 0, dones = 0;
  for (let i = 0; i < 60 && kicks < 8; i++) {
    const hint = await page.locator(".hint").textContent().catch(() => "");
    if (hint?.includes("TO KICK") || hint?.includes("YOUR KICK")) {
      const cx = 52, cy = 235; // top-left: clear of own discs, so this is an aim not a run
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let s = 1; s <= 6; s++) await page.mouse.move(cx + s * 4, cy + s * 22);
      if (kicks === 1) await shot("6-aiming");
      await page.mouse.up();
      kicks++;
      await sleep(900);
    } else if (hint?.includes("DEFEND")) {
      // drag one defender slightly, then done
      await page.mouse.move(195, 560);
      await page.mouse.down();
      await page.mouse.move(160, 530, { steps: 4 });
      await page.mouse.up();
      await page.getByText("DONE", { exact: true }).click().catch(() => {});
      dones++;
      await sleep(500);
    } else {
      await sleep(450);
    }
  }
  await shot("7-match");
  console.log(`played: ${kicks} kicks, ${dones} defensive sets`);
  if (kicks === 0) errors.push("never got a kick prompt");

  // resign out
  await page.getByText("II", { exact: true }).click();
  await page.getByText("RESIGN MATCH").click();
  await page.getByText("CONTINUE", { exact: true }).waitFor({ timeout: 8000 });
  await shot("8-result");
  await page.getByText("CONTINUE", { exact: true }).click();
  await page.getByText(/PLAY MATCH|VIEW ALL|NEW DRAFT/).first().waitFor({ timeout: 8000 });
  await shot("9-hub-after");

  const saved = await page.evaluate(() => !!localStorage.getItem("mundialito.run.v1"));
  if (!saved) errors.push("run not persisted to localStorage");
} catch (e) {
  errors.push("flow: " + e.message);
  await shot("error");
}

await browser.close();
preview.kill();
if (errors.length) {
  console.error("UI TEST FAILURES:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("ui smoke test: all good");
