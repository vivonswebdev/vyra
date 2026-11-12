import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import type { RasterImage } from "../src/index.js";

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

export function loadMotif(name: string): RasterImage {
  const png = PNG.sync.read(fs.readFileSync(path.join(FIXTURES, "motifs", name + ".png")));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

export const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

export const readFixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
