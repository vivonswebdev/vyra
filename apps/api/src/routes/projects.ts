// Projets VYRA Studio : création, liste, ouverture, enregistrement (contrôle de révision),
// historique des versions et restauration, corbeille, duplication, image source, exports machine.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ExportInput, ProjectCreateInput, ProjectUpdateInput, type ExportDTO, type ProjectDTO, type ProjectSummaryDTO } from "@vyra/shared";
import { EXPORT_FORMATS, safeFileName, type PlanStats, type QualityIssue, type QualityReport } from "@vyra/engine";
import { tx, type Queryable } from "../db/pool.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { newStorageKey } from "../lib/storage.js";
import { sha256Hex } from "../lib/crypto.js";
import { sniffImage } from "../lib/sniff.js";
import { quarantineAndScan, servableStates } from "../lib/quarantine.js";

const AUTO_SNAPSHOT_MINUTES = 10;
const KEEP_AUTO_SNAPSHOTS = 50;
const Id = z.object({ id: z.uuid() });

function stats(design: any): ProjectSummaryDTO["stats"] {
  if (!design) return null;
  return {
    objects: design.objects?.length ?? 0,
    colors: design.threads?.length ?? 0,
    widthMm: Math.round((design.widthMm ?? 0) * 10) / 10,
    heightMm: Math.round((design.heightMm ?? 0) * 10) / 10,
  };
}

function summary(r: any): ProjectSummaryDTO {
  return {
    id: r.id,
    name: r.name,
    revision: r.revision,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    hasDesign: !!r.has_design,
    stats: r.stats ?? null,
    thumbnailUrl: r.has_design ? `/api/projects/${r.id}/thumbnail.svg?rev=${r.revision}` : null,
  };
}

const SUMMARY_COLUMNS = `id, name, revision, created_at, updated_at, deleted_at, design IS NOT NULL AS has_design,
  CASE WHEN design IS NULL THEN NULL ELSE jsonb_build_object(
    'objects', jsonb_array_length(design->'objects'), 'colors', jsonb_array_length(design->'threads'),
    'widthMm', round((design->>'widthMm')::numeric, 1), 'heightMm', round((design->>'heightMm')::numeric, 1)) END AS stats`;

