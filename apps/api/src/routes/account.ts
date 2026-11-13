// Sécurité et données du compte : appareils connectés, double authentification (TOTP + codes de
// secours), export des données personnelles, suppression complète du compte.
import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { tx, type Queryable } from "../db/pool.js";
import { tokenHash, verifyPassword } from "../lib/crypto.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { SecretBox } from "../lib/secretbox.js";
import { newTotpSecret, otpauthUri, verifyTotp } from "../lib/totp.js";
import { zip } from "../lib/zip.js";
import { queueSecurityAlert } from "../lib/mailer.js";
import { servableStates } from "../lib/quarantine.js";
import { sessionCookieName } from "../plugins/auth.js";

const Code = z.string().trim().regex(/^\d{6}$/, { error: "Code à 6 chiffres attendu." });
const RecoveryCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, { error: "Code de secours invalide." });

export function describeDevice(ua: string | null): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Navigateur";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "système inconnu";
  return `${browser} · ${os}`;
}

function newRecoveryCodes(): { plain: string[]; hashes: Buffer[] } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const plain = Array.from({ length: 10 }, () => {
    const b = crypto.randomBytes(10);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return s.slice(0, 5) + "-" + s.slice(5);
  });
  return { plain, hashes: plain.map((c) => tokenHash(c)) };
}

/**
 * Vérifie le second facteur d'un utilisateur : code TOTP (anti-rejeu) ou code de secours (usage unique).
 * Renvoie true si l'utilisateur n'a pas activé la double authentification.
 */
export async function checkSecondFactor(q: Queryable, box: SecretBox, userId: string, input: { code?: string; recoveryCode?: string }): Promise<boolean> {
  const { rows } = await q.query("SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = $1", [userId]);
  const u = rows[0];
  if (!u?.totp_enabled_at) return true;
  if (input.code) {
    const step = verifyTotp(box.open(u.totp_secret_enc), input.code, { lastStep: u.totp_last_step == null ? null : Number(u.totp_last_step) });
    if (step == null) return false;
    await q.query("UPDATE users SET totp_last_step = $2 WHERE id = $1", [userId, step]);
    return true;
  }
  if (input.recoveryCode) {
    const r = await q.query(
      "UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id",
      [userId, tokenHash(input.recoveryCode.trim().toUpperCase())],
    );
    return (r.rowCount ?? 0) > 0;
  }
  return false;
}

