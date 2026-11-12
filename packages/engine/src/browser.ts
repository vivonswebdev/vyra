// Fonctions du moteur qui exigent un navigateur (canvas 2D, Image, Blob).
// Le rendu est celui de la v0.2 : fidèle au fichier exporté (mêmes points).

import * as E from "./generated/engine.js";
import type { Plan, RasterImage, RenderOptions, ViewTransform } from "./types.js";

export function renderPlan(ctx: CanvasRenderingContext2D, plan: Plan, view: ViewTransform, opts: RenderOptions = {}): void {
  E.renderPlan(ctx, plan, view, opts);
}

export function fabricPattern(ctx: CanvasRenderingContext2D, color: string, scale: number): CanvasPattern | null {
  return E.fabricPattern(ctx, color, scale) as CanvasPattern | null;
}

export function planToPngBlob(plan: Plan, pxPerMm = 8): Promise<Blob | null> {
  return E.planToPngBlob(plan, pxPerMm) as Promise<Blob | null>;
}

/** Image -> pixels RGBA, réduite à 1 600 px de côté au plus (comportement v0.2). */
export function rasterizeImage(source: CanvasImageSource, width: number, height: number): RasterImage {
  return E.rasterizeImage(source, width, height) as RasterImage;
}

/** Charge une image par URL ; les SVG sont rendus à 1 200 px (comportement v0.2). */
export function loadImageUrl(url: string, isSvg: boolean): Promise<RasterImage> {
  return E.loadImageUrl(url, isSvg) as Promise<RasterImage>;
}

export function imageToDataUrl(img: RasterImage): string {
  return E.imageToDataUrl(img) as string;
}
