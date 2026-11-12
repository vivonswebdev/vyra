// Outils de développement, jamais enregistrés en production (voir app.ts) :
// boîte aux lettres locale pour lire les e-mails de vérification et de réinitialisation.
import type { FastifyInstance } from "fastify";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export default async function devRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/dev/mailbox", async (req) => {
    const to = String((req.query as any)?.to ?? "").toLowerCase();
    const { rows } = await db.query(
      `SELECT id, to_email, template, subject, body_text, created_at FROM email_outbox
        WHERE ($1 = '' OR to_email = $1) ORDER BY id DESC LIMIT 50`,
      [to],
    );
    return { emails: rows };
  });

  app.get("/dev/mailbox", async (_req, reply) => {
    const { rows } = await db.query("SELECT to_email, subject, body_text, created_at FROM email_outbox ORDER BY id DESC LIMIT 50");
    const items = rows
      .map(
        (m) =>
          `<article><h2>${esc(m.subject)}</h2><p><b>À :</b> ${esc(m.to_email)} · ${new Date(m.created_at).toLocaleString("fr-BE")}</p><pre>${esc(
            m.body_text,
          ).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</pre></article>`,
      )
      .join("");
    reply.type("text/html; charset=utf-8");
    return `<!doctype html><meta charset="utf-8"><title>Boîte aux lettres de développement</title>
<style>body{font:15px system-ui;background:#F6F1E8;color:#5A3A28;max-width:760px;margin:24px auto;padding:0 16px}article{background:#fff;border:1px solid #E8D9C6;border-radius:10px;padding:12px 16px;margin:12px 0}pre{white-space:pre-wrap;font:14px ui-monospace,monospace}a{color:#B87333}</style>
<h1>Boîte aux lettres de développement</h1><p>E-mails mis en file par l'API (transport « outbox »). Cette page n'existe pas en production.</p>${items || "<p>Aucun e-mail.</p>"}`;
  });
}
