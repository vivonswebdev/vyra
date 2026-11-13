import fs from "node:fs";
import crypto from "node:crypto";
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
import { S3Storage } from "./lib/s3storage.js";
import { pgRateLimitStore } from "./lib/ratelimit-pg.js";
import { ClamdScanner, NoScanner, type FileScanner } from "./lib/scanner.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import accountRoutes from "./routes/account.js";
import chartRoutes from "./routes/charts.js";
import devRoutes from "./routes/dev.js";
import opsRoutes from "./routes/ops.js";
import marketRoutes from "./routes/market.js";
import { EnginePool } from "./engine/pool.js";

declare module "fastify" {
  interface FastifyInstance {
    storage: Storage;
    engine: EnginePool;
    scanner: FileScanner;
  }
}

export interface AppDeps {
  cfg: Config;
  db: Db;
  storage?: Storage;
  scanner?: FileScanner;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Routes appelées par des services externes, authentifiées par signature et non par cookie. */
const CSRF_EXEMPT = [/^\/api\/webhooks\//];

export async function buildApp({ cfg, db, storage, scanner }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.LOG_LEVEL === "silent" ? false : { level: cfg.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: cfg.TRUST_PROXY,
    // Identifiant de requête : repris du proxy (x-request-id) s'il est sûr, sinon généré ; renvoyé au client.
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(String(req.id))) (req as any).id = crypto.randomUUID();
    reply.header("x-request-id", req.id);
  });
  app.decorate("db", db);
  app.decorate("cfg", cfg);
  app.decorate("storage", storage ?? createStorage(cfg));
  app.decorate("scanner", scanner ?? (cfg.FILE_SCAN === "clamd" ? new ClamdScanner(cfg.CLAMD_HOST, cfg.CLAMD_PORT, cfg.CLAMD_TIMEOUT_MS) : new NoScanner()));
  const engine = new EnginePool({ size: cfg.ENGINE_WORKERS, timeoutMs: cfg.ENGINE_TIMEOUT_MS, maxQueue: cfg.ENGINE_QUEUE, maxMemoryMb: cfg.ENGINE_MEMORY_MB });
  app.decorate("engine", engine);
  app.addHook("onClose", async () => engine.close());

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
        // Avec les URL S3 temporaires, le navigateur suit la redirection vers le fournisseur.
        connectSrc: ["'self'", ...(cfg.S3_PRESIGNED_DOWNLOADS && cfg.S3_ENDPOINT ? [new URL(cfg.S3_ENDPOINT).origin] : [])],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    ...(cfg.RATE_LIMIT_STORE === "postgres" ? { store: pgRateLimitStore(db, cfg.RATE_LIMIT_NAMESPACE) as any } : {}),
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, code: "rate_limited", message: `Trop de requêtes. Réessayez dans ${Math.ceil(ctx.ttl / 1000)} s.` }),
  });
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
          // Code et limites de chaque problème : les applications en tirent un message traduit.
          details: err.issues.map((i) => {
            const x = i as { minimum?: unknown; maximum?: unknown; format?: unknown; origin?: unknown };
            return {
              path: i.path.join("."),
              message: i.message,
              issue: i.code,
              ...(typeof x.origin === "string" ? { origin: x.origin } : {}),
              ...(typeof x.minimum === "number" || typeof x.minimum === "bigint" ? { minimum: Number(x.minimum) } : {}),
              ...(typeof x.maximum === "number" || typeof x.maximum === "bigint" ? { maximum: Number(x.maximum) } : {}),
              ...(typeof x.format === "string" ? { format: x.format } : {}),
            };
          }),
        },
      });
    }
    if (err instanceof HttpError)
      return reply.code(err.status).send({
        error: { code: err.code, ...(err.reason && err.reason !== err.code ? { reason: err.reason } : {}), ...(err.params ? { params: err.params } : {}), message: err.message, details: err.details },
      });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) {
      const message = e.statusCode === 429 ? "Trop de requêtes. Patientez un instant." : e.statusCode === 413 ? "Contenu trop volumineux." : e.message;
      return reply.code(e.statusCode).send({ error: { code: e.code ?? "error", message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: "internal", message: "Erreur interne. L'incident est journalisé." } });
  });

  await app.register(authPlugin);

  await app.register(opsRoutes);

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(chartRoutes);
  await app.register(projectRoutes);
  await app.register(marketRoutes);
  if (!cfg.isProd && cfg.DEV_MAILBOX) await app.register(devRoutes);

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

export function createStorage(cfg: Config): Storage {
  if (cfg.STORAGE_DRIVER === "s3")
    return new S3Storage({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      bucket: cfg.S3_BUCKET!,
      prefix: cfg.S3_PREFIX,
      accessKeyId: cfg.S3_ACCESS_KEY_ID!,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY!,
      serverSideEncryption: cfg.S3_SSE === "AES256" ? "AES256" : undefined,
    });
  return new LocalStorage(cfg.STORAGE_DIR);
}
