#!/usr/bin/env node
// Contrôle du registre d'essais machine (format de legacy/vyra-studio-0.2/registre/xe1-essais.json).
// Réimplémente les règles écrites dans le champ « _regles » du registre (l'outil d'origine
// 02_TOOLS/pes-validator/check_registre.py est introuvable). Lecture seule : ne modifie rien.
// Usage : node packages/engine/scripts/check-registre.mjs <registre.json> [dossier-photos]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATUTS = ["Non testé", "Testé avec anomalie", "Testé et accepté", "Validé pour Brother XE1"];
const CONDITIONS = ["tissu", "stabilisateur", "aiguille", "fil_superieur", "fil_canette", "tension", "vitesse", "cadre", "dimensions_motif", "etat_tissu_avant"];
const QUALITE = ["qualite_points", "qualite_contours", "fils_visibles", "deplacements_cousus", "coupes", "densite", "comportement_couleurs", "lisibilite"];
const COMPARABLES = ["tissu", "stabilisateur", "aiguille", "fil_superieur", "fil_canette", "tension", "vitesse", "cadre"];
const PHOTO = /^16_BENCHMARKS\/essais\/.+\.(jpe?g|png|heic|webp)$/i;

/**
 * @param {any} reg registre d'essais (format xe1-essais.json)
 * @param {{ fingerprints?: Map<string, string>, photoRoot?: string | null, today?: Date }} [opts]
 * @returns {string[]} problèmes trouvés (vide si conforme)
 */
export function checkRegistry(reg, { fingerprints, photoRoot = null, today = new Date() } = {}) {
  const errors = [];
  const err = (f, m) => errors.push(`${f} : ${m}`);
  for (const [file, entry] of Object.entries(reg.fichiers ?? {})) {
    if (!STATUTS.includes(entry.statut)) err(file, `statut « ${entry.statut} » non autorisé`);
    const expectedFmt = file.endsWith(".v6.pes") ? "PES v6" : file.endsWith(".pes") ? "PES v1" : file.endsWith(".dst") ? "DST" : null;
    if (entry.format !== expectedFmt) err(file, `format « ${entry.format} » incohérent avec le fichier (${expectedFmt})`);
    if (fingerprints && ![...fingerprints.values()].includes("13_EXPORTS/" + file)) err(file, "fichier absent de 13_EXPORTS (registre d'empreintes)");
    const essais = entry.essais ?? [];
    if (entry.statut !== "Non testé" && !essais.length) err(file, "un statut autre que « Non testé » exige au moins un essai");
    for (const [i, e] of essais.entries()) {
      const at = `essai ${i + 1}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") || new Date(e.date) > today) err(file, `${at} : date invalide ou future`);
      if (fingerprints && fingerprints.get(e.sha256_fichier) !== "13_EXPORTS/" + file) err(file, `${at} : empreinte du fichier brodé différente du fichier de référence`);
      for (const c of CONDITIONS) if (!String(e.conditions?.[c] ?? "").trim()) err(file, `${at} : condition « ${c} » manquante`);
      if (!String(e.etat_tissu_apres ?? "").trim()) err(file, `${at} : état du tissu après manquant`);
      if (!String(e.observations ?? "").trim()) err(file, `${at} : observations manquantes`);
      if (e.lecture_machine?.fichier_lu == null) err(file, `${at} : lecture machine non renseignée`);
      // Texte d'aide recopié : égalité stricte, champ par champ, avec l'exemple du registre.
      // Le cadre est exclu : la valeur d'exemple (« SA439S 13 × 18 ») est aussi une valeur réelle.
      const ex = reg.exemple_essai ?? {};
      const pairs = [
        [e.observations, ex.observations],
        [e.etat_tissu_apres, ex.etat_tissu_apres],
        ...CONDITIONS.filter((c) => c !== "cadre").map((c) => [e.conditions?.[c], ex.conditions?.[c]]),
      ];
      for (const [val, help] of pairs)
        if (typeof val === "string" && val.trim() && typeof help === "string" && help.trim() && val.trim() === help.trim())
          err(file, `${at} : texte d'aide du modèle recopié (« ${val.slice(0, 40)} »)`);
      for (const q of QUALITE) {
        const n = e.qualite?.[q]?.note;
        if (n != null && (!Number.isInteger(n) || n < 0 || n > 3)) err(file, `${at} : note « ${q} » hors de 0 à 3`);
      }
      for (const p of e.photos ?? []) {
        if (!PHOTO.test(p)) err(file, `${at} : photo hors de 16_BENCHMARKS/essais/ ou format refusé (${p})`);
        else if (photoRoot && !fs.existsSync(path.join(photoRoot, p))) err(file, `${at} : photo introuvable (${p})`);
      }
    }
    const last = essais[essais.length - 1];
    if (["Testé et accepté", "Validé pour Brother XE1"].includes(entry.statut) && last) {
      if (last.lecture_machine?.fichier_lu !== true) err(file, "acceptation sans fichier lu par la machine");
      if (QUALITE.some((q) => last.qualite?.[q]?.note == null)) err(file, "acceptation sans les 8 notes de qualité");
      if (!Object.values(last.mesures ?? {}).some((v) => v != null)) err(file, "acceptation sans mesures");
      if (!(last.photos ?? []).length) err(file, "acceptation sans photo");
    }
    if (entry.statut === "Validé pour Brother XE1" && last) {
      if ((last.anomalies ?? []).some((a) => a.ouverte !== false)) err(file, "validation avec une anomalie ouverte");
      if (QUALITE.some((q) => (last.qualite?.[q]?.note ?? 0) < 2)) err(file, "validation avec une note inférieure à 2");
    }
  }
  // PES v1 et v6 d'un même fichier : mêmes conditions, sinon non comparables.
  for (const [file, entry] of Object.entries(reg.fichiers ?? {})) {
    if (!file.endsWith(".v6.pes")) continue;
    const v1 = reg.fichiers[file.replace(/\.v6\.pes$/, ".pes")];
    const a = v1?.essais?.at(-1)?.conditions;
    const b = entry.essais?.at(-1)?.conditions;
    if (a && b) for (const c of COMPARABLES) if (String(a[c] ?? "") !== String(b[c] ?? "")) err(file, `conditions v1/v6 différentes (« ${c} ») : essais non comparables`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage : node packages/engine/scripts/check-registre.mjs <registre.json> [dossier-photos]");
    process.exit(2);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fp = new Map(
    fs.readFileSync(path.join(here, "../fixtures/empreintes-reference-v0.2.0.sha256"), "utf8").split("\n")
      .filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/)),
  );
  const errors = checkRegistry(JSON.parse(fs.readFileSync(file, "utf8")), { fingerprints: fp, photoRoot: process.argv[3] ?? null });
  if (errors.length) {
    console.error(`Registre refusé (${errors.length} problème(s)) :\n- ` + errors.join("\n- "));
    process.exit(1);
  }
  console.log("Registre conforme aux règles.");
}
