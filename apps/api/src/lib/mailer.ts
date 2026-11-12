// E-mails transactionnels. Chaque e-mail est d'abord écrit dans email_outbox, dans la même
// transaction que l'action qui le déclenche ; un envoyeur le transmet ensuite au transport.
//   - « outbox » (développement, tests) : l'e-mail reste dans la table, consultable par
//     /api/dev/mailbox ; refusé en production par la configuration.
//   - « brevo » : API transactionnelle Brevo (hébergement UE).
import type { Queryable, Db } from "../db/pool.js";
import type { Config } from "../config.js";

type Lang = "fr" | "nl" | "en" | "ar";

const T = {
  verify: {
    subject: { fr: "Confirmez votre adresse e-mail VYRA", nl: "Bevestig je VYRA-e-mailadres", en: "Confirm your VYRA email address", ar: "أكّد بريدك الإلكتروني في VYRA" },
    body: {
      fr: "Bonjour {name},\n\nConfirmez votre adresse en ouvrant ce lien (valable 48 heures) :\n{link}\n\nSi vous n'avez pas créé de compte VYRA, ignorez ce message.",
      nl: "Hallo {name},\n\nBevestig je adres via deze link (48 uur geldig):\n{link}\n\nHeb je geen VYRA-account aangemaakt? Negeer dan dit bericht.",
      en: "Hello {name},\n\nConfirm your address by opening this link (valid for 48 hours):\n{link}\n\nIf you did not create a VYRA account, ignore this message.",
      ar: "مرحبًا {name}،\n\nأكّد عنوانك بفتح هذا الرابط (صالح لمدة 48 ساعة):\n{link}\n\nإذا لم تنشئ حسابًا في VYRA فتجاهل هذه الرسالة.",
    },
  },
  reset: {
    subject: { fr: "Réinitialisation de votre mot de passe VYRA", nl: "Je VYRA-wachtwoord opnieuw instellen", en: "Reset your VYRA password", ar: "إعادة تعيين كلمة مرور VYRA" },
    body: {
      fr: "Bonjour {name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n{link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
      nl: "Hallo {name},\n\nKies een nieuw wachtwoord via deze link (1 uur geldig):\n{link}\n\nHeb je dit niet aangevraagd? Negeer dan dit bericht; je wachtwoord blijft ongewijzigd.",
      en: "Hello {name},\n\nTo choose a new password, open this link (valid for 1 hour):\n{link}\n\nIf you did not request this, ignore this message: your password stays unchanged.",
      ar: "مرحبًا {name}،\n\nلاختيار كلمة مرور جديدة افتح هذا الرابط (صالح لمدة ساعة):\n{link}\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة؛ تبقى كلمة مرورك دون تغيير.",
    },
  },
} as const;

export type Template = keyof typeof T;

export async function queueEmail(
  q: Queryable,
  to: string,
  template: Template,
  lang: Lang,
  vars: { name: string; link: string },
): Promise<void> {
  const t = T[template];
  const body = t.body[lang].replace("{name}", vars.name).replace("{link}", vars.link);
  await q.query("INSERT INTO email_outbox (to_email, template, subject, body_text) VALUES ($1,$2,$3,$4)", [
    to,
    template,
    t.subject[lang],
    body,
  ]);
}

/** Transmet les e-mails en attente au transport configuré. Retourne le nombre d'envois réussis. */
export async function flushOutbox(db: Db, cfg: Config, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (cfg.MAIL_TRANSPORT === "outbox") return 0;
  const { rows } = await db.query(
    "SELECT id, to_email, subject, body_text FROM email_outbox WHERE sent_at IS NULL AND attempts < 5 ORDER BY id LIMIT 20",
  );
  let sent = 0;
  for (const m of rows) {
    try {
      const from = /^(.*)<(.+)>$/.exec(cfg.MAIL_FROM);
      const res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": cfg.BREVO_API_KEY ?? "", "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: from?.[1]?.trim() || "VYRA", email: from?.[2] ?? cfg.MAIL_FROM },
          to: [{ email: m.to_email }],
          subject: m.subject,
          textContent: m.body_text,
        }),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}`);
      await db.query("UPDATE email_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1", [m.id]);
      sent++;
    } catch (e) {
      await db.query("UPDATE email_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1", [
        m.id,
        String((e as Error).message).slice(0, 500),
      ]);
    }
  }
  return sent;
}
