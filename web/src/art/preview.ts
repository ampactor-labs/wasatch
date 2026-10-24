// Dev-only gallery for the art system: /wasatch/art-preview.html
//   ?view=gallery (default) every piece, for review
//   ?view=boot              the boot screen alone
//   ?view=og                the 1200 × 630 share card
//   ?view=icon&size=512     the app icon at a size, full bleed
import "../styles/index.css";
import {
  bootScene,
  DAYPARTS,
  defaultSkylineData,
  gull,
  harmonyDial,
  icon,
  ICON_NAMES,
  mapBase,
  mapHeightFor,
  mapProjection,
  DEFAULT_MAP_BOUNDS,
  shredder,
  shredderGroup,
  skyGradient,
  skyline,
  skylineGeometry,
  sticker,
  STICKER_KINDS,
  trailIcon,
  trailName,
  VANTAGE_TRAIL,
} from "./index.ts";
import { appIconSvg } from "./appicon.ts";
import type { Daypart } from "./sky.ts";
import { INK, SUNSET } from "./palette.ts";
import { esc, n } from "./util.ts";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "gallery";

const css = document.createElement("style");
css.textContent = `
  body { margin: 0; background: var(--powder); color: var(--ink); font-family: var(--font-body); }
  .pv { padding: 24px 16px 80px; max-width: 1180px; margin: 0 auto; }
  .pv h2 { font: 400 30px/1 var(--font-display); margin: 44px 0 14px; color: var(--sky-deep); -webkit-text-stroke: 1.5px var(--ink); paint-order: stroke fill; }
  .pv h3 { font: 700 13px/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; margin: 18px 0 8px; }
  .row { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; }
  .card { background: var(--white); border: 3px solid var(--ink); border-radius: 14px; padding: 12px; box-shadow: var(--shadow-hard); }
  .cap { font: 700 11px/1.3 var(--font-mono); margin-top: 6px; text-align: center; }
  .phone { width: 390px; height: 844px; border: 3px solid var(--ink); border-radius: 28px; overflow: auto; box-shadow: var(--shadow-hard); background: #000; }
  .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 10px; }
  .icons div { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .sky { height: 120px; border: 3px solid var(--ink); border-radius: 12px; }
  .signs { display: grid; gap: 14px; max-width: 420px; }
`;
document.head.appendChild(css);

function section(title: string, body: string): string {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `<section id="s-${id}"><h2>${esc(title)}</h2>${body}</section>`;
}

