// Sessions par cookie httpOnly. Le jeton brut ne quitte jamais le cookie ; la base
// ne connaît que son empreinte. Une session expirée ou un compte suspendu = déconnecté.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Db, Queryable } from "../db/pool.js";
import type { Config } from "../config.js";
import { newToken, tokenHash } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { hasRole, type Role } from "@vyra/shared";

export const SESSION_COOKIE = "vyra_session";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  locale: "fr" | "nl" | "en" | "ar";
  theme: "auto" | "light" | "dark";
  roles: string[];
  preferences: Record<string, unknown>;
  createdAt: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionHash: Buffer | null;
  }
  interface FastifyInstance {
    db: Db;
    cfg: Config;
    requireUser: (req: FastifyRequest) => SessionUser;
    requireRole: (req: FastifyRequest, role: Role) => SessionUser;
    startSession: (reply: FastifyReply, req: FastifyRequest, userId: string, q?: Queryable) => Promise<void>;
    endSession: (reply: FastifyReply, req: FastifyRequest) => Promise<void>;
  }
}

export const USER_COLUMNS = `u.id, u.email, u.display_name, u.email_verified_at, u.locale, u.theme, u.preferences, u.created_at,
  COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles r WHERE r.user_id = u.id), '{}') AS roles`;

export function toSessionUser(r: Record<string, any>): SessionUser {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    emailVerified: !!r.email_verified_at,
    locale: r.locale,
    theme: r.theme,
    roles: r.roles ?? [],
    preferences: r.preferences ?? {},
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export default fp(async function authPlugin(app: FastifyInstance) {
  const { db, cfg } = app;
  const maxAge = cfg.SESSION_DAYS * 24 * 3600;

  app.decorateRequest("user", null);
  app.decorateRequest("sessionHash", null);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || token.length > 200) return;
    const hash = tokenHash(token);
    const { rows } = await db.query(
      `SELECT ${USER_COLUMNS}, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
      [hash],
    );
    if (!rows[0]) return;
    req.user = toSessionUser(rows[0]);
    req.sessionHash = hash;
    // Session glissante, mise à jour au plus une fois par heure.
    if (Date.now() - new Date(rows[0].last_seen_at).getTime() > 3600_000) {
      await db.query(
        "UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE token_hash = $1",
        [hash, cfg.SESSION_DAYS],
      );
    }
  });

  app.decorate("requireUser", (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    return req.user;
  });

  app.decorate("requireRole", (req: FastifyRequest, role: Role) => {
    const u = app.requireUser(req);
    if (!hasRole(u.roles, role)) throw forbidden();
    return u;
  });

  app.decorate("startSession", async (reply: FastifyReply, req: FastifyRequest, userId: string, q: Queryable = db) => {
    const { token, hash } = newToken();
    await q.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
       VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
      [hash, userId, cfg.SESSION_DAYS, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 300)],
    );
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: cfg.secureCookies,
      maxAge,
    });
  });

  app.decorate("endSession", async (reply: FastifyReply, req: FastifyRequest) => {
    if (req.sessionHash) await db.query("DELETE FROM sessions WHERE token_hash = $1", [req.sessionHash]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
  });
});
