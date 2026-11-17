// Atelier vêtement : feuille du patron et motif continu (sans DOM). Un motif posé sur la feuille doit se
// retrouver continu, sur le vêtement cousu, à travers chaque couture.
import { describe, expect, it } from "vitest";
import { GARMENTS, type GarmentId } from "../src/atelier/garments.js";
import { apply, inverse, pieceToSheet, sheetExtent, sheetPieces, sheetToPiece } from "../src/atelier/sheet.js";

const IDS = Object.keys(GARMENTS) as GarmentId[];

describe("atelier : feuille du patron", () => {
  it("transformations inversibles ; aller-retour pièce → feuille → pièce exact", () => {
    for (const id of IDS) {
      const g = GARMENTS[id];
      for (const p of sheetPieces(g)) {
        const [x, y] = apply(inverse(p.M), ...apply(p.M, 3.2, 11.5));
        expect(x).toBeCloseTo(3.2, 9);
        expect(y).toBeCloseTo(11.5, 9);
      }
      for (const [piece, x, y] of [["front", 5, 20], ["back", -7, 30], ["sleeveL", 6, 12], ["sleeveR", -6, 12], ["sleeveL", -4, 9]] as const) {
        const [sx, sy] = pieceToSheet(g, piece, x, y);
        const back = sheetToPiece(g, sx, sy)!;
        expect(back.piece, `${id} ${piece}`).toBe(piece);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it("continuité aux coutures de côté : une bande horizontale garde sa hauteur du devant au dos", () => {
    for (const id of IDS) {
      const g = GARMENTS[id];
      const y = 45; // cm sous la ligne d'épaule
      // Bord droit du devant (côté) et bord gauche du dos (même couture, vue extérieure) : même hauteur sur la feuille.
      const [, fy] = pieceToSheet(g, "front", g.W / 2, y);
      const [, by] = pieceToSheet(g, "back", -g.W / 2, y);
      expect(fy).toBeCloseTo(by, 9);
    }
  });

  it("continuité au dessus de manche : les moitiés avant et arrière se rejoignent à la même hauteur de manche", () => {
    for (const id of IDS) {
      const g = GARMENTS[id];
      for (const piece of ["sleeveL", "sleeveR"] as const) {
        // Le même point de la couture du dessus (x = 0), vu sur l'assemblage devant puis dos.
        const front = sheetPieces(g).find((p) => p.piece === piece && p.sgn === 1)!;
        const back = sheetPieces(g).find((p) => p.piece === piece && p.sgn === -1)!;
        for (const along of [2, g.L / 2, g.L - 1]) {
          const a = apply(inverse(front.M), ...apply(front.M, 0, along));
          const b = apply(inverse(back.M), ...apply(back.M, 0, along));
          expect(a[1]).toBeCloseTo(b[1], 9);
        }
        // Un motif à la même hauteur relative sur les deux assemblages tombe à la même distance de l'épaule.
        const e = sheetExtent(g);
        const sy = e.top + 20;
        const hitF = sheetToPiece(g, front.M.e + 0.01, sy), hitB = sheetToPiece(g, back.M.e - 0.01, sy);
        expect(hitF && hitB).toBeTruthy();
      }
    }
  });

  it("la manche continue le devant : un point juste au-delà de l'emmanchure tombe dans la manche, pas hors du vêtement", () => {
    const g = GARMENTS.hoodie;
    const e = sheetExtent(g);
    // Bande à 12 cm sous l'épaule, de part et d'autre de l'emmanchure côté manche gauche du porteur.
    const inBody = sheetToPiece(g, e.frontX + g.W / 2 - 2, e.top + 12)!;
    const inSleeve = sheetToPiece(g, e.frontX + g.W / 2 + 6, e.top + 12)!;
    expect(inBody.piece).toBe("front");
    expect(inSleeve.piece).toBe("sleeveL");
    expect(inSleeve.at.sgn).toBe(1);
  });

  it("hors des pièces (entre les deux assemblages) : aucune pièce", () => {
    const g = GARMENTS.tee;
    const e = sheetExtent(g);
    expect(sheetToPiece(g, (e.frontX + e.backX) / 2, e.top + g.H - 2)).toBeNull();
  });
});
