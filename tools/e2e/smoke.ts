// Load the built site in headless Chrome, tap Listen, and check that the
// engine plays: bars arrive, captions appear, nothing throws.
//
//   node tools/e2e/smoke.ts [url] [--shots dir] [--seconds 25]
//
// Without a url it serves dist/ itself at /wasatch/.
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const shots = flag("--shots");
const seconds = Number(flag("--seconds") ?? 25);
const query = flag("--query");
let url = args.find((a) => /^https?:/.test(a));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function serve(dir: string): Promise<Server> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    if (!path.startsWith("/wasatch/")) {
      res.writeHead(404).end();
      return;
    }
    let file = normalize(join(dir, path.slice("/wasatch/".length)));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const chrome =
  process.env.CHROME_PATH ??
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
if (!chrome) throw new Error("no Chrome found; set CHROME_PATH");

let server: Server | null = null;
if (!url) {
  server = await serve(join(root, "dist"));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/wasatch/`;
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    // A fake microphone for Tune to the room, granted without a prompt.
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const failures: string[] = [];
try {
  for (const view of [
    { name: "phone", width: 390, height: 844, mobile: true },
    { name: "desktop", width: 1440, height: 900, mobile: false },
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: 2, isMobile: view.mobile, hasTouch: view.mobile });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e instanceof Error ? e.message : String(e)}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
      else if (m.type() === "warn") console.log(`  warn: ${m.text()}`);
    });
    const t0 = Date.now();
    await page.goto(query ? `${url}?${query}` : url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[data-action="listen"]:not([disabled])', { timeout: 60_000 });
    const ready = (Date.now() - t0) / 1000;
    const status = await page.$eval('[data-slot="status1"]', (e) => e.textContent ?? "");
    const status2 = await page.$eval('[data-slot="status2"]', (e) => e.textContent ?? "");
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `${view.name}-boot.png`) });
    }
    await page.click('button[data-action="listen"]');
    await page.waitForSelector(".play", { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const state = await page.evaluate(() => ({
      key: document.querySelector('[data-slot="key"]')?.textContent ?? "",
      section: document.querySelector('[data-slot="section"]')?.textContent ?? "",
      captions: [...document.querySelectorAll(".play__captions .sign__line:first-child")].map((e) => e.textContent ?? ""),
      trains: document.querySelectorAll(".map-vehicles rect").length,
      context: (window as unknown as { __wasatch?: { state: string } }).__wasatch?.state ?? "",
    }));
    if (shots) await page.screenshot({ path: join(shots, `${view.name}-play.png`) });
    console.log(`${view.name}: ready in ${ready.toFixed(1)} s · "${status}" · "${status2}"`);
    console.log(`  key "${state.key}" · section "${state.section}" · ${state.trains} trains on the map`);
    for (const c of state.captions) console.log(`  caption: ${c}`);
    if (!state.key) failures.push(`${view.name}: no bar arrived`);
    if (state.captions.length === 0) failures.push(`${view.name}: no captions`);
    // Feeds can be down; anything else is a bug.
    const real = errors.filter((e) => !/Failed to load resource|net::|CORS|status of 4|status of 5/.test(e));
    // With a conductor: its windows arrive, and departures are heard live.
    const c = await page.evaluate(() => (window as unknown as { __wasatch: { conductor: { stats: { windows: number; observed: number; scheduled: number } } | null } }).__wasatch.conductor?.stats ?? null);
    if (c) {
      const live = await page.$$eval(".play__captions .sign--live .sign__line:first-child", (e) => e.map((x) => x.textContent ?? ""));
      console.log(`  conductor: ${c.windows} windows, ${c.observed} departures seen live, ${c.scheduled} scheduled; live captions: ${live.join(" | ") || "none yet"}`);
      if (c.windows < 2) failures.push(`${view.name}: the conductor's windows didn't arrive`);
    }
    if (query && /(^|&)debug\b/.test(query)) {
      const panel = await page.$$eval(".debug__row", (rows) => rows.map((r) => r.textContent ?? ""));
      for (const row of panel) console.log(`  debug: ${row}`);
      if (!panel.some((r) => /% of a core/.test(r) && !/^engine 0\.0%/.test(r))) failures.push(`${view.name}: ?debug didn't measure the engine`);
    }
    if (view.name === "phone" && !query) await vantages(page, failures, shots);
    if (view.name === "desktop" && !query) await interactions(page, failures);
    for (const e of real) failures.push(`${view.name}: ${e}`);
    for (const e of errors) console.log(`  ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.close();
}
/** Tap each place to listen from: the engine answers with what's near and
 * far, a caption says so, and the map marks the spot. Back to the map last. */
async function vantages(page: import("puppeteer-core").Page, failures: string[], shots: string | undefined): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const [code, name] of [[1, "downtown"], [2, "canyons"], [3, "lake"], [0, "map"]] as const) {
    await page.click(`[data-vantage="${code}"]`);
    await sleep(1500);
    const seen = await page.evaluate(() => ({
      caption: document.querySelector(".play__captions .sign--here .sign__line")?.textContent ?? "",
      marker: document.querySelectorAll(".map-here .here__dot").length,
      checked: document.querySelector('[data-vantage][aria-checked="true"]')?.getAttribute("data-vantage"),
      // Nothing drawn outside the map's frame.
      stray: [...document.querySelectorAll(".map-vehicles > *")].filter((e) => {
        const r = e.getBoundingClientRect();
        const m = document.querySelector(".play__map")!.getBoundingClientRect();
        return r.left < m.left - 1 || r.right > m.right + 1 || r.top < m.top - 1 || r.bottom > m.bottom + 1;
      }).length,
    }));
    console.log(`  from ${name}: "${seen.caption}" · marker ${seen.marker ? "on the map" : "none"}`);
    if (seen.checked !== String(code)) failures.push(`vantage ${name}: the button didn't stay checked`);
    if (!seen.caption) failures.push(`vantage ${name}: no caption said what's near and far`);
    if (code > 0 && seen.marker !== 1) failures.push(`vantage ${name}: no YOU ARE HERE on the map`);
    if (code === 0 && seen.marker !== 0) failures.push("vantage map: a marker is left on the map");
    if (seen.stray) failures.push(`vantage ${name}: ${seen.stray} vehicles drawn outside the map`);
    if (shots && code > 0) await page.screenshot({ path: join(shots, `phone-${name}.png`) });
  }
  const kept = await page.evaluate(() => localStorage.getItem("wasatch:vantage"));
  if (kept !== "0") failures.push(`vantage: the choice wasn't kept (${kept})`);
}

