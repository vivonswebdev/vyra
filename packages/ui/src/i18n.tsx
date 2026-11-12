// Traductions : français (langue source), néerlandais, anglais, arabe (de droite à gauche).
// Une clé absente dans une langue retombe sur le français et est signalée en développement.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "fr" | "nl" | "en" | "ar";
export const LANG_LABELS: Record<Lang, string> = { fr: "FR", nl: "NL", en: "EN", ar: "ع" };
export type Dict = Record<string, string>;
export type Dicts = Record<Lang, Dict>;

const LS_KEY = "vyra.lang";

export const COMMON: Dicts = {
  fr: {
    "app.signature": "MACHINE EMBROIDERY",
    "app.slogan": "CREATE. EDIT. STITCH. SELL.",
    "auth.login": "Connexion",
    "auth.signup": "Créer un compte",
    "auth.logout": "Se déconnecter",
    "auth.email": "Adresse e-mail",
    "auth.password": "Mot de passe",
    "auth.passwordHint": "10 caractères au moins.",
    "auth.newPassword": "Nouveau mot de passe",
    "auth.currentPassword": "Mot de passe actuel",
    "auth.displayName": "Nom affiché",
    "auth.acceptTerms": "J'accepte les conditions d'utilisation et la politique de confidentialité de VYRA.",
    "auth.forgot": "Mot de passe oublié ?",
    "auth.noAccount": "Pas encore de compte ?",
    "auth.haveAccount": "Déjà un compte ?",
    "auth.forgotTitle": "Réinitialiser le mot de passe",
    "auth.forgotIntro": "Indiquez votre adresse : si un compte existe, vous recevrez un lien valable une heure.",
    "auth.forgotSend": "Envoyer le lien",
    "auth.forgotSent": "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Pensez à vérifier les indésirables.",
    "auth.resetTitle": "Choisir un nouveau mot de passe",
    "auth.resetSave": "Enregistrer le mot de passe",
    "auth.resetMissing": "Lien incomplet. Ouvrez le lien reçu par e-mail.",
    "auth.verifyTitle": "Vérification de l'adresse e-mail",
    "auth.verifyOk": "Adresse confirmée. Merci !",
    "auth.verifying": "Vérification en cours…",
    "auth.verifyBanner": "Confirmez votre adresse e-mail : un lien vous a été envoyé.",
    "auth.resend": "Renvoyer le lien",
    "auth.resent": "Nouveau lien envoyé.",
    "auth.backToLogin": "Retour à la connexion",
    "account.title": "Mon compte",
    "account.profile": "Profil",
    "account.preferences": "Préférences",
    "account.language": "Langue",
    "account.theme": "Thème",
    "account.themeAuto": "Automatique",
    "account.themeLight": "Clair",
    "account.themeDark": "Sombre",
    "account.security": "Sécurité",
    "account.changePassword": "Changer le mot de passe",
    "account.passwordChanged": "Mot de passe modifié. Les autres appareils ont été déconnectés.",
    "account.sessions": "Appareils connectés",
    "account.revokeOthers": "Déconnecter les autres appareils",
    "account.revoked": "{n} autre(s) session(s) fermée(s).",
    "account.current": "cet appareil",
    "account.saved": "Modifications enregistrées.",
    "account.uiMode": "Mode d'affichage du Studio",
    "account.modeSimple": "Simple",
    "account.modeExpert": "Expert",
    "common.save": "Enregistrer",
    "common.cancel": "Annuler",
    "common.close": "Fermer",
    "common.confirm": "Confirmer",
    "common.delete": "Supprimer",
    "common.loading": "Chargement…",
    "common.error": "Une erreur est survenue.",
    "common.offline": "Serveur injoignable. Vérifiez votre connexion.",
    "common.retry": "Réessayer",
    "common.back": "Retour",
  },
  nl: {
    "app.signature": "MACHINE EMBROIDERY",
    "app.slogan": "CREATE. EDIT. STITCH. SELL.",
    "auth.login": "Aanmelden",
    "auth.signup": "Account aanmaken",
    "auth.logout": "Afmelden",
    "auth.email": "E-mailadres",
    "auth.password": "Wachtwoord",
    "auth.passwordHint": "Minstens 10 tekens.",
    "auth.newPassword": "Nieuw wachtwoord",
    "auth.currentPassword": "Huidig wachtwoord",
    "auth.displayName": "Weergavenaam",
    "auth.acceptTerms": "Ik aanvaard de gebruiksvoorwaarden en het privacybeleid van VYRA.",
    "auth.forgot": "Wachtwoord vergeten?",
    "auth.noAccount": "Nog geen account?",
    "auth.haveAccount": "Al een account?",
    "auth.forgotTitle": "Wachtwoord opnieuw instellen",
    "auth.forgotIntro": "Geef je adres op: als er een account bestaat, ontvang je een link die één uur geldig is.",
    "auth.forgotSend": "Link versturen",
    "auth.forgotSent": "Als er een account bestaat voor dit adres, is er net een e-mail verstuurd. Kijk ook bij ongewenste mail.",
    "auth.resetTitle": "Nieuw wachtwoord kiezen",
    "auth.resetSave": "Wachtwoord opslaan",
    "auth.resetMissing": "Onvolledige link. Open de link uit de e-mail.",
    "auth.verifyTitle": "E-mailadres bevestigen",
    "auth.verifyOk": "Adres bevestigd. Bedankt!",
    "auth.verifying": "Bezig met bevestigen…",
    "auth.verifyBanner": "Bevestig je e-mailadres: er is een link verstuurd.",
    "auth.resend": "Link opnieuw versturen",
    "auth.resent": "Nieuwe link verstuurd.",
    "auth.backToLogin": "Terug naar aanmelden",
    "account.title": "Mijn account",
    "account.profile": "Profiel",
    "account.preferences": "Voorkeuren",
    "account.language": "Taal",
    "account.theme": "Thema",
    "account.themeAuto": "Automatisch",
    "account.themeLight": "Licht",
    "account.themeDark": "Donker",
    "account.security": "Beveiliging",
    "account.changePassword": "Wachtwoord wijzigen",
    "account.passwordChanged": "Wachtwoord gewijzigd. Andere toestellen zijn afgemeld.",
    "account.sessions": "Aangemelde toestellen",
    "account.revokeOthers": "Andere toestellen afmelden",
    "account.revoked": "{n} andere sessie(s) gesloten.",
    "account.current": "dit toestel",
    "account.saved": "Wijzigingen opgeslagen.",
    "account.uiMode": "Weergavemodus van de Studio",
    "account.modeSimple": "Eenvoudig",
    "account.modeExpert": "Expert",
    "common.save": "Opslaan",
    "common.cancel": "Annuleren",
    "common.close": "Sluiten",
    "common.confirm": "Bevestigen",
    "common.delete": "Verwijderen",
    "common.loading": "Laden…",
    "common.error": "Er is een fout opgetreden.",
    "common.offline": "Server onbereikbaar. Controleer je verbinding.",
    "common.retry": "Opnieuw proberen",
    "common.back": "Terug",
  },
  en: {
    "app.signature": "MACHINE EMBROIDERY",
    "app.slogan": "CREATE. EDIT. STITCH. SELL.",
    "auth.login": "Sign in",
    "auth.signup": "Create account",
    "auth.logout": "Sign out",
    "auth.email": "Email address",
    "auth.password": "Password",
    "auth.passwordHint": "At least 10 characters.",
    "auth.newPassword": "New password",
    "auth.currentPassword": "Current password",
    "auth.displayName": "Display name",
    "auth.acceptTerms": "I accept VYRA's terms of use and privacy policy.",
    "auth.forgot": "Forgot your password?",
    "auth.noAccount": "No account yet?",
    "auth.haveAccount": "Already have an account?",
    "auth.forgotTitle": "Reset your password",
    "auth.forgotIntro": "Enter your address: if an account exists, you will receive a link valid for one hour.",
    "auth.forgotSend": "Send the link",
    "auth.forgotSent": "If an account exists for this address, an email has just been sent. Check your spam folder too.",
    "auth.resetTitle": "Choose a new password",
    "auth.resetSave": "Save password",
    "auth.resetMissing": "Incomplete link. Open the link from the email.",
    "auth.verifyTitle": "Email verification",
    "auth.verifyOk": "Address confirmed. Thank you!",
    "auth.verifying": "Verifying…",
    "auth.verifyBanner": "Confirm your email address: a link has been sent to you.",
    "auth.resend": "Resend the link",
    "auth.resent": "New link sent.",
    "auth.backToLogin": "Back to sign in",
    "account.title": "My account",
    "account.profile": "Profile",
    "account.preferences": "Preferences",
    "account.language": "Language",
    "account.theme": "Theme",
    "account.themeAuto": "Automatic",
    "account.themeLight": "Light",
    "account.themeDark": "Dark",
    "account.security": "Security",
    "account.changePassword": "Change password",
    "account.passwordChanged": "Password changed. Other devices have been signed out.",
    "account.sessions": "Signed-in devices",
    "account.revokeOthers": "Sign out other devices",
    "account.revoked": "{n} other session(s) closed.",
    "account.current": "this device",
    "account.saved": "Changes saved.",
    "account.uiMode": "Studio display mode",
    "account.modeSimple": "Simple",
    "account.modeExpert": "Expert",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.confirm": "Confirm",
    "common.delete": "Delete",
    "common.loading": "Loading…",
    "common.error": "Something went wrong.",
    "common.offline": "Server unreachable. Check your connection.",
    "common.retry": "Retry",
    "common.back": "Back",
  },
  ar: {
    "app.signature": "MACHINE EMBROIDERY",
    "app.slogan": "CREATE. EDIT. STITCH. SELL.",
    "auth.login": "تسجيل الدخول",
    "auth.signup": "إنشاء حساب",
    "auth.logout": "تسجيل الخروج",
    "auth.email": "البريد الإلكتروني",
    "auth.password": "كلمة المرور",
    "auth.passwordHint": "10 أحرف على الأقل.",
    "auth.newPassword": "كلمة مرور جديدة",
    "auth.currentPassword": "كلمة المرور الحالية",
    "auth.displayName": "الاسم المعروض",
    "auth.acceptTerms": "أوافق على شروط استخدام VYRA وسياسة الخصوصية.",
    "auth.forgot": "نسيت كلمة المرور؟",
    "auth.noAccount": "ليس لديك حساب؟",
    "auth.haveAccount": "لديك حساب بالفعل؟",
    "auth.forgotTitle": "إعادة تعيين كلمة المرور",
    "auth.forgotIntro": "أدخل عنوانك: إذا كان هناك حساب فستصلك رسالة برابط صالح لمدة ساعة.",
    "auth.forgotSend": "إرسال الرابط",
    "auth.forgotSent": "إذا كان هناك حساب بهذا العنوان فقد أُرسلت رسالة للتو. تحقّق أيضًا من الرسائل غير المرغوب فيها.",
    "auth.resetTitle": "اختيار كلمة مرور جديدة",
    "auth.resetSave": "حفظ كلمة المرور",
    "auth.resetMissing": "الرابط غير مكتمل. افتح الرابط الوارد في البريد.",
    "auth.verifyTitle": "تأكيد البريد الإلكتروني",
    "auth.verifyOk": "تم تأكيد العنوان. شكرًا!",
    "auth.verifying": "جارٍ التأكيد…",
    "auth.verifyBanner": "أكّد بريدك الإلكتروني: أُرسل إليك رابط.",
    "auth.resend": "إعادة إرسال الرابط",
    "auth.resent": "تم إرسال رابط جديد.",
    "auth.backToLogin": "العودة إلى تسجيل الدخول",
    "account.title": "حسابي",
    "account.profile": "الملف الشخصي",
    "account.preferences": "التفضيلات",
    "account.language": "اللغة",
    "account.theme": "المظهر",
    "account.themeAuto": "تلقائي",
    "account.themeLight": "فاتح",
    "account.themeDark": "داكن",
    "account.security": "الأمان",
    "account.changePassword": "تغيير كلمة المرور",
    "account.passwordChanged": "تم تغيير كلمة المرور وتسجيل خروج الأجهزة الأخرى.",
    "account.sessions": "الأجهزة المتصلة",
    "account.revokeOthers": "تسجيل خروج الأجهزة الأخرى",
    "account.revoked": "تم إغلاق {n} جلسة أخرى.",
    "account.current": "هذا الجهاز",
    "account.saved": "تم حفظ التغييرات.",
    "account.uiMode": "وضع عرض الاستوديو",
    "account.modeSimple": "بسيط",
    "account.modeExpert": "خبير",
    "common.save": "حفظ",
    "common.cancel": "إلغاء",
    "common.close": "إغلاق",
    "common.confirm": "تأكيد",
    "common.delete": "حذف",
    "common.loading": "جارٍ التحميل…",
    "common.error": "حدث خطأ.",
    "common.offline": "تعذّر الوصول إلى الخادم. تحقّق من اتصالك.",
    "common.retry": "إعادة المحاولة",
    "common.back": "رجوع",
  },
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;
interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  dir: "ltr" | "rtl";
}

