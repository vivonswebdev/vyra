// Gel du moteur v0.2.0 : moteur extrait, build d'origine, registres et outils de référence
// ne doivent jamais changer. Toute évolution passe par une décision explicite et documentée.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex");
const manifest = fs
  .readFileSync(path.join(ROOT, "packages/engine/FROZEN.sha256"), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [hash, file] = l.split(/\s+/);
    return { hash, file };
  });

describe("gel du moteur v0.2.0", () => {
  it("le manifeste couvre le moteur, le build d'origine, les registres, les motifs et les outils", () => {
    const files = manifest.map((m) => m.file);
    for (const f of [
      "packages/engine/src/generated/engine.js",
      "legacy/vyra-studio-0.2/index.html",
      "packages/engine/fixtures/empreintes-reference-v0.2.0.sha256",
      "packages/engine/fixtures/xe1-essais.json",
      "packages/engine/scripts/extract.mjs",
    ])
      expect(files).toContain(f);
    expect(files.filter((f) => f.endsWith(".png")).length).toBe(24);
  });

  for (const { hash, file } of manifest) {
    it(`inchangé : ${file}`, () => expect(sha(file)).toBe(hash));
  }

  it("les copies des registres et des motifs sont identiques aux originaux du build", () => {
    expect(sha("packages/engine/fixtures/empreintes-reference-v0.2.0.sha256")).toBe(sha("legacy/vyra-studio-0.2/registre/empreintes-reference-v0.2.0.sha256"));
    expect(sha("packages/engine/fixtures/xe1-essais.json")).toBe(sha("legacy/vyra-studio-0.2/registre/xe1-essais.json"));
    for (const f of fs.readdirSync(path.join(ROOT, "legacy/vyra-studio-0.2/motifs")))
      expect(sha(`packages/engine/fixtures/motifs/${f}`)).toBe(sha(`legacy/vyra-studio-0.2/motifs/${f}`));
  });

  it("le moteur extrait se régénère à l'identique depuis le build d'origine", () => {
    const target = path.join(ROOT, "packages/engine/src/generated/engine.js");
    const before = fs.readFileSync(target);
    try {
      execFileSync(process.execPath, [path.join(ROOT, "packages/engine/scripts/extract.mjs")], { stdio: "pipe" });
      expect(crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")).toBe(crypto.createHash("sha256").update(before).digest("hex"));
    } finally {
      fs.writeFileSync(target, before);
    }
  }, 120_000);
});
