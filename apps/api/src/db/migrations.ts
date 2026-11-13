// Migrations SQL versionnées, appliquées dans l'ordre, chacune dans une transaction.
// Une migration appliquée n'est jamais modifiée : on en ajoute une nouvelle.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Db } from "./pool.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Map<string, string>(
    (await db.query("SELECT name, checksum FROM schema_migrations")).rows.map((r) => [r.name, r.checksum]),
  );
  // Verrou consultatif : deux instances qui démarrent ensemble n'appliquent jamais la même migration.
  const lock = await db.connect();
  await lock.query("SELECT pg_advisory_lock(7279431)");
  try {
    return await applyAll(db, done, log);
  } finally {
    await lock.query("SELECT pg_advisory_unlock(7279431)").catch(() => {});
    lock.release();
  }
}

async function applyAll(db: Db, done: Map<string, string>, log: (m: string) => void): Promise<string[]> {
  const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    const sum = crypto.createHash("sha256").update(sql).digest("hex");
    if (done.has(f)) {
      if (done.get(f) !== sum) throw new Error(`La migration ${f} a été modifiée après application.`);
      continue;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [f, sum]);
      await client.query("COMMIT");
      applied.push(f);
      log(`migration appliquée : ${f}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`Échec de la migration ${f} : ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

/** État des migrations : appliquées, en attente, modifiées après application (anomalie). */
export async function migrationStatus(db: Db): Promise<{ applied: string[]; pending: string[]; modified: string[] }> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Map<string, string>((await db.query("SELECT name, checksum FROM schema_migrations")).rows.map((r) => [r.name, r.checksum]));
  const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const out = { applied: [] as string[], pending: [] as string[], modified: [] as string[] };
  for (const f of files) {
    const sum = crypto.createHash("sha256").update(fs.readFileSync(path.join(DIR, f), "utf8")).digest("hex");
    if (!done.has(f)) out.pending.push(f);
    else if (done.get(f) !== sum) out.modified.push(f);
    else out.applied.push(f);
  }
  return out;
}
