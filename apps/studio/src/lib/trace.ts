import type { Design, RasterImage, TraceOptions, TraceReport } from "@vyra/engine";

let worker: Worker | null = null;
let seq = 0;

export function traceInWorker(img: RasterImage, options: TraceOptions, name: string): Promise<{ design: Design; report: TraceReport }> {
  worker ??= new Worker(new URL("./trace.worker.ts", import.meta.url), { type: "module" });
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      worker!.removeEventListener("message", onMsg);
      e.data.ok ? resolve({ design: e.data.design, report: e.data.report }) : reject(new Error(e.data.error));
    };
    worker!.addEventListener("message", onMsg);
    worker!.postMessage({ id, img, options, name });
  });
}