export default async function accountRoutes(app: FastifyInstance) {
  const { db, cfg } = app;
  const box = new SecretBox(cfg.secretKey);
  const strict = { config: { rateLimit: { max: cfg.AUTH_RATE_LIMIT, timeWindow: "1 minute" } } };

  async function requirePassword(req: FastifyRequest, userId: string, password: string) {
    const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    if (!(await verifyPassword(password, rows[0].password_hash))) {
      await audit(db, { actorId: userId, action: "account.reauth_failed", subject: `user:${userId}`, ip: req.ip });
      throw badRequest("Mot de passe incorrect.");
    }
  }

  // ---------------------------------------------------------------- Appareils connectés

  app.get("/api/me/sessions", async (req) => {
    const u = app.requireUser(req);
    const { rows } = await db.query(
      `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent, token_hash = $2 AS current
         FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`,
      [u.id, req.sessionHash],
    );
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        device: describeDevice(r.user_agent),
        userAgent: r.user_agent,
        ip: r.ip,
        createdAt: new Date(r.created_at).toISOString(),
        lastSeenAt: new Date(r.last_seen_at).toISOString(),
        current: r.current,
      })),
    };
  });

  app.delete("/api/me/sessions/:id", async (req, reply) => {
    const u = app.requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { rows } = await db.query("DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING token_hash = $3 AS current", [id, u.id, req.sessionHash]);
    if (!rows[0]) throw notFound("Session introuvable.");
    await audit(db, { actorId: u.id, action: "account.session_revoked", subject: `user:${u.id}`, ip: req.ip, details: { session: id } });
    if (rows[0].current) reply.clearCookie(sessionCookieName(cfg.secureCookies), { path: "/", secure: cfg.secureCookies });
    return { ok: true, current: rows[0].current };
  });

  app.post("/api/me/sessions/revoke-others", async (req) => {
    const u = app.requireUser(req);
    const r = await db.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [u.id, req.sessionHash]);
    await audit(db, { actorId: u.id, action: "account.sessions_revoked", subject: `user:${u.id}`, ip: req.ip, details: { count: r.rowCount } });
    return { revoked: r.rowCount };
  });

  // ---------------------------------------------------------------- Double authentification

  app.get("/api/me/2fa", async (req) => {
    const u = app.requireUser(req);
    const { rows } = await db.query(
      `SELECT totp_enabled_at, (SELECT count(*)::int FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL) AS remaining
         FROM users WHERE id = $1`,
      [u.id],
    );
    return { enabled: !!rows[0].totp_enabled_at, enabledAt: rows[0].totp_enabled_at, recoveryCodesRemaining: rows[0].remaining };
  });

  app.post("/api/me/2fa/setup", strict, async (req) => {
    const u = app.requireUser(req);
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    await requirePassword(req, u.id, password);
    const secret = newTotpSecret();
    await db.query("UPDATE users SET totp_pending_enc = $2 WHERE id = $1", [u.id, box.seal(secret)]);
    const uri = otpauthUri(secret, u.email);
    return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
  });

  app.post("/api/me/2fa/enable", strict, async (req) => {
    const u = app.requireUser(req);
    const { code } = z.object({ code: Code }).parse(req.body);
    const codes = await tx(db, async (c) => {
      const { rows } = await c.query("SELECT totp_pending_enc, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE", [u.id]);
      if (rows[0].totp_enabled_at) throw badRequest("La double authentification est déjà active.");
      if (!rows[0].totp_pending_enc) throw badRequest("Commencez par la configuration (scanner le code).");
      const secret = box.open(rows[0].totp_pending_enc);
      const step = verifyTotp(secret, code);
      if (step == null) throw badRequest("Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.");
      await c.query(
        "UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1",
        [u.id, step],
      );
      const rc = newRecoveryCodes();
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [u.id]);
      for (const h of rc.hashes) await c.query("INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [u.id, h]);
      // Les autres appareils, ouverts sans second facteur, sont déconnectés.
      await c.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [u.id, req.sessionHash]);
      await audit(c, { actorId: u.id, action: "account.2fa_enabled", subject: `user:${u.id}`, ip: req.ip });
      await queueSecurityAlert(c, cfg, u, "2fa_enabled");
      return rc.plain;
    });
    return { enabled: true, recoveryCodes: codes };
  });

  app.post("/api/me/2fa/recovery-codes", strict, async (req) => {
    const u = app.requireUser(req);
    const input = z.object({ password: z.string().min(1).max(200), code: Code }).parse(req.body);
    await requirePassword(req, u.id, input.password);
    if (!(await checkSecondFactor(db, box, u.id, { code: input.code }))) throw badRequest("Code incorrect.");
    const rc = newRecoveryCodes();
    await tx(db, async (c) => {
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [u.id]);
      for (const h of rc.hashes) await c.query("INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [u.id, h]);
      await audit(c, { actorId: u.id, action: "account.2fa_recovery_regenerated", subject: `user:${u.id}`, ip: req.ip });
    });
    return { recoveryCodes: rc.plain };
  });

  app.post("/api/me/2fa/disable", strict, async (req) => {
    const u = app.requireUser(req);
    const input = z.object({ password: z.string().min(1).max(200), code: Code.optional(), recoveryCode: RecoveryCode.optional() }).parse(req.body);
    await requirePassword(req, u.id, input.password);
    if (!(await checkSecondFactor(db, box, u.id, input))) throw badRequest("Code incorrect.");
    await tx(db, async (c) => {
      await c.query("UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1", [u.id]);
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [u.id]);
      await audit(c, { actorId: u.id, action: "account.2fa_disabled", subject: `user:${u.id}`, ip: req.ip });
      await queueSecurityAlert(c, cfg, u, "2fa_disabled");
    });
    return { enabled: false };
  });

  // ---------------------------------------------------------------- Export des données personnelles

  app.get("/api/me/export", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const u = app.requireUser(req);
    const { rows: [user] } = await db.query(
      "SELECT id, email, display_name, email_verified_at, locale, theme, preferences, status, created_at, updated_at, totp_enabled_at FROM users WHERE id = $1",
      [u.id],
    );
    const sessions = (await db.query("SELECT created_at, last_seen_at, expires_at, ip, user_agent FROM sessions WHERE user_id = $1", [u.id])).rows;
    const auditRows = (await db.query("SELECT at, action, subject, ip, details FROM audit_log WHERE actor_id = $1 ORDER BY at", [u.id])).rows;
    const projects = (await db.query("SELECT id, name, design, settings, revision, created_at, updated_at, deleted_at FROM projects WHERE owner_id = $1 ORDER BY created_at", [u.id])).rows;
    const versions = (await db.query(
      "SELECT v.project_id, v.revision, v.label, v.name, v.design, v.settings, v.created_at FROM project_versions v JOIN projects p ON p.id = v.project_id WHERE p.owner_id = $1 ORDER BY v.id",
      [u.id],
    )).rows;
    const charts = (await db.query("SELECT brand, product, status, source, source_url, entries, created_at FROM thread_charts WHERE owner_id = $1", [u.id])).rows;
    // Les fichiers en quarantaine (non analysés ou en erreur d'analyse) ne sont jamais servis, export compris.
    const files = (await db.query(
      "SELECT id, kind, storage_key, filename, mime, size_bytes, sha256, created_at FROM files WHERE owner_id = $1 AND deleted_at IS NULL AND scan_status = ANY($2) ORDER BY created_at",
      [u.id, servableStates(app)],
    )).rows;

    const entries: { name: string; data: Uint8Array | string }[] = [
      {
        name: "LISEZMOI.txt",
        data:
          "Export des données de votre compte VYRA.\n\n" +
          "compte.json : profil, préférences, appareils connectés, journal de vos actions.\n" +
          "projets/ : chaque projet avec son document de broderie et son historique de versions.\n" +
          "nuanciers.json : nuanciers de fils importés.\n" +
          "fichiers/ : images sources et fichiers exportés (PES, DST).\n\n" +
          `Généré le ${new Date().toISOString()}.\n`,
      },
      {
        name: "compte.json",
        data: JSON.stringify({ utilisateur: { ...user, roles: u.roles, doubleAuthentification: !!user.totp_enabled_at, totp_enabled_at: undefined }, sessions, journal: auditRows }, null, 2),
      },
      { name: "nuanciers.json", data: JSON.stringify(charts, null, 2) },
    ];
    for (const p of projects) {
      const safe = p.name.replace(/[^\p{L}\p{N} ._-]+/gu, "_").slice(0, 60);
      entries.push({ name: `projets/${safe}-${p.id.slice(0, 8)}.json`, data: JSON.stringify({ ...p, versions: versions.filter((v) => v.project_id === p.id) }, null, 2) });
    }
    for (const f of files) {
      if (f.kind !== "source_image" && f.kind !== "export") continue;
      try {
        entries.push({ name: `fichiers/${f.kind === "export" ? "exports" : "sources"}/${f.id.slice(0, 8)}-${f.filename}`, data: await app.storage.get(f.storage_key) });
      } catch {
        entries.push({ name: `fichiers/MANQUANT-${f.id}.txt`, data: `Le fichier ${f.filename} (${f.sha256}) est introuvable dans le stockage.` });
      }
    }
    await audit(db, { actorId: u.id, action: "account.data_exported", subject: `user:${u.id}`, ip: req.ip, details: { projects: projects.length, files: files.length } });
    const archive = zip(entries);
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="vyra-donnees-${new Date().toISOString().slice(0, 10)}.zip"`)
      .header("cache-control", "private, no-store")
      .send(archive);
  });

  // ---------------------------------------------------------------- Suppression du compte

  app.delete("/api/me", strict, async (req, reply) => {
    const u = app.requireUser(req);
    const input = z
      .object({
        password: z.string().min(1).max(200),
        confirm: z.literal("SUPPRIMER", { error: "Saisissez SUPPRIMER pour confirmer." }),
        code: Code.optional(),
        recoveryCode: RecoveryCode.optional(),
      })
      .parse(req.body);
    await requirePassword(req, u.id, input.password);
    if (!(await checkSecondFactor(db, box, u.id, input))) throw new HttpError(400, "mfa_required", "Code de double authentification requis ou incorrect.");
    const keys = await tx(db, async (c) => {
      const { rows } = await c.query("SELECT storage_key FROM files WHERE owner_id = $1", [u.id]);
      // Les e-mails en file contiennent des liens personnels : supprimés avec le compte.
      await c.query("DELETE FROM email_outbox WHERE to_email = $1", [u.email]);
      // Le journal d'audit conserve la trace anonyme des actions (actor_id passe à NULL par la clé étrangère).
      await c.query("UPDATE audit_log SET ip = NULL, details = '{}'::jsonb WHERE actor_id = $1", [u.id]);
      await c.query("DELETE FROM users WHERE id = $1", [u.id]);
      await audit(c, { action: "account.deleted", subject: `user:${u.id}`, details: { files: rows.length } });
      // Confirmation à l'adresse du compte supprimé (seule donnée conservée : cet e-mail en file, sans lien personnel).
      await queueSecurityAlert(c, cfg, u, "account_deleted");
      return rows.map((r) => r.storage_key as string);
    });
    let removed = 0;
    for (const k of keys) {
      try {
        await app.storage.delete(k);
        removed++;
      } catch (e) {
        req.log.error({ key: k, err: e }, "fichier non supprimé du stockage");
      }
    }
    reply.clearCookie(sessionCookieName(cfg.secureCookies), { path: "/", secure: cfg.secureCookies });
    return { deleted: true, filesRemoved: removed };
  });
}
