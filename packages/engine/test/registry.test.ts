import { describe, expect, it } from "vitest";
import { checkRegistry } from "../scripts/check-registre.mjs";
import { parseFingerprints } from "../src/index.js";
import { readFixture } from "./helpers.js";

const registry = JSON.parse(readFixture("xe1-essais.json"));
const fp = new Map([...parseFingerprints(readFixture("empreintes-reference-v0.2.0.sha256"))].map(([h, f]) => [h, "13_EXPORTS/" + f]));
const essaiComplet = () => ({
  date: "2026-11-10",
  sha256_fichier: [...fp.entries()].find(([, f]) => f === "13_EXPORTS/motifs/02-fleur.pes")![0],
  conditions: { tissu: "Coton 180 g, écru", stabilisateur: "Déchirable 40 g, 1 couche", aiguille: "75/11 broderie", fil_superieur: "Polyester 40", fil_canette: "Canette 90 blanc", tension: "4", vitesse: "650", cadre: "SA439S 13 × 18", dimensions_motif: "99,5 × 138,5", etat_tissu_avant: "Repassé, tendu" },
  lecture_machine: { fichier_lu: true, taille_affichee: "9,9 × 13,8 cm", couleurs_affichees: 5, points_affiches: 9513, noms_couleurs: "" },
  qualite: Object.fromEntries(["qualite_points", "qualite_contours", "fils_visibles", "deplacements_cousus", "coupes", "densite", "comportement_couleurs", "lisibilite"].map((k) => [k, { note: 3, commentaire: "RAS" }])),
  mesures: { largeur_mm: 99.4, hauteur_mm: 138.6, ecart_centre_mm: 0.3, ecart_contour_mm: 0.4, duree_min: 17, casses_fil: 0 },
  etat_tissu_apres: "Aucun gondolage visible",
  anomalies: [],
  observations: "Couverture régulière, contours nets.",
  photos: ["16_BENCHMARKS/essais/2026-11-10/fleur-v1-face.jpg"],
});

describe("contrôle du registre d'essais XE1 (lecture seule)", () => {
  it("le registre livré est conforme : 18 fichiers, tous « Non testé »", () => {
    expect(Object.keys(registry.fichiers)).toHaveLength(18);
    expect(new Set(Object.values<any>(registry.fichiers).map((f) => f.statut))).toEqual(new Set(["Non testé"]));
    expect(checkRegistry(registry, { fingerprints: fp })).toEqual([]);
  });

  it("accepte un essai complet et cohérent", () => {
    const r = structuredClone(registry);
    r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Validé pour Brother XE1", essais: [essaiComplet()] };
    expect(checkRegistry(r, { fingerprints: fp, today: new Date("2026-11-12") })).toEqual([]);
  });

  it.each([
    ["statut sans essai", (r: any) => (r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Testé et accepté", essais: [] }), /exige au moins un essai/],
    ["empreinte d'un autre fichier", (r: any) => (r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Testé avec anomalie", essais: [{ ...essaiComplet(), sha256_fichier: "0".repeat(64) }] }), /empreinte/],
    ["date future", (r: any) => (r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Testé avec anomalie", essais: [{ ...essaiComplet(), date: "2099-01-01" }] }), /date/],
    ["texte d'aide recopié", (r: any) => (r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Testé avec anomalie", essais: [{ ...essaiComplet(), conditions: { ...essaiComplet().conditions, tissu: "nature, grammage, couleur" } }] }), /texte d'aide/],
    ["validation avec note 1", (r: any) => (r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Validé pour Brother XE1", essais: [{ ...essaiComplet(), qualite: { ...essaiComplet().qualite, densite: { note: 1, commentaire: "" } } }] }), /inférieure à 2/],
    ["photo hors dossier", (r: any) => (r.fichiers["motifs/02-fleur.pes"] = { format: "PES v1", statut: "Testé avec anomalie", essais: [{ ...essaiComplet(), photos: ["../photo.jpg"] }] }), /photo/],
  ])("refuse : %s", (_label, mutate, msg) => {
    const r = structuredClone(registry);
    mutate(r);
    expect(checkRegistry(r, { fingerprints: fp, today: new Date("2026-11-12") }).join("\n")).toMatch(msg);
  });
});