export default async function projectRoutes(app: FastifyInstance) {
  const { db } = app;
  const storage = app.storage;

  async function own(q: Queryable, userId: string, id: string, opts: { trashed?: boolean; lock?: boolean } = {}) {
    const { rows } = await q.query(
      `SELECT * FROM projects WHERE id = $1 AND owner_id = $2 AND (deleted_at IS ${opts.trashed ? "NOT NULL" : "NULL"})${opts.lock ? " FOR UPDATE" : ""}`,
      [id, userId],
    );
    if (!rows[0]) throw notFound("Projet introuvable.");
    return rows[0];
  }

  const full = (r: any): ProjectDTO => ({
    ...summary({ ...r, has_design: r.design != null, stats: stats(r.design) }),
    design: r.design,
    settings: r.settings ?? {},
  });

  async function snapshot(q: Queryable, p: any, userId: string, label: string | null) {
    await q.query(
      "INSERT INTO project_versions (project_id, revision, label, name, design, settings, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [p.id, p.revision, label, p.name, p.design == null ? null : JSON.stringify(p.design), JSON.stringify(p.settings ?? {}), userId],
    );
    // Les points automatiques au-delà des 50 derniers sont purgés ; les points nommés sont conservés.
    await q.query(
      `DELETE FROM project_versions WHERE project_id = $1 AND label IS NULL AND id NOT IN (
         SELECT id FROM project_versions WHERE project_id = $1 AND label IS NULL ORDER BY id DESC LIMIT $2)`,
      [p.id, KEEP_AUTO_SNAPSHOTS],
    );
  }

  app.get("/api/projects", async (req) => {
    const u = app.requireUser(req);
    const trash = (req.query as any)?.trash === "1";
    const { rows } = await db.query(
      `SELECT ${SUMMARY_COLUMNS} FROM projects WHERE owner_id = $1 AND deleted_at IS ${trash ? "NOT NULL" : "NULL"}
       ORDER BY ${trash ? "deleted_at" : "updated_at"} DESC LIMIT 500`,
      [u.id],
    );
    return { projects: rows.map(summary) };
  });

  app.post("/api/projects", async (req, reply) => {
    const u = app.requireUser(req);
    const input = ProjectCreateInput.parse(req.body);
    const p = await tx(db, async (c) => {
      const { rows } = await c.query(
        "INSERT INTO projects (owner_id, name, design, settings, revision) VALUES ($1,$2,$3,$4,1) RETURNING *",
        [u.id, input.name, input.design == null ? null : JSON.stringify(input.design), JSON.stringify(input.settings ?? {})],
      );
      await snapshot(c, rows[0], u.id, "Création");
      return rows[0];
    });
    reply.code(201);
    return { project: full(p) };
  });

  app.get("/api/projects/:id", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    return { project: full(await own(db, u.id, id)) };
  });

  app.patch("/api/projects/:id", { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const input = ProjectUpdateInput.parse(req.body);
    const p = await tx(db, async (c) => {
      const cur = await own(c, u.id, id, { lock: true });
      if (cur.revision !== input.baseRevision)
        throw conflict("Ce projet a été modifié ailleurs (autre onglet ou appareil). Rechargez-le avant d'enregistrer.", {
          currentRevision: cur.revision,
        });
      const { rows } = await c.query(
        `UPDATE projects SET
           name = COALESCE($3, name),
           design = CASE WHEN $4::boolean THEN $5::jsonb ELSE design END,
           settings = CASE WHEN $6::jsonb IS NULL THEN settings ELSE $6::jsonb END,
           revision = revision + 1, updated_at = now()
         WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [
          id,
          u.id,
          input.name ?? null,
          input.design !== undefined,
          input.design == null ? null : JSON.stringify(input.design),
          input.settings ? JSON.stringify(input.settings) : null,
        ],
      );
      const next = rows[0];
      const last = await c.query("SELECT created_at FROM project_versions WHERE project_id = $1 ORDER BY id DESC LIMIT 1", [id]);
      const stale = !last.rows[0] || Date.now() - new Date(last.rows[0].created_at).getTime() > AUTO_SNAPSHOT_MINUTES * 60_000;
      if (input.snapshot || stale) await snapshot(c, next, u.id, input.snapshot ? (input.snapshotLabel || "Version enregistrée") : null);
      return next;
    });
    return { project: full(p) };
  });

  app.post("/api/projects/:id/duplicate", async (req, reply) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const p = await tx(db, async (c) => {
      const src = await own(c, u.id, id);
      const { rows } = await c.query(
        "INSERT INTO projects (owner_id, name, design, settings, revision) VALUES ($1,$2,$3,$4,1) RETURNING *",
        [u.id, (src.name + " (copie)").slice(0, 120), src.design == null ? null : JSON.stringify(src.design), JSON.stringify(src.settings)],
      );
      await snapshot(c, rows[0], u.id, "Copie de « " + src.name.slice(0, 80) + " »");
      return rows[0];
    });
    reply.code(201);
    return { project: full(p) };
  });

  // Corbeille : la suppression est réversible ; la suppression définitive ne se fait que depuis la corbeille.
  app.delete("/api/projects/:id", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    await own(db, u.id, id);
    await db.query("UPDATE projects SET deleted_at = now() WHERE id = $1", [id]);
    await audit(db, { actorId: u.id, action: "project.trashed", subject: `project:${id}`, ip: req.ip });
    return { ok: true };
  });

  app.post("/api/projects/:id/restore", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    await own(db, u.id, id, { trashed: true });
    const { rows } = await db.query("UPDATE projects SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *", [id]);
    return { project: full(rows[0]) };
  });

  app.delete("/api/projects/:id/permanent", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const body = z.object({ confirmName: z.string() }).parse(req.body ?? {});
    const keys = await tx(db, async (c) => {
      const p = await own(c, u.id, id, { trashed: true, lock: true });
      if (body.confirmName !== p.name) throw badRequest("Le nom saisi ne correspond pas au projet.");
      const { rows } = await c.query(
        `UPDATE files SET deleted_at = now() WHERE owner_id = $2 AND deleted_at IS NULL AND id IN (
           SELECT file_id FROM project_exports WHERE project_id = $1 UNION SELECT file_id FROM project_files WHERE project_id = $1)
         RETURNING storage_key`,
        [id, u.id],
      );
      await c.query("DELETE FROM projects WHERE id = $1", [id]);
      await audit(c, { actorId: u.id, action: "project.deleted_permanently", subject: `project:${id}`, ip: req.ip, details: { name: p.name, files: rows.length } });
      return rows.map((r) => r.storage_key as string);
    });
    for (const k of keys) await storage.delete(k).catch(() => {});
    return { ok: true, filesRemoved: keys.length };
  });

  // ---------------------------------------------------------------- Historique

  app.get("/api/projects/:id/versions", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    await own(db, u.id, id);
    const { rows } = await db.query(
      "SELECT id, revision, label, created_at FROM project_versions WHERE project_id = $1 ORDER BY id DESC LIMIT 200",
      [id],
    );
    return { versions: rows.map((r) => ({ id: String(r.id), revision: r.revision, label: r.label, createdAt: new Date(r.created_at).toISOString() })) };
  });

  app.post("/api/projects/:id/versions/:versionId/restore", async (req) => {
    const u = app.requireUser(req);
    const { id, versionId } = z.object({ id: z.uuid(), versionId: z.coerce.number().int().positive() }).parse(req.params);
    const p = await tx(db, async (c) => {
      await own(c, u.id, id, { lock: true });
      const { rows: v } = await c.query("SELECT * FROM project_versions WHERE id = $1 AND project_id = $2", [versionId, id]);
      if (!v[0]) throw notFound("Version introuvable.");
      const { rows } = await c.query(
        "UPDATE projects SET design = $2, settings = $3, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *",
        [id, v[0].design == null ? null : JSON.stringify(v[0].design), JSON.stringify(v[0].settings)],
      );
      await snapshot(c, rows[0], u.id, `Restauration de la révision ${v[0].revision}`);
      return rows[0];
    });
    return { project: full(p) };
  });

  // ---------------------------------------------------------------- Miniature (calculée par le serveur)

  app.get("/api/projects/:id/thumbnail.svg", async (req, reply) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const p = await own(db, u.id, id);
    if (!p.design) throw notFound("Aucun motif dans ce projet.");
    let svg: string = p.thumbnail_svg;
    if (p.thumbnail_revision !== p.revision || !svg) {
      svg = (await app.engine.run<{ svg: string }>("thumbnail", { design: p.design, name: p.name })).svg;
      await db.query("UPDATE projects SET thumbnail_svg = $2, thumbnail_revision = $3 WHERE id = $1", [id, svg, p.revision]);
    }
    reply
      .header("content-type", "image/svg+xml; charset=utf-8")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .header("cache-control", "private, max-age=3600");
    return svg;
  });

  // ---------------------------------------------------------------- Image source

  app.post("/api/projects/:id/source", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    await own(db, u.id, id);
    const part = await req.file({ limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
    if (!part) throw badRequest("Aucun fichier reçu.");
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw badRequest("Fichier trop volumineux (20 Mo au plus).");
    const kind = sniffImage(bytes, part.filename);
    if (!kind) throw badRequest("Format refusé : PNG, JPG, WEBP, BMP, SVG ou PDF uniquement.");
    // Quarantaine puis analyse antivirus : le fichier n'est rattaché au projet que s'il est sain.
    const file = await quarantineAndScan(app, db, {
      ownerId: u.id,
      kind: "source_image",
      prefix: "sources",
      ext: kind.ext,
      filename: cleanName(part.filename),
      mime: kind.mime,
      bytes,
      sha256: sha256Hex(bytes),
      ip: req.ip,
    });
    await db.query("INSERT INTO project_files (project_id, file_id, role) VALUES ($1,$2,'source')", [id, file.id]);
    return { file: { id: file.id, kind: "source_image", filename: file.filename, mime: file.mime, size: Number(file.size_bytes), sha256: file.sha256, createdAt: new Date(file.created_at).toISOString(), scanStatus: file.scan_status } };
  });

  // ---------------------------------------------------------------- Exports machine (moteur exécuté par le serveur)

  app.post("/api/projects/:id/exports", async (req, reply) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const { format } = ExportInput.parse(req.body);
    const p = await own(db, u.id, id);
    if (!p.design) throw badRequest("Le projet ne contient pas encore de motif.");
    const settings = p.settings ?? {};
    const r = await app.engine.run<{ blocked: boolean; bytes?: Uint8Array; stats: PlanStats; qc: QualityReport; issues?: QualityIssue[] }>("export", {
      design: p.design,
      format,
      label: p.name,
      machineId: settings.machineId,
      hoopId: settings.hoopId,
    });
    if (r.blocked) throw new HttpError(422, "export_blocked", "Export bloqué par le contrôle qualité.", { issues: r.issues });
    const bytes = new Uint8Array(r.bytes!);
    const filename = safeFileName(p.name) + EXPORT_FORMATS[format].ext;
    const analysis = { stats: r.stats, qc: r.qc };
    const key = newStorageKey("exports", "." + (format === "dst" ? "dst" : "pes"));
    await storage.put(key, bytes);
    const dto = await tx(db, async (c) => {
      const { rows: f } = await c.query(
        `INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status)
         VALUES ($1,'export',$2,$3,'application/octet-stream',$4,$5,'not_required') RETURNING id`,
        [u.id, key, filename, bytes.length, sha256Hex(bytes)],
      );
      const { rows } = await c.query(
        `INSERT INTO project_exports (project_id, file_id, format, revision, machine_id, hoop_id, stats, qc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [id, f[0].id, format, p.revision, settings.machineId ?? null, settings.hoopId ?? null, JSON.stringify(analysis.stats), JSON.stringify(analysis.qc)],
      );
      return exportDTO({ ...rows[0], format, filename, size_bytes: bytes.length, sha256: sha256Hex(bytes), revision: p.revision, stats: analysis.stats });
    });
    reply.code(201);
    return { export: dto };
  });

  app.get("/api/projects/:id/exports", async (req) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    await own(db, u.id, id);
    const { rows } = await db.query(
      `SELECT e.id, e.format, e.revision, e.stats, e.created_at, f.filename, f.size_bytes, f.sha256
         FROM project_exports e JOIN files f ON f.id = e.file_id WHERE e.project_id = $1 AND f.deleted_at IS NULL
        ORDER BY e.created_at DESC LIMIT 100`,
      [id],
    );
    return { exports: rows.map(exportDTO) };
  });

  app.get("/api/exports/:id/download", async (req, reply) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const { rows } = await db.query(
      `SELECT f.storage_key, f.filename FROM project_exports e JOIN files f ON f.id = e.file_id JOIN projects p ON p.id = e.project_id
        WHERE e.id = $1 AND p.owner_id = $2 AND f.deleted_at IS NULL`,
      [id, u.id],
    );
    if (!rows[0]) throw notFound("Export introuvable.");
    return deliver(app, reply, rows[0].storage_key, rows[0].filename, "application/octet-stream");
  });

  app.get("/api/files/:id", async (req, reply) => {
    const u = app.requireUser(req);
    const { id } = Id.parse(req.params);
    const { rows } = await db.query(
      "SELECT storage_key, filename, mime FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL AND kind = 'source_image' AND scan_status = ANY($3)",
      [id, u.id, servableStates(app)],
    );
    if (!rows[0]) throw notFound("Fichier introuvable.");
    return deliver(app, reply, rows[0].storage_key, rows[0].filename, rows[0].mime);
  });
}

