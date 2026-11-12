#!/usr/bin/env node
// Restauration d'une sauvegarde produite par scripts/backup.mjs.
// Opération destructive pour la cible : elle refuse une base ou un dossier de stockage non vides,
// sauf option explicite --remplacer. Les empreintes du manifeste sont vérifiées avant toute écriture.
// Usage : DATABASE_URL=<cible> STORAGE_DIR=<cible> node scripts/restore.mjs <dossier-de-sauvegarde> [--remplacer]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const url = process.env.DATABASE_URL;
const storage = process.env.STORAGE_DIR;
const dir = process.argv[2];
const replace = process.argv.includes("--remplacer");
if (!url || !dir) {
  console.error("Usage : DATABASE_URL=… [STORAGE_DIR=…] node scripts/restore.mjs <dossier> [--remplacer]");
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifeste.json"), "utf8"));
for (const [f, h] of Object.entries(manifest.fichiers)) {
  const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex");
  if (got !== h) {
    console.error(`Sauvegarde altérée : ${f} (empreinte attendue ${h}, obtenue ${got}). Restauration annulée.`);
    process.exit(3);
  }
}
const tables = execFileSync("psql", [url, "-tAc", "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"], { encoding: "utf8" }).trim();
if (Number(tables) > 0 && !replace) {
  console.error(`La base cible contient déjà ${tables} table(s). Relancez avec --remplacer pour l'écraser.`);
  process.exit(4);
}
execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", url, path.join(dir, "base.dump")], { stdio: "inherit" });
if (fs.existsSync(path.join(dir, "stockage.tar.gz"))) {
  if (!storage) {
    console.error("STORAGE_DIR est requis pour restaurer les fichiers.");
    process.exit(2);
  }
  fs.mkdirSync(storage, { recursive: true });
  if (fs.readdirSync(storage).length && !replace) {
    console.error(`Le dossier de stockage ${storage} n'est pas vide. Relancez avec --remplacer.`);
    process.exit(4);
  }
  execFileSync("tar", ["-xzf", path.join(dir, "stockage.tar.gz"), "-C", storage], { stdio: "inherit" });
}
console.log("Restauration terminée.");
