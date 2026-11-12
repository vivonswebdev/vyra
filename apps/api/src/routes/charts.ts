// Nuanciers de fils importés (CSV) : propres à chaque compte, source obligatoire, jamais de
// référence inventée. L'analyse du CSV et ses règles viennent du moteur v0.2 (parseChartCsv).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseChartCsv } from "@vyra/engine";
import { badRequest, notFound } from "../lib/errors.js";

const Input = z.object({
  brand: z.string().trim().min(1).max(120),
  product: z.string().trim().min(1).max(160),
  status: z.enum(["officiel", "approximatif", "utilisateur"]),
  source: z.string().trim().max(500),
  sourceUrl: z.url().max(500).optional().or(z.literal("").transform(() => undefined)),
  csv: z.string().min(1).max(1_000_000),
});

const dto = (r: any) => ({
  id: r.id,
  brand: r.brand,
  product: r.product,
  status: r.status,
  source: r.source,
  sourceUrl: r.source_url,
  entries: r.entries,
  createdAt: new Date(r.created_at).toISOString(),
});

export default async function chartRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/thread-charts", async (req) => {
    const u = app.requireUser(req);
    const { rows } = await db.query("SELECT * FROM thread_charts WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100", [u.id]);
    return { charts: rows.map(dto) };
  });

  app.post("/api/thread-charts", { bodyLimit: 1_200_000 }, async (req, reply) => {
    const u = app.requireUser(req);
    const input = Input.parse(req.body);
    const { chart, errors } = parseChartCsv(input.csv, {
      brand: input.brand,
      product: input.product,
      status: input.status,
      source: input.source,
      sourceUrl: input.sourceUrl,
      importedAt: new Date().toISOString(),
    });
    if (errors.length || !chart) throw badRequest(errors[0] ?? "Nuancier invalide.", errors.slice(0, 50).map((m) => ({ path: "csv", message: m })));
    if (chart.entries.length > 5000) throw badRequest("5 000 couleurs au plus par nuancier.");
    const entries = chart.entries.map((e: any) => ({ code: String(e.code).slice(0, 60), name: String(e.name ?? "").slice(0, 120), rgb: e.rgb }));
    const { rows } = await db.query(
      "INSERT INTO thread_charts (owner_id, brand, product, status, source, source_url, entries) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [u.id, input.brand, input.product, input.status, input.source, input.sourceUrl ?? null, JSON.stringify(entries)],
    );
    reply.code(201);
    return { chart: dto(rows[0]) };
  });

  app.delete("/api/thread-charts/:id", async (req) => {
    const u = app.requireUser(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const r = await db.query("DELETE FROM thread_charts WHERE id = $1 AND owner_id = $2", [id, u.id]);
    if (!r.rowCount) throw notFound("Nuancier introuvable.");
    return { ok: true };
  });
}
