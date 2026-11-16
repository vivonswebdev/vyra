#!/usr/bin/env node
// Restauration d'une sauvegarde produite par scripts/backup.mjs (lot H2).
//
// Base : UNIQUEMENT dans une base NEUVE, préparée par l'administrateur (scripts/db/roles.sql, CREATE DATABASE,
// scripts/db/database-setup.sql). Une base qui contient le moindre objet applicatif, dans n'importe quel schéma,
// est refusée : aucune restauration « par-dessus » (l'ancienne option --remplacer ne s'applique plus à la base).
// On restaure à côté, on contrôle, puis on bascule l'API ; l'ancienne base reste intacte jusque-là.
// Rôle : vyra_migrator, qui prend le rôle propriétaire (--role=vyra_owner) : objets à vyra_owner, droits
// identiques à la base source. Une seule transaction : en cas d'échec, rien n'est restauré.
// Contrôle : l'instantané de la sauvegarde (controle.json) est comparé à la base restaurée (propriétaires,
// droits, séquences, fonctions, contraintes, index, politiques, lignes et sommes de contrôle par table).
// Stockage : --remplacer autorise l'écriture dans un dossier ou un préfixe S3 non vide (objets ajoutés ou
// remplacés, jamais supprimés).
//
// Usage : RESTORE_DATABASE_URL=<vyra_migrator, base neuve> [STORAGE_DIR=… | STORAGE_DRIVER=s3 …]
//         node scripts/restore.mjs <dossier-de-sauvegarde> [--remplacer]
// Codes de sortie : 2 usage ou rôle, 3 sauvegarde altérée, 4 cible non vide, 5 contrôle après restauration en échec.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { compare, quoteName, snapshot, tableContents, userObjects } from "./db-control.mjs";

const url = process.env.RESTORE_DATABASE_URL;
const storage = process.env.STORAGE_DIR;
const dir = process.argv[2];
const replace = process.argv.includes("--remplacer");
if (!url || !dir) {
  console.error("Usage : RESTORE_DATABASE_URL=<vyra_migrator> [STORAGE_DIR=…] node scripts/restore.mjs <dossier> [--remplacer]");
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
if (!manifest.fichiers["controle.json"]) {
  console.error("Sauvegarde sans instantané de contrôle (antérieure au lot H2) : restauration refusée par ce script.");
  process.exit(3);
}
const expected = JSON.parse(fs.readFileSync(path.join(dir, "controle.json"), "utf8"));

const db = new pg.Client({ connectionString: url });
await db.connect();
const q = async (text, params) => (await db.query(text, params)).rows;
try {
  const [me] = await q("SELECT current_user AS u, to_regnamespace('vyra') IS NOT NULL AS has_vyra");
  if (me.u !== "vyra_migrator") {
    console.error(`Restauration refusée : rôle « ${me.u} ». Seul vyra_migrator restaure (en prenant le rôle vyra_owner).`);
    process.exit(2);
  }
  if (!me.has_vyra) {
    console.error("Base cible non préparée : schéma vyra absent (exécuter scripts/db/database-setup.sql).");
    process.exit(4);
  }
  const n = await userObjects(q);
  if (n > 0) {
    console.error(`La base cible contient déjà ${n} objet(s) : restauration uniquement dans une base neuve préparée. Aucune donnée n'a été modifiée.`);
    process.exit(4);
  }
} catch (e) {
  await db.end();
  throw e;
}

// Stockage cible vérifié AVANT toute écriture en base : un refus ne laisse jamais une base restaurée à moitié.
if (fs.existsSync(path.join(dir, "stockage.tar.gz")) && !replace) {
  let busy = false;
  if (process.env.STORAGE_DRIVER === "s3") {
    const { s3Client, s3Prefix } = await import("./s3-env.mjs");
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const r = await s3Client().send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: s3Prefix() || undefined, MaxKeys: 1 }));
    busy = (r.KeyCount ?? 0) > 0;
  } else if (storage && fs.existsSync(storage)) busy = fs.readdirSync(storage).length > 0;
  if (busy) {
    await db.end();
    console.error("Le stockage cible n'est pas vide. Relancez avec --remplacer (stockage seulement). Aucune donnée n'a été modifiée.");
    process.exit(4);
  }
}

// Le schéma vyra existe déjà (créé par l'administrateur) : l'entrée de création de l'archive est retirée.
const dump = path.join(dir, "base.dump");
const list = execFileSync("pg_restore", ["--list", dump], { encoding: "utf8" })
  .split("\n")
  .filter((l) => !/^\d+; \d+ \d+ SCHEMA - vyra /.test(l))
  .join("\n");
const listFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyra-restauration-")), "restauration.list");
fs.writeFileSync(listFile, list);
try {
  execFileSync("pg_restore", ["--exit-on-error", "--single-transaction", "--role=vyra_owner", "--use-list", listFile, "--dbname", url, dump], { stdio: "inherit" });
} finally {
  fs.rmSync(path.dirname(listFile), { recursive: true, force: true });
}

// Contrôle sous le rôle propriétaire, dans une transaction toujours ANNULÉE. Lot H5 : les tables à RLS forcée
// filtrent aussi leur propriétaire ; la structure (dont l'état « forcé ») est relevée d'abord, puis le forçage
// est levé le temps du comptage seulement (verrou exclusif tenu), et l'annulation le rétablit.
await q("BEGIN");
let actual;
try {
  await q("SET LOCAL ROLE vyra_owner");
  actual = await snapshot(q, { contents: false });
  for (const r of actual.relations.filter((x) => x.kind === "r" && x.force_rls)) await q(`ALTER TABLE ${quoteName(r.name)} NO FORCE ROW LEVEL SECURITY`);
  actual.tables = await tableContents(q, actual.relations);
} finally {
  await q("ROLLBACK");
}
const diffs = compare(expected, actual, { sequencesAtLeast: true });
await db.end();
if (diffs.length) {
  console.error(`Contrôle après restauration : ${diffs.length} différence(s). NE PAS basculer l'API sur cette base.`);
  for (const d of diffs.slice(0, 50)) console.error("  " + d);
  process.exit(5);
}
console.error("Base restaurée et contrôlée : propriétaires, droits, séquences, fonctions, contraintes, politiques et données identiques.");
if (fs.existsSync(path.join(dir, "stockage.tar.gz"))) {
  if (process.env.STORAGE_DRIVER === "s3") {
    const { s3Client, s3Prefix } = await import("./s3-env.mjs");
    const { ListObjectsV2Command, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = s3Client();
    const prefix = s3Prefix();
    const existing = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix || undefined, MaxKeys: 1 }));
    if ((existing.KeyCount ?? 0) > 0 && !replace) {
      console.error(`Le compartiment ${process.env.S3_BUCKET}/${prefix} n'est pas vide. Relancez avec --remplacer.`);
      process.exit(4);
    }
    const tmp = fs.mkdtempSync(path.join(dir, "restauration-"));
    execFileSync("tar", ["-xzf", path.join(dir, "stockage.tar.gz"), "-C", tmp], { stdio: "inherit" });
    const files = fs.readdirSync(tmp, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    for (const e of files) {
      const full = path.join(e.parentPath ?? e.path, e.name);
      const rel = path.relative(tmp, full).split(path.sep).join("/");
      await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: prefix + rel, Body: fs.readFileSync(full), ContentType: "application/octet-stream" }));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(`${files.length} objet(s) S3 restauré(s).`);
  } else {
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
}
console.log("Restauration terminée.");
