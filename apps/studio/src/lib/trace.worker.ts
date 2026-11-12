// Analyse d'image hors du fil principal : l'interface reste fluide pendant le calcul.
import { traceImage, type RasterImage, type TraceOptions } from "@vyra/engine";

self.onmessage = (e: MessageEvent<{ id: number; img: RasterImage; options: TraceOptions; name: string }>) => {
  const { id, img, options, name } = e.data;
  try {
    const r = traceImage(img, options, name);
    (self as any).postMessage({ id, ok: true, design: r.design, report: r.report });
  } catch (err) {
    (self as any).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