function exportDTO(r: any): ExportDTO {
  const s = r.stats ?? {};
  return {
    id: r.id,
    format: r.format,
    filename: r.filename,
    size: Number(r.size_bytes),
    sha256: r.sha256,
    revision: r.revision,
    stats: { stitches: s.stitches, colorChanges: s.colorChanges, trims: s.trims, widthMm: s.widthMm, heightMm: s.heightMm },
    createdAt: new Date(r.created_at).toISOString(),
    downloadUrl: `/api/exports/${r.id}/download`,
  };
}

export function cleanName(name: string): string {
  return (name || "fichier").replace(/[\\/\0\r\n"]/g, "_").slice(0, 160);
}

/**
 * Diffusion d'un fichier dont l'accès vient d'être vérifié : par l'API, ou par une URL S3 temporaire
 * (redirection 302, validité S3_PRESIGN_TTL_SECONDS) si l'option est activée.
 */
export async function deliver(app: FastifyInstance, reply: any, key: string, filename: string, mime: string) {
  if (app.cfg.S3_PRESIGNED_DOWNLOADS && app.storage.presignGet) {
    const url = await app.storage.presignGet(key, { expiresInSeconds: app.cfg.S3_PRESIGN_TTL_SECONDS, filename });
    return reply.header("cache-control", "private, no-store").redirect(url, 302);
  }
  return sendFile(reply, await app.storage.get(key), filename, mime);
}

export function sendFile(reply: any, bytes: Buffer, filename: string, mime: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return reply
    .header("content-type", mime)
    .header("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .header("content-security-policy", "default-src 'none'; sandbox")
    .header("cache-control", "private, no-store")
    .send(bytes);
}
