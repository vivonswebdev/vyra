// Chargement d'une image (PNG, JPG, WEBP, BMP, SVG, PDF) en pixels RGBA pour l'analyse.
// Même traitement que la v0.2 : 1 600 px de côté au plus, SVG rendus à 1 200 px, PDF page 1 à 1 400 px.
import { loadImageUrl, imageToDataUrl } from "@vyra/engine/browser";
import type { RasterImage } from "@vyra/engine";

export const MAX_UPLOAD = 20 * 1024 * 1024;
export const ACCEPT = ".png,.jpg,.jpeg,.webp,.bmp,.svg,.pdf,image/png,image/jpeg,image/webp,image/bmp,image/svg+xml,application/pdf";

export function isSupported(file: File) {
  return /\.(png|jpe?g|webp|bmp|svg|pdf)$/i.test(file.name) || /^(image\/(png|jpeg|webp|bmp|svg\+xml)|application\/pdf)$/.test(file.type);
}

export async function fileToRaster(file: Blob & { name?: string }): Promise<{ img: RasterImage; preview: string }> {
  const name = (file.name ?? "").toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    const img = await pdfToRaster(await file.arrayBuffer());
    return { img, preview: imageToDataUrl(img) };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageUrl(url, file.type.includes("svg") || name.endsWith(".svg"));
    return { img, preview: imageToDataUrl(img) };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function urlToRaster(url: string) {
  const img = await loadImageUrl(url, url.endsWith(".svg"));
  return { img, preview: imageToDataUrl(img) };
}

async function pdfToRaster(data: ArrayBuffer): Promise<RasterImage> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 1400 / Math.max(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await task.destroy();
  return { width: canvas.width, height: canvas.height, data: d.data };
}
