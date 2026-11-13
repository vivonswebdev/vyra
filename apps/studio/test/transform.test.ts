// Poignées de transformation et presse-papiers d'objets : calculs purs, sans navigateur.
import { describe, expect, it } from "vitest";
import { createObject, objectBounds, type Design } from "@vyra/engine";
import {
  copyItem,
  cornerOf,
  handlePositions,
  hitHandle,
  isClipItem,
  MAX_THREADS,
  nextObjectId,
  oppositeCorner,
  pasteItem,
  rotationFromDrag,
  scaleFromDrag,
  transformObject,
} from "../src/editor/transform.js";

const square = (id: string, x = 10, y = 10, s = 20, color = 0) =>
  ({ ...createObject(id, "fill", color, { outer: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }], holes: [] }), name: "Carré" });
const design = (): Design => ({
  name: "t",
  widthMm: 100,
  heightMm: 100,
  threads: [{ rgb: "#5a3a28", name: "Brun", brand: "Madeira", code: "1059" }],
  objects: [square("obj1"), square("obj7", 50, 50, 10)],
});
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("poignées de transformation", () => {
  it("échelle par un coin : le coin opposé reste fixe, rapport conservé", () => {
    const o = square("a");
    const b = objectBounds(o);
    const anchor = oppositeCorner(b, "se");
    expect(anchor).toEqual({ x: 10, y: 10 });
    // Tirer le coin bas-droit de (30,30) à (50,50) : facteur 2.
    const k = scaleFromDrag(anchor, cornerOf(b, "se"), { x: 50, y: 50 }, b);
    close(k, 2);
    const r = objectBounds(transformObject(o, { cx: anchor.x, cy: anchor.y, k, a: 0 }));
    close(r.minX, 10);
    close(r.minY, 10);
    close(r.maxX, 50);
    close(r.maxY, 50);
  });

  it("échelle bornée : pas d'inversion ni d'objet plus petit que 0,5 mm, ni plus de 20 fois", () => {
    const o = square("a");
    const b = objectBounds(o);
    const anchor = oppositeCorner(b, "se");
    expect(scaleFromDrag(anchor, cornerOf(b, "se"), { x: 0, y: 0 }, b) * 20).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(scaleFromDrag(anchor, cornerOf(b, "se"), { x: 5000, y: 5000 }, b)).toBe(20);
    // Glisser perpendiculaire à la diagonale : aucun changement.
    close(scaleFromDrag(anchor, cornerOf(b, "se"), { x: 40, y: 20 }, b), 1);
  });

  it("rotation autour du centre, avec pas de 15° si demandé", () => {
    const c = { x: 20, y: 20 };
    close(rotationFromDrag(c, { x: 20, y: 0 }, { x: 40, y: 20 }, false), Math.PI / 2);
    close(rotationFromDrag(c, { x: 20, y: 0 }, { x: 25, y: 1 }, true), Math.PI / 12);
    const r = objectBounds(transformObject(square("a"), { cx: 20, cy: 20, k: 1, a: Math.PI / 2 }));
    close(r.minX, 10);
    close(r.maxY, 30);
  });

  it("poignées à l'écran et détection sous le doigt ou la souris", () => {
    const h = handlePositions({ minX: 10, minY: 10, maxX: 30, maxY: 30 }, { scale: 2, ox: 100, oy: 50 });
    expect(h.nw).toEqual({ x: 116, y: 66 });
    expect(h.se).toEqual({ x: 164, y: 114 });
    expect(h.rot).toEqual({ x: 140, y: 40 });
    expect(hitHandle(h, { x: 160, y: 110 }, 10)).toBe("se");
    expect(hitHandle(h, { x: 140, y: 44 }, 10)).toBe("rot");
    expect(hitHandle(h, { x: 140, y: 90 }, 10)).toBeNull();
    expect(hitHandle(h, { x: 152, y: 100 }, 22)).toBe("se"); // tolérance plus large au toucher
  });
});

describe("copier, coller, dupliquer", () => {
  it("colle avec un nouvel identifiant, décalé, au-dessus, sans modifier l'original", () => {
    const d = design();
    const item = copyItem(d, "obj1")!;
    const { design: out, id } = pasteItem(d, item, 5, "Carré (copie)");
    expect(id).toBe("obj8");
    expect(nextObjectId(d)).toBe("obj8");
    expect(out.objects).toHaveLength(3);
    expect(out.objects[2]).toMatchObject({ id: "obj8", name: "Carré (copie)", color: 0 });
    const a = objectBounds(out.objects[0]);
    const b = objectBounds(out.objects[2]);
    close(b.minX - a.minX, 5);
    close(b.minY - a.minY, 5);
    expect(out.objects[0]).toEqual(d.objects[0]);
    expect(d.objects).toHaveLength(2); // document d'origine intact (historique)
  });

  it("dans un autre motif : retrouve le même fil ou l'ajoute", () => {
    const item = copyItem(design(), "obj1")!;
    const other: Design = { ...design(), threads: [{ rgb: "#ffffff", name: "Blanc", brand: "", code: "" }], objects: [] };
    const r = pasteItem(other, item, 0, "x");
    expect(r.design.threads).toHaveLength(2);
    expect(r.design.objects[0].color).toBe(1);
    expect(r.id).toBe("obj1");
    const same: Design = { ...other, threads: [{ rgb: "#5A3A28", name: "Autre nom", brand: "Madeira", code: "1059" }] };
    expect(pasteItem(same, item, 0, "x").design.threads).toHaveLength(1);
    const full: Design = { ...other, threads: Array.from({ length: MAX_THREADS }, (_, i) => ({ rgb: i === 3 ? "#5b3b29" : "#ffffff", name: "", brand: "", code: String(i) })) };
    const r2 = pasteItem(full, item, 0, "x");
    expect(r2.design.threads).toHaveLength(MAX_THREADS);
    expect(r2.design.objects[0].color).toBe(3); // fil le plus proche
  });

  it("refuse un contenu de presse-papiers mal formé", () => {
    expect(isClipItem(copyItem(design(), "obj1"))).toBe(true);
    expect(isClipItem(null)).toBe(false);
    expect(isClipItem({ object: { id: 1 }, thread: { rgb: "#fff" } })).toBe(false);
    expect(copyItem(design(), "absent")).toBeNull();
  });
});
