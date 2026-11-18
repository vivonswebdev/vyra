// Atelier vêtement : import d'un modèle 3D externe (.glb ou .obj), par exemple un vêtement modélisé dans
// Marvelous Designer, CLO ou Blender. Le fichier reste dans le navigateur. Seule sa forme est gardée : ses
// textures et matières sont ignorées (la matière tissu de l'atelier les remplace) et aucune adresse externe
// n'est chargée. Le modèle est mis à l'échelle du vêtement choisi et ses impressions sont projetées à plat :
// la face avant reçoit la pièce « Devant » du patron, la face arrière la pièce « Dos ».
// Convention attendue : axe Y vers le haut, devant du vêtement vers +Z (convention glTF).
import * as THREE from "three";
import { type Garment, type Layout } from "./garments.js";
import type { Mockup } from "./mockup.js";

/** Forme brute : triangles indépendants (3 sommets chacun), positions et normales. */
export interface RawModel { position: Float32Array; normal: Float32Array }
export type ImportError = "format" | "size" | "empty" | "compressed" | "external" | "parse";
export class ModelImportError extends Error {
  constructor(public code: ImportError) { super(code); }
}

export const MODEL_MAX_BYTES = 40 * 1024 * 1024;
export const MODEL_MAX_TRIANGLES = 600_000;

/**
 * Nettoie un fichier .glb avant lecture : retire images, textures et matières (rien à décoder, rien à
 * télécharger), refuse les tampons externes et la géométrie compressée (Draco, Meshopt).
 */
export function sanitizeGlb(buf: ArrayBuffer): ArrayBuffer {
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new ModelImportError("format");
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > buf.byteLength) throw new ModelImportError("format");
  let json: Record<string, unknown>;
  try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))); } catch { throw new ModelImportError("format"); }
  const used = [...((json.extensionsRequired as string[]) ?? []), ...((json.extensionsUsed as string[]) ?? [])];
  if (used.some((e) => /draco|meshopt/i.test(e))) throw new ModelImportError("compressed");
  for (const b of (json.buffers as { uri?: string }[]) ?? []) if (b.uri && !b.uri.startsWith("data:")) throw new ModelImportError("external");
  for (const k of ["images", "textures", "samplers", "materials", "animations", "skins", "cameras", "extensionsUsed", "extensionsRequired", "extensions"]) delete json[k];
  for (const m of (json.meshes as { primitives?: Record<string, unknown>[] }[]) ?? []) for (const p of m.primitives ?? []) { delete p.material; delete p.extensions; }
  for (const n of (json.nodes as Record<string, unknown>[]) ?? []) { delete n.skin; delete n.camera; delete n.extensions; }
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) { const t = new Uint8Array(text.length + pad).fill(0x20); t.set(text); text = t; }
  const rest = new Uint8Array(buf, 20 + jsonLen);
  const out = new Uint8Array(20 + text.length + rest.length), ov = new DataView(out.buffer);
  ov.setUint32(0, 0x46546c67, true); ov.setUint32(4, 2, true); ov.setUint32(8, out.length, true);
  ov.setUint32(12, text.length, true); ov.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.set(rest, 20 + text.length);
  return out.buffer;
}

/** Lit un fichier .glb ou .obj et rend sa forme (tous ses maillages réunis, transformations appliquées). */
export async function parseModelFile(name: string, buf: ArrayBuffer): Promise<RawModel> {
  if (buf.byteLength > MODEL_MAX_BYTES) throw new ModelImportError("size");
  const ext = name.toLowerCase().split(".").pop();
  if (ext !== "glb" && ext !== "obj") throw new ModelImportError("format");
  let root: THREE.Object3D;
  try {
    if (ext === "glb") {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const clean = sanitizeGlb(buf);
      root = (await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(clean, "", res as never, rej))).scene;
    } else {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      // Les bibliothèques de matières (.mtl) d'un .obj ne sont pas chargées par ce lecteur.
      root = new OBJLoader().parse(new TextDecoder().decode(buf));
    }
  } catch (e) {
    throw e instanceof ModelImportError ? e : new ModelImportError("parse");
  }
  root.updateMatrixWorld(true);
  const P: number[] = [], N: number[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    let geo = mesh.geometry;
    if (!geo.attributes.normal) { geo = geo.clone(); geo.computeVertexNormals(); }
    const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
    nm.getNormalMatrix(mesh.matrixWorld);
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) for (let k = 0; k < 3; k++) {
      const a = idx ? idx.getX(i + k) : i + k;
      v.fromBufferAttribute(pos, a).applyMatrix4(mesh.matrixWorld);
      n.fromBufferAttribute(nor, a).applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z);
    }
  });
  if (P.length < 9) throw new ModelImportError("empty");
  if (P.length / 9 > MODEL_MAX_TRIANGLES) throw new ModelImportError("size");
  return { position: new Float32Array(P), normal: new Float32Array(N) };
}

