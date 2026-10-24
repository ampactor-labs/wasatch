// Play along: hold the phone like a ski and tip it. The edge angle picks a
// note from the notes in play; a steady edge sustains chord tones, a wobble
// plays passing tones. It can't play a wrong note, and it's local: nobody
// else hears it. Without a motion sensor, drag across the ski instead.

import type { Host } from "../engine/host.ts";
import { Kind, encodePlay } from "../engine/protocol.ts";

const RUNGS = 15;
const MIN_GAP_MS = 95;
const STEADY_MS = 450;
const RESTRIKE_MS = 2200;

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export class PlayAlong {
  private readonly host: Host;
  private readonly onEdge: (edge: number) => void;
  private edgeNow = 0;
  private smoothed = 0;
  private rung = -1;
  private changedAt = 0;
  private struckAt = 0;
  private steadyAt = 0;
  private timer = 0;
  private listening = false;
  private readonly onOrient = (e: DeviceOrientationEvent) => {
    if (e.gamma === null) return;
    // Portrait, screen up: gamma is the roll onto the ski's edges. In
    // landscape, beta is.
    const turned = screen.orientation?.angle ?? 0;
    const landscape = turned === 90 || turned === 270;
    const angle = landscape ? (e.beta ?? 0) : e.gamma;
    this.smoothed += (angle - this.smoothed) * 0.35;
    this.edge(this.smoothed / 32);
  };

  constructor(host: Host, onEdge: (edge: number) => void) {
    this.host = host;
    this.onEdge = onEdge;
  }

  /** Whether this device can steer by tilting at all. */
  static hasMotion(): boolean {
    return typeof DeviceOrientationEvent !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }

  /** Ask for the motion sensor (iOS shows a prompt; this must run in a tap). */
  async strapIn(): Promise<boolean> {
    const ctor = DeviceOrientationEvent as OrientationCtor;
    if (typeof ctor.requestPermission === "function") {
      try {
        if ((await ctor.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    window.addEventListener("deviceorientation", this.onOrient);
    this.listening = true;
    this.run();
    return true;
  }

  /** Start the steady-edge clock without the sensor (for the pad). */
  run(): void {
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.check(), 50);
  }

  stop(): void {
    clearInterval(this.timer);
    if (this.listening) window.removeEventListener("deviceorientation", this.onOrient);
    this.listening = false;
  }

  /** A new edge, −1 (left) … 1 (right). */
  edge(value: number): void {
    const e = Math.max(-1, Math.min(1, value));
    const rung = Math.round(((e + 1) / 2) * (RUNGS - 1));
    const now = performance.now();
    const moved = Math.abs(e - this.edgeNow);
    this.edgeNow = e;
    this.onEdge(e);
    if (rung !== this.rung) {
      this.rung = rung;
      this.changedAt = now;
      this.steadyAt = 0;
      if (now - this.struckAt >= MIN_GAP_MS) this.strike(false, 0.35 + Math.min(0.5, moved * 4));
    }
  }

  /** A tap: play the edge now, as a chord tone. */
  tap(): void {
    this.strike(true, 0.7);
    this.steadyAt = performance.now();
  }

  private check(): void {
    const now = performance.now();
    if (this.rung < 0) return;
    const held = now - this.changedAt;
    if (held >= STEADY_MS && (this.steadyAt === 0 || now - this.steadyAt >= RESTRIKE_MS)) {
      this.strike(true, this.steadyAt === 0 ? 0.62 : 0.45);
      this.steadyAt = now;
    }
  }

  private strike(steady: boolean, vel: number): void {
    this.struckAt = performance.now();
    this.host.post(Kind.PLAY, encodePlay(this.edgeNow, vel, steady));
  }
}