function gallery(): string {
  const data = defaultSkylineData();
  const parts: string[] = [];

  parts.push(
    section(
      "Boot",
      `<div class="row"><div class="phone">${bootScene({
        daypart: "rush",
        status1: "Friday 5:42 PM · Evening rush · 377 vehicles moving",
        status2: "Clean air · No new snow · Lake 4,189.8 ft",
        skylineWidth: 390,
        skylineHeight: 196,
      })}</div><div class="phone">${bootScene({
        daypart: "nocturne",
        status1: "Tuesday 3:12 AM · Nocturne · 0 trains",
        status2: "Inversion · PM2.5 38 · Lake 4,189.6 ft",
        haze: 0.7,
        stickers: ["INVERSION", "LAST CHAIR"],
        skylineWidth: 390,
        skylineHeight: 196,
      })}</div><div class="phone">${bootScene({
        daypart: "first-light",
        status1: "Saturday 6:48 AM · First light · 41 vehicles moving",
        status2: "Bluebird · 14 in overnight at Snowbird · Lake 4,189.7 ft",
        stickers: ["POW DAY", "FIRST CHAIR"],
        skylineWidth: 390,
        skylineHeight: 196,
      })}</div></div>`,
    ),
  );

  parts.push(
    section(
      "The conductor",
      `<div class="row">${(["idle", "conduct", "bow"] as const)
        .map((pose) => `<div class="card" style="width:220px">${gull({ pose })}<div class="cap">gull({pose:"${pose}"})</div></div>`)
        .join("")}</div>`,
    ),
  );

  const g = skylineGeometry(data, { width: 900, height: 240 });
  const riders = [0.18, 0.52, 0.86]
    .map((t) => {
      const p = g.at(t);
      return `<g transform="translate(${n(p.x)} ${n(p.y - 1)}) rotate(${n(p.angle)}) scale(.42)">${shredderGroup()}</g>`;
    })
    .join("");
  parts.push(
    section(
      "The shredder",
      `<div class="row"><div class="card" style="width:220px">${shredder()}<div class="cap">shredder(), anchor = board center</div></div>
       <div class="card" style="flex:1;min-width:320px">${skyline(data, { width: 900, height: 240, labels: true, activeSummit: 7 }).replace(
         `<g class="skyline-playhead"></g>`,
         `<g class="skyline-playhead">${riders}</g>`,
       )}<div class="cap">riding the ridge at t = .18, .52, .86 via skylineGeometry().at(t)</div></div></div>`,
    ),
  );

  const skyRows = DAYPARTS.map((d, k) => {
    const haze = k === 3 ? 0.65 : 0;
    return `<div class="card" style="width:100%;padding:0;overflow:hidden;background:${skyGradient(d, { haze })}">${skyline(data, {
      width: 1100,
      height: 230,
      daypart: d,
      haze,
      labels: k === 2,
    })}<div class="cap" style="padding:6px;background:var(--white)">${d}${haze ? ` · haze ${haze}` : ""}</div></div>`;
  }).join("");
  parts.push(section("The skyline, by daypart", `<div class="row">${skyRows}</div>`));

  parts.push(
    section(
      "Stickers",
      `<div class="row">${STICKER_KINDS.map(
        (k) => `<div style="width:${k === "801" || k === "LISTEN LOCAL" || k === "SEND IT" || k === "INVERSION" ? 150 : 190}px">${sticker(k)}<div class="cap">${esc(k)}</div></div>`,
      ).join("")}</div>`,
    ),
  );

  parts.push(
    section(
      "Trail signs",
      `<div class="signs">
        <div class="sign sign--live"><p class="sign__line">Red Line · Ballpark · 1 min late</p><span class="sign__receipt">live 5:42 PM</span></div>
        <div class="sign sign--cached"><p class="sign__line">Lake 4,189.8 ft · 8.2 ft below healthy</p><span class="sign__receipt">cached 4:45 PM</span></div>
        <div class="sign sign--scheduled"><p class="sign__line">FrontRunner arrived at Salt Lake Central</p><span class="sign__receipt">scheduled</span></div>
        <div class="sign sign--small"><p class="sign__line">GREENbike · a bike out at 200 S &amp; 300 E</p></div>
      </div>`,
    ),
  );

  parts.push(
    section(
      "Vantage",
      `<div class="row">${(Object.entries(VANTAGE_TRAIL) as [string, Parameters<typeof trailIcon>[0]][])
        .map(([v, k]) => `<div class="card" style="width:120px;display:flex;flex-direction:column;align-items:center">${trailIcon(k, { size: 56 })}<div class="cap">${esc(v)} · ${esc(trailName(k))}</div></div>`)
        .join("")}<div class="card" style="width:120px;display:flex;flex-direction:column;align-items:center">${trailIcon("double-black", { size: 56 })}<div class="cap">spare · double black</div></div></div>`,
    ),
  );

  parts.push(
    section(
      "Icons",
      `<div class="icons">${ICON_NAMES.map(
        (name) => `<div class="card">${icon(name, { size: 48 })}${icon(name, { size: 24 })}<span class="cap">${name}</span></div>`,
      ).join("")}</div>`,
    ),
  );

  // The map, with a fake line drawn through the projection to show the overlay.
  const w = 390;
  const h = mapHeightFor(DEFAULT_MAP_BOUNDS, w);
  const proj = mapProjection(DEFAULT_MAP_BOUNDS, w, h);
  const fake = [
    [40.765, -111.89],
    [40.73, -111.9],
    [40.66, -111.89],
    [40.6, -111.89],
    [40.53, -111.88],
  ]
    .map(([lat, lon], i) => {
      const [x, y] = proj.project(lat ?? 0, lon ?? 0);
      return `${i ? "L" : "M"}${n(x)} ${n(y)}`;
    })
    .join("");
  const overlay = `<g class="map-routes"><path d="${fake}" stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none"/><path d="${fake}" stroke="#E2231A" stroke-width="4" stroke-linecap="round" fill="none"/></g>`;
  const ev = proj.project(40.73, -111.9);
  const pulse = `<g class="map-events"><circle cx="${n(ev[0])}" cy="${n(ev[1])}" r="7" fill="${SUNSET}" stroke="${INK}" stroke-width="2.5"/></g>`;
  parts.push(
    section(
      "The valley map",
      `<div class="row"><div style="width:${w}px">${mapBase({ width: w, height: h })
        .replace(`<g class="map-routes"></g>`, overlay)
        .replace(`<g class="map-events"></g>`, pulse)}</div>
       <div style="width:300px">${mapBase({ width: 300 })}</div></div>`,
    ),
  );

  parts.push(
    section(
      "Harmony dial",
      `<div class="row">
        <div class="card" style="width:280px">${harmonyDial({ collection: 0, home: 0, push: 0, center: "C MAJOR" })}<div class="cap">C Ionian, no push</div></div>
        <div class="card" style="width:280px">${harmonyDial({ collection: 2, home: 4, push: 1, center: "E DORIAN" })}<div class="cap">D major's notes, home E, push sharpward</div></div>
        <div class="card" style="width:280px">${harmonyDial({
          collection: -4,
          home: -2,
          push: -1,
          center: "B♭ DORIAN",
          labels: ["C", "G", "D", "A", "E", "B", "G♭", "D♭", "A♭", "E♭", "B♭", "F"],
        })}<div class="cap">A♭ major's notes, home B♭, push flatward</div></div>
      </div>`,
    ),
  );

  parts.push(
    section(
      "Sky gradients",
      `<div class="row" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">${DAYPARTS.map(
        (d) => `<div><div class="sky" style="background:${skyGradient(d)}"></div><div class="cap">${d}</div>
          <div class="sky" style="margin-top:8px;background:${skyGradient(d, { cloud: 0.7 })}"></div><div class="cap">cloud .7</div>
          <div class="sky" style="margin-top:8px;background:${skyGradient(d, { haze: 0.8 })}"></div><div class="cap">haze .8</div></div>`,
      ).join("")}</div>`,
    ),
  );

  return `<div class="pv">${parts.join("")}</div>`;
}

