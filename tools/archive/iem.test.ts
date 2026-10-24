import assert from "node:assert/strict";
import { test } from "node:test";
import { obsFromMetar } from "../../web/src/data/feeds.ts";
import { metarsFromIem } from "./iem.ts";

// Three of KSLC's reports as the archive gives them, the last a rainy special.
const CSV = `station,valid,tmpf,sknt,gust,skyc1,skyc2,skyc3,skyc4,skyl1,skyl2,skyl3,skyl4,wxcodes,p01i,metar
SLC,2026-08-16 00:54,86.00,3.00,null,FEW,FEW,null,null,9500.00,19000.00,null,null,null,0.00,KSLC 160054Z VRB03KT 10SM FEW095 FEW190 30/07 A3016 RMK AO2 SLP162 T03000067 VISNO NW RNWY $
SLC,2026-08-16 01:54,85.00,3.00,null,FEW,FEW,null,null,9000.00,18000.00,null,null,null,T,KSLC 160154Z VRB03KT 10SM FEW090 FEW180 29/07 A3016 RMK AO2 SLP159 T02940067 VISNO NW RNWY $
SLC,2026-09-12 22:10,61.00,18.00,27.00,BKN,OVC,null,null,4500.00,7000.00,null,null,-RA BR,0.04,KSLC 122210Z 32018G27KT 6SM -RA BR BKN045 OVC070 16/12 A2990 RMK AO2 P0004
`;

test("the archive's reports read like the Aviation Weather Center's", () => {
  const m = metarsFromIem(CSV);
  assert.equal(m.length, 3);
  assert.equal(m[0]!.obsTime, Date.parse("2026-08-16T00:54:00Z") / 1000);
  assert.equal(m[0]!.temp, 30);
  assert.deepEqual(m[0]!.clouds, [
    { cover: "FEW", base: 9500 },
    { cover: "FEW", base: 19000 },
  ]);
  assert.equal(m[0]!.wgst, null);
  assert.equal(m[1]!.precip, 0.0001); // a trace
  assert.match(m[0]!.rawOb, /^KSLC 160054Z/);
  // And they become the same observations the phones steer by.
  const rain = obsFromMetar(m[2]!);
  assert.equal(rain.cloud, 1);
  assert.ok(rain.rain > 0 && rain.snow === 0);
  assert.ok(Math.abs(rain.gustMs! - 27 * 0.514444) < 1e-6);
});

test("an unexpected format fails loudly", () => {
  assert.throws(() => metarsFromIem("station,valid,tmpf\nSLC,2026-08-16 00:54,86\n"), /unexpected columns/);
});
