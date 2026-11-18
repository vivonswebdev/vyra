// Atelier vêtement : calcul des maquettes 3D hors du fil principal (l'interface reste fluide).
import { buildMockup } from "./mockup.js";
import type { Garment, Layout } from "./garments.js";

self.onmessage = (ev: MessageEvent<{ id: number; g: Garment; layout: Layout }>) => {
  const { id, g, layout } = ev.data;
  const m = buildMockup(g, layout);
  (self as unknown as Worker).postMessage({ id, m }, [m.position.buffer, m.normal.buffer, m.uv.buffer, m.ao.buffer]);
};
