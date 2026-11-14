#!/usr/bin/env node
// Sauvegarde complète (lot H2) : base PostgreSQL (pg_dump, format custom, AVEC propriétaires et droits) + fichiers
// du stockage, avec un instantané de contrôle (propriétaires, droits, séquences, fonctions, contraintes, politiques,
// lignes et sommes de contrôle par table) et un manifeste d'empreintes SHA-256 vérifiés à la restauration.
//
// Usage : BACKUP_DATABASE_URL=<rôle vyra_backup> [STORAGE_DIR=… | STORAGE_DRIVER=s3 …] node scripts/backup.mjs <dossier>
// Rôle : vyra_backup uniquement (lecture de tout, aucune écriture, contournement de RLS indispensable à pg_dump).
// Cohérence : l'instantané de contrôle et pg_dump lisent le MÊME instantané de la base (pg_export_snapshot) ; le
// stockage est copié après la base (un objet sans ligne est inoffensif ; l'inverse serait un fichier perdu).
// Stockage S3 : chaque objet du préfixe est copié dans l'archive (versionnage du fournisseur recommandé en plus).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { snapshot } from "./db-control.mjs";

const url = process.env.BACKUP_DATABASE_URL;
const storage = process.env.STORAGE_DIR;
const out = process.argv[2];
if (!url || !out) {
  console.error("Usage : BACKUP_DATABASE_URL=<vyra_backup> [STORAGE_DIR=…] node scripts/backup.mjs <dossier>");
  process.exit(2);
}
const db = new pg.Client({ connectionString: url });
await db.connect();
const who = (await db.query("SELECT current_user AS u")).rows[0].u;
if (who !== "vyra_backup") {
  console.error(`Sauvegarde refusée : rôle « ${who} ». Seul vyra_backup sauvegarde (lecture seule, propriétaires et droits conservés).`);
  await db.end();
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.resolve(out, `vyra-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
// Un instantané exporté : contrôle et pg_dump voient exactement les mêmes données.
await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
const snap = (await db.query("SELECT pg_export_snapshot() AS s")).rows[0].s;
const control = await snapshot(async (text, params) => (await db.query(text, params)).rows);
execFileSync("pg_dump", ["--format=custom", "--snapshot", snap, "--file", path.join(dir, "base.dump"), url], { stdio: "inherit" });
await db.query("COMMIT");
await db.end();
fs.writeFileSync(path.join(dir, "controle.json"), JSON.stringify(control, null, 1));
if (process.env.STORAGE_DRIVER === "s3") {
  // Stockage S3 : chaque objet du préfixe est copié, puis archivé avec la base.
  const { s3Client, s3Prefix } = await import("./s3-env.mjs");
  const { ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = s3Client();
  const prefix = s3Prefix();
  const tmp = path.join(dir, "stockage");
  let token;
  let count = 0;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      const rel = o.Key.slice(prefix.length);
      const obj = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: o.Key }));
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), Buffer.from(await obj.Body.transformToByteArray()));
      count++;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync("tar", ["-czf", path.join(dir, "stockage.tar.gz"), "-C", tmp, "."], { stdio: "inherit" });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error(`${count} objet(s) S3 sauvegardé(s).`);
} else if (storage && fs.existsSync(storage)) execFileSync("tar", ["-czf", path.join(dir, "stockage.tar.gz"), "-C", storage, "."], { stdio: "inherit" });
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex");
const files = fs.readdirSync(dir).filter((f) => f !== "manifeste.json");
const manifest = { cree_le: new Date().toISOString(), outil: "vyra scripts/backup.mjs", fichiers: Object.fromEntries(files.map((f) => [f, sha(f)])) };
fs.writeFileSync(path.join(dir, "manifeste.json"), JSON.stringify(manifest, null, 2));
console.log(dir);