const Ctx = createContext<I18nCtx | null>(null);

function initialLang(): Lang {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s === "fr" || s === "nl" || s === "en" || s === "ar") return s;
  } catch {}
  const nav = (typeof navigator !== "undefined" ? navigator.language : "fr").slice(0, 2);
  return (["fr", "nl", "en", "ar"].includes(nav) ? nav : "fr") as Lang;
}

export function I18nProvider({ dicts, children }: { dicts: Dicts; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const merged = useMemo(() => {
    const out = {} as Dicts;
    for (const l of ["fr", "nl", "en", "ar"] as Lang[]) out[l] = { ...COMMON[l], ...dicts[l] };
    return out;
  }, [dicts]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {}
  }, []);
  const dir = lang === "ar" ? "rtl" : "ltr";
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const t = useCallback<TFn>(
    (key, vars) => {
      let s = merged[lang][key] ?? merged.fr[key];
      if (s === undefined) {
        if (import.meta.env?.DEV) console.warn("[i18n] clé manquante", key);
        s = key;
      }
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [merged, lang],
  );
  const value = useMemo(() => ({ lang, setLang, t, dir }) as I18nCtx, [lang, setLang, t, dir]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("I18nProvider manquant");
  return c;
}

/** Vérifie qu'un dictionnaire couvre les mêmes clés dans les quatre langues (utilisé par les tests). */
export function missingKeys(dicts: Dicts): Record<Lang, string[]> {
  const all = new Set(Object.values(dicts).flatMap((d) => Object.keys(d)));
  const out = {} as Record<Lang, string[]>;
  for (const l of ["fr", "nl", "en", "ar"] as Lang[]) out[l] = [...all].filter((k) => !(k in dicts[l]));
  return out;
}
