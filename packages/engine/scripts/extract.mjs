#!/usr/bin/env node
// Extrait le moteur de broderie du build de l'artifact « VYRA Studio » (v0.2.x) vers
// src/generated/engine.js, sans modifier une seule instruction du moteur.
//
// Pourquoi : le dépôt source d'origine (src/engine/*.ts, étiquette v0.2.0) n'est pas
// accessible depuis ce dépôt. Le build publié contient le moteur complet ; ses exports
// reproduisent octet pour octet les 24 fichiers de référence v0.2.0 des 8 motifs.
//
// Méthode :
//   1. lecture du module JavaScript du build (legacy/vyra-studio-0.2/index.html) ;
//   2. fermeture transitive des déclarations atteintes depuis les points d'entrée
//      ci-dessous (aucune dépendance à React ni à pdf.js : vérifié à l'extraction) ;
//   3. renommage des symboles de premier niveau par portée (Babel scope.rename),
//      les variables locales gardent leur nom minifié ;
//   4. ajout des exports nommés et mise en forme (Prettier).
//
// Le résultat est contrôlé par test/reference.test.ts : mêmes empreintes SHA-256
// que le registre v0.2.0. Ne pas modifier src/generated/engine.js à la main.
//
// Usage : node packages/engine/scripts/extract.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { parse } from "@babel/parser";
import traverseMod from "@babel/traverse";
import generateMod from "@babel/generator";
import * as prettier from "prettier";

const traverse = traverseMod.default ?? traverseMod;
const generate = generateMod.default ?? generateMod;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const SOURCE = path.join(root, "legacy/vyra-studio-0.2/index.html");
const OUT = path.resolve(here, "../src/generated/engine.js");

// Nom minifié -> nom public. Les entrées de cette table sont les points d'entrée
// de l'extraction ET les noms exportés. Les autres symboles atteints sont renommés
// par la table INTERNAL ou gardent leur nom minifié (préfixé « m_ »).
const PUBLIC = {
  // Constantes de commande de point
  _e: "STITCH",
  Qt: "JUMP",
  gl: "TRIM",
  ro: "END",
  $a: "COLOR_CHANGE",
  // Paramètres par défaut
  dw: "DEFAULT_FILL",
  mw: "DEFAULT_SATIN",
  pw: "DEFAULT_RUN",
  qw: "DEFAULT_TRACE_OPTIONS",
  Le: "QC_THRESHOLDS",
  vb: "FORMAT_LIMITS",
  X6: "STITCH_TYPES",
  // Analyse, plan, statistiques, contrôle
  d6: "traceImage",
  x3: "buildPlan",
  vm: "computeStats",
  F3: "runQualityChecks",
  Rf: "stitchThreadIndex",
  // Encodeurs
  wb: "writePES1",
  yb: "writePES6",
  I3: "writeDST",
  D6: "zipSingleFile",
  // Machines et fils
  rf: "MACHINES",
  em: "PEC_PALETTE",
  p6: "CHART_BRANDS",
  jb: "PEC_CHART",
  D3: "PENDING_CHARTS",
  Ib: "nearestPecThread",
  b6: "threadFromChartEntry",
  B3: "matchChartEntries",
  _3: "parseChartCsv",
  // Géométrie et édition
  bt: "distance",
  Sf: "simplifyPath",
  _b: "createObject",
  Fw: "mapObjectPoints",
  Dw: "objectBounds",
  W6: "objectCenter",
  Y6: "hitTestObject",
  Ow: "pointSegmentDistance",
  // Rendu
  Cm: "renderPlan",
  j6: "fabricPattern",
  k6: "planToSvg",
  S6: "planToPngBlob",
  Mw: "planBounds",
  // Traductions des messages du moteur (nl, en, ar ; le français est la langue source)
  xm: "LANG_INDEX",
  _6: "QC_LABELS",
  X3: "translateIssue",
  G3: "translateStrategy",
  Y3: "translateHoopSource",
  K3: "translateMachineNote",
  $3: "translateChartSource",
  // Registre d'essais machine et empreintes de référence
  Q3: "REGISTRY_FILES",
  J3: "REFERENCE_FINGERPRINTS_FILE",
  e6: "summarizeRegistry",
  Z3: "registryFileStatus",
  a6: "sha256Hex",
  // Chargement d'images dans le navigateur (canvas)
  q6: "MAX_IMAGE_PX",
  C6: "rasterizeImage",
  Iw: "loadImageUrl",
  tm: "imageToDataUrl",
  // Motifs de démonstration
  Ob: "DEMO_MOTIFS",
  U6: "DEMO_COLORS",
};

