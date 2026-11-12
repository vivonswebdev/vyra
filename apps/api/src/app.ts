import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/pool.js";
import { HttpError } from "./lib/errors.js";
import { LocalStorage, type Storage } from "./lib/storage.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import devRoutes from "./routes/dev.js";

declare module "fastify" {
  interface FastifyInstance {
    storage: Storage;
  }
}

export interface AppDeps {
  cfg: Config;
  db: Db;
  storage?: Storage;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Routes appelées par des services externes, authentifiées par signature et non par cookie. */
const CSRF_EXEMPT = [/^\/api\/webhooks\//];

export async function buildApp({ cfg, db, storage }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.LOG_LEVEL === "silent" ? false : { level: cfg.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate("db", db);
  app.decorate("cfg", cfg);
  app.decorate("storage", storage ?? new LocalStorage(cfg.STORAGE_DIR));

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  await app.register(multipart);

  // Protection CSRF : toute requête d'écriture doit porter l'en-tête x-vyra-client (impossible à
  // ajouter depuis un autre site sans autorisation CORS, que l'API n'accorde pas) et, si le
  // navigateur envoie Origin, provenir de l'origine publique de VYRA.
  const publicOrigin = new URL(cfg.PUBLIC_URL).origin;
  app.addHook("onRequest", async (req) => {
    if (!MUTATING.has(req.method) || !req.url.startsWith("/api/")) return;
    if (CSRF_EXEMPT.some((r) => r.test(req.url))) return;
    if (req.headers["x-vyra-client"] !== "web") throw new HttpError(403, "csrf", "Requête refusée (en-tête client manquant).");
    const origin = req.headers.origin;
    if (origin && origin !== publicOrigin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)
      throw new HttpError(403, "csrf", "Requête refusée (origine non autorisée).");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "validation",
          message: err.issues[0]?.message ?? "Données invalides.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) {
      const message = e.statusCode === 429 ? "Trop de requêtes. Patientez un instant." : e.statusCode === 413 ? "Contenu trop volumineux." : e.message;
      return reply.code(e.statusCode).send({ error: { code: e.code ?? "error", message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: "internal", message: "Erreur interne. L'incident est journalisé." } });
  });

  await app.register(authPlugin);

  app.get("/api/health", async () => {
    await db.query("SELECT 1");
    return { ok: true, service: "vyra-api", version: "0.3.0", time: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(projectRoutes);
  if (!cfg.isProd) await app.register(devRoutes);

  // Les liens des e-mails pointent vers /account/… : redirection vers l'écran du Studio.
  app.get("/account/:action", async (req, reply) => {
    const { action } = req.params as { action: string };
    const token = (req.query as { token?: string }).token ?? "";
    if (!["verify", "reset"].includes(action)) return reply.code(404).send();
    return reply.redirect(`/studio/${action === "verify" ? "verify-email" : "reset-password"}?token=${encodeURIComponent(token)}`);
  });

  // Applications web compilées (production et tests navigateur) : une seule origine.
  if (cfg.WEB_DIST_DIR) {
    const apps = ["studio", "market"].filter((a) => fs.existsSync(path.join(cfg.WEB_DIST_DIR!, a, "index.html")));
    for (const a of apps) {
      await app.register(fastifyStatic, {
        root: path.join(cfg.WEB_DIST_DIR, a),
        prefix: `/${a}/`,
        decorateReply: a === apps[0],
        index: ["index.html"],
        wildcard: true,
      });
    }
    app.get("/", async (_req, reply) => reply.redirect("/studio/"));
    app.setNotFoundHandler((req, reply) => {
      const a = apps.find((x) => req.url === `/${x}` || req.url.startsWith(`/${x}/`));
      if (a && req.method === "GET" && !path.extname(req.url.split("?")[0])) {
        return reply.type("text/html").send(fs.readFileSync(path.join(cfg.WEB_DIST_DIR!, a, "index.html")));
      }
      return reply.code(404).send({ error: { code: "not_found", message: "Introuvable." } });
    });
  }

  return app;
}
