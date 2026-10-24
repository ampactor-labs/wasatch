// Load the built site in headless Chrome, tap Listen, and check that the
// engine plays: bars arrive, captions appear, nothing throws.
//
//   node tools/e2e/smoke.ts [url] [--shots dir] [--seconds 25]
//
// Without a url it serves dist/ itself at /wasatch/.
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox", "--disable-dev-shm-usage"],
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
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded" });
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
    for (const e of real) failures.push(`${view.name}: ${e}`);
    for (const e of errors) console.log(`  ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.close();
}
if (failures.length) {
  console.error(`FAIL\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("ok");
