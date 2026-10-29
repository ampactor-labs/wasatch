// ?debug: a small panel of numbers for testing on a real phone. How hard
// the engine works against the design's budget (30% of one core), whether
// the audio drops out, the latencies the browser reports, the clock, the
// conductor, and the page's own frame rate. "Copy" puts it all on the
// clipboard with the browser's name, for a bug report.

import type { Host } from "../engine/host.ts";
import type { Conductor } from "../data/conductor.ts";
import { clockEstimate } from "../engine/clock.ts";
import { esc } from "../art/util.ts";

/** The engine's budget: a share of one core (DESIGN.md, Performance). */
const BUDGET = 0.3;

export function mountDebug(host: Host, conductor: Conductor | null): void {
  const stats = host.debug();
  const panel = document.createElement("aside");
  panel.className = "debug";
  panel.setAttribute("aria-label", "Debug numbers");
  document.body.appendChild(panel);

  // The page's frame rate, counted over each second.
  let frames = 0;
  let fps = 0;
  let worstFrame = 0;
  let lastFrame = performance.now();
  const count = (t: number) => {
    frames++;
    worstFrame = Math.max(worstFrame, t - lastFrame);
    lastFrame = t;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);

  const lines = (): [string, string, boolean][] => {
    const clock = clockEstimate();
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    return [
      [
        "engine",
        `${(stats.load * 100).toFixed(1)}% of a core · worst ${stats.worstMs.toFixed(2)} of ${stats.quantumMs.toFixed(2)} ms${stats.fine ? "" : " (ms timer)"} · ${stats.late} late`,
        stats.load > BUDGET || stats.late > 0,
      ],
      ["audio", `${stats.dropouts} dropouts${stats.dropouts ? ` (${Math.round(stats.droppedMs)} ms)` : ""} · ${stats.state}`, stats.dropouts > 0],
      [
        "level",
        `${Number.isFinite(stats.peakDb) ? `${stats.peakDb.toFixed(1)} dBFS peak` : "silent"}${stats.gain < 0.99 ? ` · ducked to ${stats.gain.toFixed(2)}` : ""}`,
        !(stats.peakDb > -60) || stats.gain < 0.99,
      ],
      [
        "output",
        `${(stats.sampleRate / 1000).toFixed(1)} kHz · ${host.simd ? "SIMD" : "scalar"} · latency ${Math.round(stats.baseLatencyMs)} + ${Math.round(stats.outputLatencyMs)} ms`,
        false,
      ],
      ["clock", `${clock.source} ±${Math.round(clock.uncertainty)} ms`, clock.uncertainty > 100],
      [
        "conductor",
        conductor ? `${conductor.stats.windows} windows · ${conductor.stats.observed} live departures` : "none (reading the feeds directly)",
        false,
      ],
      ["page", `${fps} fps · worst frame ${Math.round(worstFrame)} ms${heap ? ` · ${(heap / 1e6).toFixed(0)} MB` : ""}`, fps > 0 && fps < 30],
    ];
  };

  const render = () => {
    panel.innerHTML = `${lines()
      .map(([k, v, bad]) => `<div class="debug__row${bad ? " debug__row--bad" : ""}"><b>${esc(k)}</b> ${esc(v)}</div>`)
      .join("")}<button type="button" class="debug__copy">Copy</button>`;
    panel.querySelector("button")?.addEventListener("click", () => {
      const text = [`Wasatch Symphony ?debug, ${new Date().toISOString()}`, navigator.userAgent, ...lines().map(([k, v]) => `${k}: ${v}`)].join("\n");
      void navigator.clipboard?.writeText(text).then(
        () => panel.querySelector("button")?.replaceChildren("Copied"),
        () => {},
      );
    });
  };
  window.setInterval(() => {
    fps = frames;
    frames = 0;
    render();
    worstFrame = 0;
  }, 1000);
  render();
}
