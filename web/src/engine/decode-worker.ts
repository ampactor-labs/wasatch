// A worker that decodes the piano's samples with the engine's own decoder
// (symphonia, in WebAssembly), so every browser holds the same samples.
// It runs a second instance of the same module, off the audio thread, while
// the listener reads the status screen.

/// <reference lib="webworker" />
import { EngineHandle } from "./protocol.ts";

type Job = { module: WebAssembly.Module; base: string; files: [string, number][]; seconds: number };

self.onmessage = async (e: MessageEvent<Job>) => {
  const { module, base, files, seconds } = e.data;
  const engine = await EngineHandle.fromModule(module);
  for (const [name, midi] of files) {
    try {
      const res = await fetch(`${base}${name}.mp3`);
      if (!res.ok) throw new Error(`${res.status}`);
      const mp3 = new Uint8Array(await res.arrayBuffer());
      const decoded = engine.decode(mp3, seconds);
      if (!decoded) throw new Error("decode failed");
      (self as unknown as Worker).postMessage({ name, midi, rate: decoded.rate, pcm: decoded.pcm }, [decoded.pcm.buffer]);
    } catch (err) {
      (self as unknown as Worker).postMessage({ name, midi, error: String(err) });
    }
  }
  (self as unknown as Worker).postMessage({ done: true });
};
