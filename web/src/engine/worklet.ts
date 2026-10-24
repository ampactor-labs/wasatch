// The AudioWorklet processor: the whole engine, rendered on the audio thread.
//
// The page compiles the WebAssembly module and posts it here (or posts the
// bytes, where a browser can't clone a module into a worklet, and this side
// compiles them). Messages queue until the engine exists. Each render quantum
// asks the engine for its frames and sends any events back as raw bytes: a
// worklet has no TextDecoder, so the page decodes them.

/// <reference lib="webworker" />
import { EngineHandle, Kind } from "./protocol.ts";

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

type Incoming =
  | { type: "module"; module?: WebAssembly.Module; bytes?: ArrayBuffer }
  | { type: "post"; kind: number; bytes: Uint8Array }
  | { type: "clock"; contextFrame: number; utcMs: number };

class WasatchProcessor extends AudioWorkletProcessor {
  private engine: EngineHandle | null = null;
  private queue: { kind: number; bytes: Uint8Array }[] = [];
  /** Frames the engine has rendered: its own clock. */
  private engineFrame = 0;
  /** The context frame at which the engine rendered its first frame. */
  private firstContextFrame = -1;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Incoming>) => this.receive(e.data);
  }

  private receive(msg: Incoming): void {
    if (msg.type === "module") {
      try {
        const module = msg.module ?? new WebAssembly.Module(msg.bytes ?? new ArrayBuffer(0));
        this.engine = EngineHandle.fromModuleSync(module);
        this.engine.init(sampleRate);
        for (const q of this.queue) this.engine.post(q.kind, q.bytes);
        this.queue = [];
        this.port.postMessage({ type: "ready", sampleRate });
      } catch (err) {
        this.port.postMessage({ type: "error", message: String(err) });
      }
      return;
    }
    if (msg.type === "clock") {
      // A context frame and the UTC time it is heard; translate the frame to
      // the engine's own count.
      if (this.firstContextFrame < 0) return;
      const engineFrame = msg.contextFrame - this.firstContextFrame;
      const bytes = new Uint8Array(16);
      const view = new DataView(bytes.buffer);
      view.setFloat64(0, engineFrame, true);
      view.setFloat64(8, msg.utcMs, true);
      this.deliver(Kind.CLOCK, bytes);
      return;
    }
    this.deliver(msg.kind, msg.bytes);
  }

  private deliver(kind: number, bytes: Uint8Array): void {
    if (this.engine) this.engine.post(kind, bytes);
    else this.queue.push({ kind, bytes });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0];
    if (!left) return true;
    const n = left.length;
    if (!this.engine) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    if (this.firstContextFrame < 0) {
      this.firstContextFrame = currentFrame;
      this.port.postMessage({ type: "started", contextFrame: currentFrame });
    }
    const [l, r] = this.engine.render(n);
    left.set(l);
    if (out[1]) out[1].set(r);
    for (let c = 2; c < out.length; c++) out[c]?.set(l);
    const events = this.engine.outbox();
    if (events.length) {
      this.port.postMessage(
        { type: "events", bytes: events, engineFrame: this.engineFrame, contextFrame: currentFrame },
        [events.buffer],
      );
    }
    this.engineFrame += n;
    return true;
  }
}

registerProcessor("wasatch", WasatchProcessor);