/**
 * Ajuste un modèle au vêtement : centré, haut des épaules à la hauteur de la maquette, corps mis à la
 * largeur du vêtement, puis impressions projetées à plat (devant / dos). Les manches et ce qui dépasse du
 * corps restent en tissu uni. flip : retourne le modèle (devant ↔ dos) s'il regarde vers −Z.
 * Pur (sans DOM ni WebGL) : testable tel quel.
 */
export function fitImported(raw: RawModel, g: Garment, layout: Layout, flip = false): Mockup {
  const n = raw.position.length / 3, P = new Float32Array(raw.position), N = new Float32Array(raw.normal);
  if (flip) for (let i = 0; i < n; i++) { P[i * 3] = -P[i * 3]; P[i * 3 + 2] = -P[i * 3 + 2]; N[i * 3] = -N[i * 3]; N[i * 3 + 2] = -N[i * 3 + 2]; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (!Number.isFinite(x + y + z)) throw new ModelImportError("parse");
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0)) throw new ModelImportError("empty");
  // Corps : dans la tranche du bas (l'ourlet), on réunit les étendues en x des triangles ; le groupe continu
  // le plus proche du milieu est le corps (les poignets de manches longues qui pendent à cette hauteur en
  // sont séparés par un vide). Fiable aussi sur un maillage à grands triangles.
  const spans: [number, number][] = [];
  for (let t = 0; t < n; t += 3) {
    const ya = P[t * 3 + 1], yb = P[t * 3 + 4], yc = P[t * 3 + 7];
    if (Math.min(ya, yb, yc) > y0 + h * 0.1) continue;
    spans.push([Math.min(P[t * 3], P[t * 3 + 3], P[t * 3 + 6]), Math.max(P[t * 3], P[t * 3 + 3], P[t * 3 + 6])]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  const groups: [number, number][] = [], gap = w * 0.02;
  for (const sp of spans) {
    const last = groups[groups.length - 1];
    if (last && sp[0] <= last[1] + gap) last[1] = Math.max(last[1], sp[1]); else groups.push([sp[0], sp[1]]);
  }
  const cx0 = (x0 + x1) / 2, dist = (q: [number, number]) => (cx0 < q[0] ? q[0] - cx0 : cx0 > q[1] ? cx0 - q[1] : 0);
  const body = groups.reduce((best, q) => (dist(q) < dist(best) || (dist(q) === dist(best) && q[1] - q[0] > best[1] - best[0]) ? q : best), groups[0] ?? [x0, x1]);
  const cx = (body[0] + body[1]) / 2, bodyHalf = Math.max((body[1] - body[0]) / 2, w * 0.05);
  // Le corps vu de face fait environ 84 % de la largeur à plat (le reste part dans l'épaisseur).
  const k = (g.W * 0.84) / (2 * bodyHalf), cz = (z0 + z1) / 2, top = 1;
  const uv = new Float32Array(n * 2), ao = new Float32Array(n).fill(1);
  const plain = layout.regions.plain, pu = (plain.x0 + plain.w / 2) / layout.width, pv = 1 - (plain.y0 + plain.h / 2) / layout.height;
  const half = bodyHalf * k; // demi-largeur du corps, en cm
  for (let i = 0; i < n; i++) { P[i * 3] = (P[i * 3] - cx) * k; P[i * 3 + 1] = (P[i * 3 + 1] - y1) * k + top; P[i * 3 + 2] = (P[i * 3 + 2] - cz) * k; }
  let shoulder = 0;
  for (let t = 0; t < n; t += 3) {
    const mx = (P[t * 3] + P[t * 3 + 3] + P[t * 3 + 6]) / 3, nz = N[t * 3 + 2] + N[t * 3 + 5] + N[t * 3 + 8];
    const onBody = Math.abs(mx) <= half * 1.02;
    for (let q = t; q < t + 3; q++) {
      const x = P[q * 3], v = top - P[q * 3 + 1];
      if (!onBody || v > g.H) { uv[q * 2] = pu; uv[q * 2 + 1] = pv; continue; }
      // Au milieu, 1 cm de modèle = 1 cm de patron ; le bord visible du corps tombe à 86 % de la demi-pièce.
      const dx = (Math.max(-1, Math.min(1, x / half)) * 0.86 * g.W) / 2;
      const u = nz >= 0 ? g.W / 2 + dx : 1.5 * g.W - dx;
      uv[q * 2] = u / layout.width; uv[q * 2 + 1] = 1 - Math.max(0, v) / layout.height;
      if (v < 8) shoulder = Math.max(shoulder, Math.abs(x));
    }
  }
  return { position: P, normal: N, uv, ao, cords: [], top, shoulder: Math.min(shoulder || half, half), triangles: n / 3 };
}
