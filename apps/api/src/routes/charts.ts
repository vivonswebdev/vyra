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

// Les messages du lecteur de nuanciers viennent du moteur figé (en français) : ils sont rattachés ici à une
// clé de traduction et à ses paramètres, sans toucher au moteur.
const CHART_REASONS: [RegExp, string][] = [
  [/^Fichier vide/, "chart_empty"],
  [/^Colonne de référence introuvable/, "chart_no_code_column"],
  [/^Colonne de couleur introuvable/, "chart_no_color_column"],
  [/^Marque manquante/, "chart_no_brand"],
  [/^Source manquante/, "chart_no_source"],
  [/^Statut inconnu/, "chart_bad_status"],
  [/^Un nuancier officiel doit citer/, "chart_official_source"],
  [/^Aucune couleur/, "chart_no_colors"],
];
export function chartReason(m: string): { reason: string; params?: Record<string, string | number> } {
  let x = /^Ligne (\d+) : référence manquante/.exec(m);
  if (x) return { reason: "chart_line_code", params: { line: +x[1] } };
  x = /^Ligne (\d+) : couleur « (.*) » invalide/.exec(m);
  if (x) return { reason: "chart_line_color", params: { line: +x[1], value: x[2].slice(0, 40) } };
  x = /^Ligne (\d+) : référence (.*) en double/.exec(m);
  if (x) return { reason: "chart_line_duplicate", params: { line: +x[1], code: x[2].slice(0, 60) } };
  for (const [re, reason] of CHART_REASONS) if (re.test(m)) return { reason };
  return { reason: "chart_invalid" };
}

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
    if (errors.length || !chart) {
      const details = (errors.length ? errors : ["Nuancier invalide."]).slice(0, 50).map((m) => ({ path: "csv", message: m, ...chartReason(m) }));
      throw badRequest(details[0].reason, details[0].message, details, details[0].params);
    }
    if (chart.entries.length > 5000) throw badRequest("chart_too_many", "5 000 couleurs au plus par nuancier.");
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
    if (!r.rowCount) throw notFound("chart_not_found", "Nuancier introuvable.");
    return { ok: true };
  });
}
