// Import de modèles 3D externes : nettoyage du .glb, ajustement au vêtement, projection des impressions.
import { describe, expect, it } from "vitest";
import { GARMENTS, layoutFor } from "../src/atelier/garments.js";
import { fitImported, ModelImportError, sanitizeGlb, type RawModel } from "../src/atelier/importModel.js";

/** Boîte (deux faces : avant +Z, arrière −Z) de x0..x1, y0..y1, en triangles indépendants. */
function slab(x0: number, x1: number, y0: number, y1: number, z: number): RawModel {
  const P: number[] = [], N: number[] = [];
  for (const [zz, nz] of [[z, 1], [-z, -1]]) {
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) { P.push(x, y, zz); N.push(0, 0, nz); }
  }
  return { position: new Float32Array(P), normal: new Float32Array(N) };
}
const join = (...ms: RawModel[]): RawModel => ({
  position: new Float32Array(ms.flatMap((m) => [...m.position])), normal: new Float32Array(ms.flatMap((m) => [...m.normal])),
});
function glb(json: unknown, bin = new Uint8Array(4)): ArrayBuffer {
  let t = new TextEncoder().encode(JSON.stringify(json));
  if (t.length % 4) { const p = new Uint8Array(t.length + 4 - (t.length % 4)).fill(0x20); p.set(t); t = p; }
  const out = new Uint8Array(28 + t.length + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, t.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(t, 20);
  dv.setUint32(20 + t.length, bin.length, true); dv.setUint32(24 + t.length, 0x004e4942, true); out.set(bin, 28 + t.length);
  return out.buffer;
}
const jsonOf = (buf: ArrayBuffer) => JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, new DataView(buf).getUint32(12, true))));

describe("import de modèle 3D", () => {
  const g = GARMENTS.tee, layout = layoutFor(g);

  it("ajuste l'échelle et la position : corps à la largeur du vêtement, haut des épaules en place", () => {
    // Modèle en mètres, décentré : corps de 0,5 m de large, manches qui dépassent en haut.
    const raw = join(slab(2.0, 2.5, 1.0, 1.7, 0.1), slab(1.7, 2.0, 1.5, 1.7, 0.05), slab(2.5, 2.8, 1.5, 1.7, 0.05));
    const m = fitImported(raw, g, layout);
    let top = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) { top = Math.max(top, m.position[i + 1]); minX = Math.min(minX, m.position[i]); maxX = Math.max(maxX, m.position[i]); }
    expect(top).toBeCloseTo(1, 5);
    expect(minX).toBeCloseTo(-maxX, 5); // centré sur le corps
    // Les 12 premiers sommets sont le corps : sa largeur vaut 84 % de la largeur à plat.
    expect(m.position[3] - m.position[0]).toBeCloseTo(g.W * 0.84, 4);
    expect(m.triangles).toBe(12);
  });

  it("projette le devant sur la pièce « Devant », l'arrière sur « Dos », et laisse les manches unies", () => {
    const raw = join(slab(-0.25, 0.25, 0, 0.7, 0.1), slab(0.25, 0.55, 0.5, 0.7, 0.05));
    const m = fitImported(raw, g, layout);
    const u = (i: number) => m.uv[i * 2] * layout.width, v = (i: number) => (1 - m.uv[i * 2 + 1]) * layout.height;
    // Face avant du corps (sommets 0 à 5) : dans la pièce devant, symétrique autour de son milieu.
    for (let i = 0; i < 6; i++) { expect(u(i)).toBeGreaterThanOrEqual(0); expect(u(i)).toBeLessThanOrEqual(g.W); }
    expect((u(0) + u(1)) / 2).toBeCloseTo(g.W / 2, 4);
    // Face arrière (6 à 11) : dans la pièce dos, en miroir (le côté droit du modèle reste du même côté du vêtement).
    for (let i = 6; i < 12; i++) { expect(u(i)).toBeGreaterThanOrEqual(g.W); expect(u(i)).toBeLessThanOrEqual(2 * g.W); }
    expect(u(6) - 1.5 * g.W).toBeCloseTo(-(u(0) - g.W / 2), 4);
    // Hauteur : le haut du modèle est le haut de la pièce.
    expect(v(2)).toBeCloseTo(0, 4);
    // Manche (12 et suivants) : zone unie de l'atlas.
    const p = layout.regions.plain;
    for (let i = 12; i < 24; i++) { expect(u(i)).toBeCloseTo(p.x0 + p.w / 2, 4); expect(v(i)).toBeCloseTo(p.y0 + p.h / 2, 4); }
  });

  it("« inverser devant et dos » retourne le modèle", () => {
    const raw = slab(-0.25, 0.25, 0, 0.7, 0.1);
    const a = fitImported(raw, g, layout), b = fitImported(raw, g, layout, true);
    expect(b.position[2]).toBeCloseTo(-a.position[2], 5);
    expect(b.uv[0] * layout.width).toBeGreaterThan(g.W); // l'ancienne face avant reçoit maintenant le dos
  });

  it("refuse un modèle vide ou abîmé", () => {
    expect(() => fitImported({ position: new Float32Array(9), normal: new Float32Array(9) }, g, layout)).toThrow(ModelImportError);
    expect(() => fitImported({ position: new Float32Array([0, 0, 0, 1, NaN, 0, 0, 1, 0]), normal: new Float32Array(9) }, g, layout)).toThrow(ModelImportError);
  });

  it("nettoie un .glb : ni image, ni texture, ni matière ; géométrie gardée", () => {
    const clean = sanitizeGlb(glb({
      asset: { version: "2.0" }, images: [{ uri: "https://exemple.invalid/suivi.png" }], textures: [{ source: 0 }], materials: [{}],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], buffers: [{ byteLength: 4 }],
    }, new Uint8Array([1, 2, 3, 4])));
    const j = jsonOf(clean);
    expect(j.images).toBeUndefined(); expect(j.textures).toBeUndefined(); expect(j.materials).toBeUndefined();
    expect(j.meshes[0].primitives[0]).toEqual({ attributes: { POSITION: 0 } });
    expect(new TextDecoder().decode(clean)).not.toContain("exemple.invalid");
    expect([...new Uint8Array(clean).slice(-4)]).toEqual([1, 2, 3, 4]);
    expect(new DataView(clean).getUint32(8, true)).toBe(clean.byteLength);
  });

  it("refuse un .glb compressé, à tampon externe, ou qui n'en est pas un", () => {
    const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as ModelImportError).code; } return "ok"; };
    expect(code(() => sanitizeGlb(glb({ asset: {}, extensionsRequired: ["KHR_draco_mesh_compression"] })))).toBe("compressed");
    expect(code(() => sanitizeGlb(glb({ asset: {}, extensionsUsed: ["EXT_meshopt_compression"] })))).toBe("compressed");
    expect(code(() => sanitizeGlb(glb({ asset: {}, buffers: [{ uri: "https://exemple.invalid/geo.bin" }] })))).toBe("external");
    expect(code(() => sanitizeGlb(new TextEncoder().encode("pas un modèle 3D, juste du texte").buffer))).toBe("format");
  });
});