function ogCard(): string {
  const data = defaultSkylineData();
  const W = 1200;
  const H = 630;
  const sky = skyGradient("rush");
  const sw = 1200;
  const sh = 300;
  const g = skylineGeometry(data, { width: sw, height: sh });
  const p = g.at(0.4);
  const ridge = skyline(data, { width: sw, height: sh, daypart: "rush", activeSummit: 5 }).replace(
    `<g class="skyline-playhead"></g>`,
    `<g class="skyline-playhead"><g transform="translate(${n(p.x)} ${n(p.y - 1)}) rotate(${n(p.angle)}) scale(.55)">${shredderGroup()}</g></g>`,
  );
  return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${sky}">
    <div style="position:absolute;left:172px;top:372px;width:2600px;height:2600px;translate:-50% -50%;border-radius:50%;background:repeating-conic-gradient(from 4deg, rgb(255 255 255 / .11) 0deg 10deg, rgb(255 255 255 / 0) 10deg 20deg)"></div>
    <div style="position:absolute;left:0;right:0;bottom:-6px;line-height:0">${ridge}</div>
    <div style="position:absolute;left:46px;top:262px;width:246px">${gull({ pose: "conduct" })}</div>
    <div style="position:absolute;right:40px;top:28px;width:150px;transform:rotate(8deg)">${sticker("801")}</div>
    <div style="position:absolute;left:330px;top:70px;transform:rotate(-4deg);font:400 112px/0.9 var(--font-display);color:var(--powder);-webkit-text-stroke:4px var(--ink);paint-order:stroke fill;text-shadow:6px 7px 0 var(--ink)">
      <div>Wasatch</div><div style="margin-left:.5em;color:var(--sun)">Symphony</div></div>
  </div>`;
}

if (view === "boot") {
  document.body.style.background = "#000";
  const asked = params.get("daypart") ?? "";
  const daypart: Daypart = (DAYPARTS as readonly string[]).includes(asked) ? (asked as Daypart) : "rush";
  const w = window.innerWidth;
  app.innerHTML = bootScene({
    daypart,
    haze: Number(params.get("haze") ?? 0),
    status1: "Friday 5:42 PM · Evening rush · 377 vehicles moving",
    status2: "Clean air · No new snow · Lake 4,189.8 ft",
    skylineWidth: w,
    skylineHeight: Math.round(Math.max(140, Math.min(260, w * 0.5, window.innerHeight * 0.22))),
  });
} else if (view === "og") {
  document.body.style.margin = "0";
  app.innerHTML = ogCard();
} else if (view === "icon") {
  const size = Number(params.get("size") ?? 512);
  document.body.style.margin = "0";
  document.body.style.background = "transparent";
  app.innerHTML = `<div style="width:${size}px;height:${size}px">${appIconSvg({ full: params.get("full") === "1" })}</div>`;
} else {
  app.innerHTML = gallery();
}