/** A zig-zag run down Snowbird, as GPX. */
function gpx(): string {
  const t0 = Date.parse("2026-12-20T17:00:00Z");
  const rows: string[] = [];
  let lat = 40.565;
  let lon = -111.657;
  for (let i = 0; i <= 240; i++) {
    lat -= 0.00004;
    lon += (Math.floor(i / 20) % 2 === 0 ? 1 : -1) * 0.00005;
    rows.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${(3000 - i * 2).toFixed(1)}</ele><time>${new Date(t0 + i * 2000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1" creator="smoke"><trk><name>Smoke test run</name><trkseg>${rows.join("")}</trkseg></trk></gpx>`;
}

/** Drive every menu feature once and listen for what the engine reports. */
async function interactions(page: import("puppeteer-core").Page, failures: string[]): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __events: string[]; __wasatch: { host: { onEvent(cb: (e: { t: string; day?: number }) => void): void } } };
    w.__events = [];
    w.__wasatch.host.onEvent((e) => w.__events.push(e.t === "bar" ? `bar:${e.day ?? 0}` : e.t));
  });
  const events = () => page.evaluate(() => (window as unknown as { __events: string[] }).__events.splice(0));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // The sheet slides up for 280 ms; click once it has landed.
  const menu = async (panel: string) => {
    await page.click('[data-action="menu"]');
    await page.waitForSelector(`[data-panel="${panel}"]`, { visible: true });
    await sleep(450);
    await page.click(`[data-panel="${panel}"]`);
    await sleep(450);
  };

  // A Day in Twelve Minutes.
  await menu("rewind");
  await page.waitForSelector("[data-twelve]", { visible: true });
  await page.click("[data-twelve]");
  await sleep(9000);
  let ev = await events();
  const dayBars = ev.filter((e) => e.startsWith("bar:") && e !== "bar:0").length;
  const clock = await page.$eval('[data-slot="clock"]', (e) => e.textContent ?? "");
  console.log(`  day in twelve: ${dayBars} day bars, clock "${clock}"`);
  if (dayBars < 2) failures.push("A Day in Twelve Minutes: no day bars");
  if (!clock.startsWith("⏩")) failures.push("A Day in Twelve Minutes: the clock isn't racing");
  await page.click('[data-action="live"]');
  await sleep(4000);
  ev = await events();
  if (!ev.includes("bar:0")) failures.push("Back to live: no live bars");

  // Play along on the pad.
  await menu("play");
  const pad = await page.waitForSelector(".skipad", { visible: true });
  const box = await pad!.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    for (let k = 0; k <= 10; k++) {
      await page.mouse.move(box.x + box.width * (0.2 + k * 0.06), box.y + box.height / 2);
      await sleep(120);
    }
    await page.mouse.up();
  }
  await sleep(1200);
  ev = await events();
  const plays = ev.filter((e) => e === "play").length;
  console.log(`  play along: ${plays} notes`);
  if (plays < 3) failures.push(`Play along: only ${plays} notes`);
  await page.click(".sheet__close");

  // Add your run.
  const dir = mkdtempSync(join(tmpdir(), "wasatch-smoke-"));
  const file = join(dir, "run.gpx");
  writeFileSync(file, gpx());
  await sleep(400);
  await menu("run");
  const input = await page.waitForSelector('input[type="file"]');
  await (input as import("puppeteer-core").ElementHandle<HTMLInputElement>).uploadFile(file);
  await sleep(9000);
  ev = await events();
  const solo = ev.filter((e) => e === "solo").length;
  const result = await page.$eval(".run__result", (e) => e.textContent ?? "");
  console.log(`  run: "${result}" · ${solo} solo notes heard`);
  if (solo < 3) failures.push(`Add your run: only ${solo} solo notes`);
  await page.click(".sheet__close");

  // Show mappings.
  await sleep(400);
  await menu("mappings");
  await page.waitForSelector("table.mappings", { visible: true });
  await sleep(1500);
  const rows = await page.$$eval("table.mappings tbody tr", (r) => r.length);
  const ground = await page.$$eval("table.mappings tbody tr", (r) => r.find((x) => /ground/i.test(x.textContent ?? ""))?.querySelector(".num")?.textContent ?? "");
  console.log(`  mappings: ${rows} streams · the ground: ${ground}`);
  if (rows < 10) failures.push(`Show mappings: only ${rows} rows`);
  if (shots) await page.screenshot({ path: join(shots, "desktop-mappings.png") });
  await page.click(".sheet__close");

  // Tune to the room, against Chrome's fake microphone (a beep that can't
  // hear this phone): it must run the whole procedure and say so plainly.
  await sleep(400);
  await menu("tune");
  await page.click("[data-tune]");
  await page.waitForFunction(() => !(document.querySelector("[data-tune]") as HTMLButtonElement | null)?.disabled, { timeout: 20_000 });
  const tuned = await page.$eval("[data-tuned]", (e) => e.textContent ?? "");
  console.log(`  tune to the room: "${tuned}"`);
  // The fake microphone can't hear this phone or another, so the honest
  // answer is a refusal; a shift would be a false reading.
  if (!/couldn't hear its own tick|couldn't make out another phone/.test(tuned)) failures.push(`Tune to the room: "${tuned}"`);
  await page.click(".sheet__close");
}

if (failures.length) {
  console.error(`FAIL\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("ok");