const INTERNAL = {
  Sm: "ByteWriter",
  km: "preparePesStitches",
  xw: "writePesEmbOne",
  Aw: "writePec",
  sf: "dstEncodeRecord",
  vb: "FORMAT_LIMITS",
};

const html = fs.readFileSync(SOURCE, "utf8");
const sourceHash = crypto.createHash("sha256").update(html).digest("hex");
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const moduleSrc = scripts.find((m) => m[1].includes("module"))?.[2];
if (!moduleSrc) throw new Error("module introuvable dans " + SOURCE);

const ast = acorn.parse(moduleSrc, { ecmaVersion: "latest", sourceType: "module" });
const owner = new Map(); // nom -> index de l'instruction
ast.body.forEach((node, i) => {
  const names = node.id ? [node.id.name] : (node.declarations ?? []).map((d) => d.id.name);
  names.forEach((n) => owner.set(n, i));
});
const declOf = (name) => {
  const node = ast.body[owner.get(name)];
  return node.type === "VariableDeclaration" ? node.declarations.find((d) => d.id.name === name) : node;
};

const need = new Set();
const stack = Object.keys(PUBLIC);
while (stack.length) {
  const name = stack.pop();
  if (need.has(name)) continue;
  if (!owner.has(name)) throw new Error("symbole introuvable : " + name);
  need.add(name);
  walk.full(declOf(name), (x) => {
    if (x.type === "Identifier" && owner.has(x.name) && !need.has(x.name)) stack.push(x.name);
  });
}

// Garde-fou : le moteur ne doit dépendre ni de React ni de pdf.js ni de l'application.
const appStart = owner.get("K6"); // composant App
for (const name of need) {
  const i = owner.get(name);
  if (i < 30 || i >= appStart) throw new Error(`dépendance hors moteur : ${name} (instruction ${i})`);
}

// Émission dans l'ordre d'origine, déclarateur par déclarateur.
let code = "";
ast.body.forEach((node) => {
  if (node.type === "VariableDeclaration") {
    const kept = node.declarations.filter((d) => need.has(d.id.name));
    if (!kept.length) return;
    code += `${node.kind} ${kept.map((d) => moduleSrc.slice(d.start, d.end)).join(",\n")};\n`;
  } else if (node.id && need.has(node.id.name)) {
    code += moduleSrc.slice(node.start, node.end) + "\n";
  }
});

// Renommage par portée.
const babelAst = parse(code, { sourceType: "module" });
const rename = { ...INTERNAL, ...PUBLIC };
traverse(babelAst, {
  Program(p) {
    for (const name of Object.keys(p.scope.bindings)) {
      const target = rename[name] ?? "m_" + name.replace(/\$/g, "S");
      if (target !== name) p.scope.rename(name, target);
    }
    p.stop();
  },
});
let out = generate(babelAst, { comments: false }).code;
out += `\nexport { ${Object.values(PUBLIC)
  .filter((v, i, a) => a.indexOf(v) === i)
  .join(", ")} };\n`;

const header = `// @ts-nocheck
// FICHIER GÉNÉRÉ par packages/engine/scripts/extract.mjs — ne pas modifier à la main.
// Source : legacy/vyra-studio-0.2/index.html (sha256 ${sourceHash}).
// Moteur de broderie VYRA v0.2.x extrait du build publié ; ${need.size} symboles.
// Intégrité contrôlée par test/reference.test.ts (empreintes du registre v0.2.0).
// Table de couleurs PEC : pyembroidery 1.5.1 (MIT).
`;
const formatted = await prettier.format(header + out, { parser: "babel", printWidth: 110 });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, formatted);
// Déclaration volontairement non typée : le seul contrat typé est la façade src/index.ts.
const names = [...new Set(Object.values(PUBLIC))];
fs.writeFileSync(
  OUT.replace(/\.js$/, ".d.ts"),
  "// FICHIER GÉNÉRÉ par packages/engine/scripts/extract.mjs. Contrat typé : src/index.ts.\n" +
    names.map((n) => `export declare const ${n}: any;`).join("\n") +
    "\n",
);
console.log(`engine.js : ${need.size} symboles, ${formatted.length} octets`);
