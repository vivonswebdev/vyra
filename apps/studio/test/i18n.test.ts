import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMON, missingKeys, type Dicts } from "../../../packages/ui/src/i18n.js";
import { STUDIO_DICTS } from "../src/i18n.js";
import { STITCH_TYPES, DEMO_MOTIFS } from "@vyra/engine";

const merged = Object.fromEntries((["fr", "nl", "en", "ar"] as const).map((l) => [l, { ...COMMON[l], ...STUDIO_DICTS[l] }])) as Dicts;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("traductions", () => {
  it("chaque clé existe dans les quatre langues", () => {
    expect(missingKeys(COMMON)).toEqual({ fr: [], nl: [], en: [], ar: [] });
    expect(missingKeys(STUDIO_DICTS)).toEqual({ fr: [], nl: [], en: [], ar: [] });
  });

  it("aucune traduction vide", () => {
    for (const [lang, d] of Object.entries(merged)) for (const [k, v] of Object.entries(d)) expect(v.trim(), `${lang}:${k}`).not.toBe("");
  });

  it("toutes les clés utilisées dans le code sont définies", () => {
    const files = [...sources(path.resolve(__dirname, "../src")), ...sources(path.resolve(__dirname, "../../../packages/ui/src"))];
    const used = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\("([a-zA-Z0-9_.-]+)"/g)) used.add(m[1]);
    // Clés construites dynamiquement
    STITCH_TYPES.forEach((s) => used.add("type." + s));
    DEMO_MOTIFS.forEach((m) => used.add("demo." + m));
    ["select", "nodes", "pan", "pen", "rect", "ellipse"].forEach((k) => used.add("tool." + k));
    ["error", "warning", "info"].forEach((k) => used.add("q." + k));
    ["pes", "pes6", "dst"].forEach((k) => used.add("ex." + k));
    ["thread", "directions", "density", "types"].forEach((k) => used.add("v." + k));
    ["simple", "expert"].forEach((k) => used.add("mode." + k));
    const missing = [...used].filter((k) => !k.endsWith(".") && !(k in merged.fr));
    expect(missing).toEqual([]);
  });
});
