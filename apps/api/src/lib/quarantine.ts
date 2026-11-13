// Quarantaine des fichiers déposés : écrits sous « quarantaine/ », analysés, puis déplacés vers leur
// emplacement définitif s'ils sont sains. Un fichier infecté est effacé ; en cas d'erreur d'analyse,
// il reste en quarantaine (jamais servi) et l'utilisateur est invité à réessayer.
import type { FastifyInstance } from "fastify";
import type { Queryable } from "../db/pool.js";
import { audit } from "./audit.js";
import { HttpError } from "./errors.js";
import { newStorageKey } from "./storage.js";

/** États qui autorisent la diffusion d'un fichier. « unscanned » : développement sans antivirus seulement. */
export function servableStates(app: FastifyInstance): string[] {
  return app.cfg.FILE_SCAN === "off" && !app.cfg.isProd ? ["clean", "not_required", "unscanned"] : ["clean", "not_required"];
}

export async function quarantineAndScan(
  app: FastifyInstance,
  q: Queryable,
  file: { ownerId: string; kind: string; prefix: string; ext: string; filename: string; mime: string; bytes: Uint8Array; sha256: string; ip?: string },
): Promise<{ id: string; filename: string; mime: string; size_bytes: number; sha256: string; created_at: string; scan_status: string }> {
  const qkey = newStorageKey("quarantaine", file.ext);
  await app.storage.put(qkey, file.bytes);
  const { rows } = await q.query(
    `INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id`,
    [file.ownerId, file.kind, qkey, file.filename, file.mime, file.bytes.length, file.sha256],
  );
  const id = rows[0].id as string;

  if (app.cfg.FILE_SCAN === "off") {
    if (app.cfg.isProd) throw new HttpError(503, "scan_unavailable", "Analyse antivirus indisponible.");
    const key = newStorageKey(file.prefix, file.ext);
    await app.storage.put(key, file.bytes);
    await app.storage.delete(qkey);
    const r = await q.query("UPDATE files SET storage_key = $2, scan_status = 'unscanned', scan_engine = 'aucun' WHERE id = $1 RETURNING *", [id, key]);
    return r.rows[0];
  }

  const t0 = Date.now();
  const v = await app.scanner.scan(file.bytes);
  const ms = Date.now() - t0;
  if (v.verdict === "clean") {
    const key = newStorageKey(file.prefix, file.ext);
    await app.storage.put(key, file.bytes);
    await app.storage.delete(qkey);
    const r = await q.query(
      "UPDATE files SET storage_key = $2, scan_status = 'clean', scan_engine = $3, scanned_at = now() WHERE id = $1 RETURNING *",
      [id, key, app.scanner.engine],
    );
    app.log.info({ file: id, ms, engine: app.scanner.engine }, "fichier analysé : sain");
    return r.rows[0];
  }
  if (v.verdict === "infected") {
    await app.storage.delete(qkey);
    await app.db.query("UPDATE files SET scan_status = 'infected', scan_detail = $2, scan_engine = $3, scanned_at = now(), deleted_at = now() WHERE id = $1", [
      id,
      v.signature,
      app.scanner.engine,
    ]);
    await audit(app.db, { actorId: file.ownerId, action: "file.infected", subject: `file:${id}`, ip: file.ip, details: { signature: v.signature, filename: file.filename, sha256: file.sha256 } });
    app.log.warn({ file: id, signature: v.signature }, "fichier infecté refusé");
    throw new HttpError(422, "file_infected", "Fichier refusé : l'analyse antivirus a détecté une menace.", { signature: v.signature });
  }
  await app.db.query("UPDATE files SET scan_status = 'error', scan_detail = $2, scan_engine = $3, scanned_at = now() WHERE id = $1", [id, v.detail, app.scanner.engine]);
  await audit(app.db, { actorId: file.ownerId, action: "file.scan_error", subject: `file:${id}`, ip: file.ip, details: { detail: v.detail } });
  app.log.error({ file: id, detail: v.detail }, "analyse antivirus impossible : fichier conservé en quarantaine");
  throw new HttpError(503, "scan_unavailable", "Analyse antivirus momentanément indisponible : le fichier est gardé en quarantaine et n'est pas utilisé. Réessayez dans quelques minutes.");
}

/** Analyse des fichiers jamais analysés (antérieurs au lot 3.1) quand un antivirus est configuré. */
export async function rescanUnscanned(app: FastifyInstance, limit = 50): Promise<{ clean: number; infected: number; errors: number }> {
  const out = { clean: 0, infected: 0, errors: 0 };
  if (app.cfg.FILE_SCAN === "off") return out;
  const { rows } = await app.db.query("SELECT id, owner_id, storage_key, filename FROM files WHERE scan_status = 'unscanned' AND deleted_at IS NULL LIMIT $1", [limit]);
  for (const f of rows) {
    let bytes: Buffer;
    try {
      bytes = await app.storage.get(f.storage_key);
    } catch {
      out.errors++;
      continue;
    }
    const v = await app.scanner.scan(bytes);
    if (v.verdict === "clean") {
      await app.db.query("UPDATE files SET scan_status = 'clean', scan_engine = $2, scanned_at = now() WHERE id = $1", [f.id, app.scanner.engine]);
      out.clean++;
    } else if (v.verdict === "infected") {
      await app.storage.delete(f.storage_key).catch(() => {});
      await app.db.query("UPDATE files SET scan_status = 'infected', scan_detail = $2, scanned_at = now(), deleted_at = now() WHERE id = $1", [f.id, v.signature]);
      await audit(app.db, { actorId: f.owner_id, action: "file.infected", subject: `file:${f.id}`, details: { signature: v.signature, rescan: true } });
      out.infected++;
    } else out.errors++;
  }
  return out;
}
