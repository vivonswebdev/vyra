// E-mails transactionnels. Chaque e-mail est d'abord écrit dans email_outbox, dans la même
// transaction que l'action qui le déclenche ; un envoyeur le transmet ensuite au transport.
//   - « outbox » (développement, tests) : l'e-mail reste dans la table, consultable par
//     /api/dev/mailbox ; refusé en production par la configuration.
//   - « brevo » : API transactionnelle Brevo (hébergement UE).
import nodemailer from "nodemailer";
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
  exists: {
    subject: { fr: "Tentative de création d'un compte VYRA", nl: "Poging om een VYRA-account aan te maken", en: "Attempt to create a VYRA account", ar: "محاولة إنشاء حساب في VYRA" },
    body: {
      fr: "Bonjour {name},\n\nQuelqu'un a demandé à créer un compte VYRA avec cette adresse, qui en possède déjà un. Si c'est vous, connectez-vous ou réinitialisez votre mot de passe :\n{link}\n\nSinon, ignorez ce message : rien n'a été modifié.",
      nl: "Hallo {name},\n\nIemand wilde een VYRA-account aanmaken met dit adres, dat er al een heeft. Ben jij dat? Meld je aan of stel je wachtwoord opnieuw in:\n{link}\n\nAnders mag je dit bericht negeren: er is niets gewijzigd.",
      en: "Hello {name},\n\nSomeone asked to create a VYRA account with this address, which already has one. If it was you, sign in or reset your password:\n{link}\n\nOtherwise, ignore this message: nothing was changed.",
      ar: "مرحبًا {name}،\n\nطلب أحدهم إنشاء حساب في VYRA بهذا العنوان الذي لديه حساب بالفعل. إن كنت أنت فسجّل الدخول أو أعد تعيين كلمة المرور:\n{link}\n\nوإلا فتجاهل هذه الرسالة: لم يتغير شيء.",
    },
  },
  security: {
    subject: { fr: "Alerte de sécurité sur votre compte VYRA", nl: "Beveiligingsmelding voor je VYRA-account", en: "Security alert on your VYRA account", ar: "تنبيه أمني بشأن حسابك في VYRA" },
    body: {
      fr: "Bonjour {name},\n\n{event}\n\nDate : {date}\n\nSi vous n'êtes pas à l'origine de cette action, changez votre mot de passe et déconnectez les autres appareils depuis votre compte :\n{link}",
      nl: "Hallo {name},\n\n{event}\n\nDatum: {date}\n\nWas jij dit niet? Wijzig je wachtwoord en meld andere toestellen af via je account:\n{link}",
      en: "Hello {name},\n\n{event}\n\nDate: {date}\n\nIf this was not you, change your password and sign out other devices from your account:\n{link}",
      ar: "مرحبًا {name}،\n\n{event}\n\nالتاريخ: {date}\n\nإن لم تكن أنت من قام بذلك فغيّر كلمة المرور وسجّل خروج الأجهزة الأخرى من حسابك:\n{link}",
    },
  },
  deleted: {
    subject: { fr: "Votre compte VYRA a été supprimé", nl: "Je VYRA-account is verwijderd", en: "Your VYRA account has been deleted", ar: "تم حذف حسابك في VYRA" },
    body: {
      fr: "Bonjour {name},\n\nVotre compte VYRA, vos projets et vos fichiers ont été supprimés à votre demande ({date}). Cette action est définitive.\n\nSi vous n'êtes pas à l'origine de cette suppression, répondez à ce message.",
      nl: "Hallo {name},\n\nJe VYRA-account, projecten en bestanden zijn op je verzoek verwijderd ({date}). Dit is definitief.\n\nHeb jij dit niet gedaan? Antwoord dan op dit bericht.",
      en: "Hello {name},\n\nYour VYRA account, projects and files have been deleted at your request ({date}). This is permanent.\n\nIf you did not request this, reply to this message.",
      ar: "مرحبًا {name}،\n\nحُذف حسابك في VYRA ومشاريعك وملفاتك بناءً على طلبك ({date}). هذا الإجراء نهائي.\n\nإن لم تطلب ذلك فردّ على هذه الرسالة.",
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

/**
 * Met un e-mail en file. Avec une clé anti-doublon, un même avis n'est jamais mis en file deux fois
 * (par exemple une alerte par heure et par compte), même si plusieurs instances traitent la même action.
 * Renvoie false si l'e-mail existait déjà.
 */
export async function queueEmail(
  q: Queryable,
  to: string,
  template: Template,
  lang: Lang,
  vars: { name: string; link?: string; [k: string]: string | undefined },
  opts: { dedupeKey?: string } = {},
): Promise<boolean> {
  const t = T[template];
  let body: string = t.body[lang];
  for (const [k, v] of Object.entries(vars)) body = body.split(`{${k}}`).join(v ?? "");
  const r = await q.query(
    `INSERT INTO email_outbox (to_email, template, subject, body_text, dedupe_key) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [to, template, t.subject[lang], body, opts.dedupeKey ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- Alertes de sécurité

const EVENTS = {
  "2fa_enabled": { fr: "La double authentification vient d'être activée.", nl: "Tweestapsverificatie is zojuist ingeschakeld.", en: "Two-factor authentication has just been enabled.", ar: "تم تفعيل المصادقة الثنائية للتو." },
  "2fa_disabled": { fr: "La double authentification vient d'être désactivée.", nl: "Tweestapsverificatie is zojuist uitgeschakeld.", en: "Two-factor authentication has just been disabled.", ar: "تم تعطيل المصادقة الثنائية للتو." },
  recovery_used: { fr: "Un code de secours vient d'être utilisé pour vous connecter.", nl: "Er is zojuist een herstelcode gebruikt om aan te melden.", en: "A recovery code has just been used to sign in.", ar: "استُخدم رمز احتياطي للتو لتسجيل الدخول." },
  password_changed: { fr: "Votre mot de passe vient d'être modifié.", nl: "Je wachtwoord is zojuist gewijzigd.", en: "Your password has just been changed.", ar: "تم تغيير كلمة المرور للتو." },
  login_locked: { fr: "Plusieurs tentatives de connexion ont échoué : les connexions à votre compte sont bloquées pendant 15 minutes.", nl: "Meerdere aanmeldpogingen zijn mislukt: aanmelden is 15 minuten geblokkeerd.", en: "Several sign-in attempts failed: sign-ins to your account are blocked for 15 minutes.", ar: "فشلت عدة محاولات لتسجيل الدخول: حُظر تسجيل الدخول إلى حسابك لمدة 15 دقيقة." },
  account_deleted: { fr: "Votre compte VYRA et ses données ont été supprimés à votre demande.", nl: "Je VYRA-account en de gegevens zijn op je verzoek verwijderd.", en: "Your VYRA account and its data have been deleted at your request.", ar: "حُذف حسابك في VYRA وبياناته بناءً على طلبك." },
} as const;
export type SecurityEvent = keyof typeof EVENTS;

/** Alerte de sécurité au titulaire du compte (une par événement et par heure au plus). */
export async function queueSecurityAlert(
  q: Queryable,
  cfg: Config,
  user: { id: string; email: string; displayName: string; locale: Lang },
  event: SecurityEvent,
): Promise<void> {
  const date = new Date().toLocaleString(user.locale === "ar" ? "ar-u-nu-latn" : user.locale, { timeZone: "Europe/Brussels" });
  await queueEmail(
    q,
    user.email,
    event === "account_deleted" ? "deleted" : "security",
    user.locale,
    { name: user.displayName, event: EVENTS[event][user.locale], date, link: `${cfg.PUBLIC_URL}/studio/account` },
    { dedupeKey: event === "account_deleted" ? undefined : `security:${event}:${user.id}:${new Date().toISOString().slice(0, 13)}` },
  );
}

// ---------------------------------------------------------------- Envoi

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}
export type MailSender = (m: OutgoingMail) => Promise<void>;

export function createSender(cfg: Config, fetchImpl: typeof fetch = fetch): MailSender | null {
  const from = /^(.*)<(.+)>$/.exec(cfg.MAIL_FROM);
  const fromName = from?.[1]?.trim() || "VYRA";
  const fromEmail = from?.[2] ?? cfg.MAIL_FROM;
  if (cfg.MAIL_TRANSPORT === "smtp") {
    const u = new URL(cfg.SMTP_URL!);
    const transport = nodemailer.createTransport({
      host: u.hostname,
      port: Number(u.port || (u.protocol === "smtps:" ? 465 : 587)),
      secure: u.protocol === "smtps:",
      requireTLS: u.searchParams.get("requireTLS") === "true",
      auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return async (m) => {
      await transport.sendMail({ from: { name: fromName, address: fromEmail }, to: m.to, subject: m.subject, text: m.text });
    };
  }
  if (cfg.MAIL_TRANSPORT === "brevo") {
    return async (m) => {
      const res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": cfg.BREVO_API_KEY ?? "", "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { name: fromName, email: fromEmail }, to: [{ email: m.to }], subject: m.subject, textContent: m.text }),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}`);
    };
  }
  return null; // « outbox » : rien n'est envoyé (développement)
}

/**
 * Transmet les e-mails en attente. Chaque message est d'abord RÉSERVÉ (verrou de ligne, SKIP LOCKED) :
 * plusieurs instances peuvent tourner en même temps sans envoyer deux fois le même e-mail. En cas
 * d'échec, nouvelle tentative différée (1, 2, 3, 4 min), 5 tentatives au plus.
 */
export async function flushOutbox(db: Db, cfg: Config, sender: MailSender | null = createSender(cfg)): Promise<number> {
  if (!sender) return 0;
  const { rows } = await db.query(
    `UPDATE email_outbox SET claimed_until = now() + interval '2 minutes', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM email_outbox
         WHERE sent_at IS NULL AND attempts < 5 AND (claimed_until IS NULL OR claimed_until < now())
         ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING id, to_email, subject, body_text, attempts`,
  );
  let sent = 0;
  for (const m of rows) {
    try {
      await sender({ to: m.to_email, subject: m.subject, text: m.body_text });
      await db.query("UPDATE email_outbox SET sent_at = now(), claimed_until = NULL, last_error = NULL WHERE id = $1", [m.id]);
      sent++;
    } catch (e) {
      await db.query("UPDATE email_outbox SET last_error = $2, claimed_until = now() + make_interval(mins => $3) WHERE id = $1", [
        m.id,
        String((e as Error).message).slice(0, 500),
        m.attempts,
      ]);
    }
  }
  return sent;
}
