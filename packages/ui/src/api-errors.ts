// Messages d'erreur de l'API traduits en FR, NL, EN et AR. Le serveur renvoie une catégorie stable (`code`),
// éventuellement précisée (`reason`) et des valeurs (`params`) ; le texte affiché vient toujours d'ici, jamais du
// message français du serveur. Chaque raison émise par l'API doit figurer dans ce tableau (vérifié par un test).
import { ApiError } from "./api.js";

type T4 = [fr: string, nl: string, en: string, ar: string];
type TFn = (key: string, vars?: Record<string, string | number>) => string;

export const API_ERRORS: Record<string, T4> = {
  // Catégories générales
  unauthorized: ["Connexion requise.", "Aanmelding vereist.", "Please sign in.", "يلزم تسجيل الدخول."],
  forbidden: ["Accès refusé.", "Toegang geweigerd.", "Access denied.", "تم رفض الوصول."],
  not_found: ["Introuvable.", "Niet gevonden.", "Not found.", "غير موجود."],
  csrf: ["Requête refusée par mesure de sécurité. Rechargez la page.", "Verzoek om veiligheidsredenen geweigerd. Herlaad de pagina.", "Request refused for security reasons. Reload the page.", "رُفض الطلب لأسباب أمنية. أعد تحميل الصفحة."],
  validation: ["Données invalides.", "Ongeldige gegevens.", "Invalid data.", "بيانات غير صالحة."],
  rate_limited: ["Trop de requêtes. Patientez un instant.", "Te veel verzoeken. Wacht even.", "Too many requests. Please wait a moment.", "طلبات كثيرة جدًا. انتظر قليلًا."],
  internal: ["Erreur interne. L'incident est journalisé.", "Interne fout. Het incident is geregistreerd.", "Internal error. The incident has been logged.", "خطأ داخلي. تم تسجيل الحادثة."],
  too_large: ["Contenu trop volumineux.", "Inhoud te groot.", "Content too large.", "المحتوى كبير جدًا."],
  server: ["Le serveur a rencontré un problème. Réessayez dans un instant.", "De server ondervond een probleem. Probeer het zo meteen opnieuw.", "The server ran into a problem. Try again in a moment.", "واجه الخادم مشكلة. أعد المحاولة بعد لحظة."],
  refused: ["Requête refusée.", "Verzoek geweigerd.", "Request refused.", "رُفض الطلب."],
  // Comptes et connexion
  invalid_credentials: ["Adresse e-mail ou mot de passe incorrect.", "E-mailadres of wachtwoord onjuist.", "Incorrect email address or password.", "البريد الإلكتروني أو كلمة المرور غير صحيحة."],
  too_many_attempts: ["Trop de tentatives pour cette adresse. Réessayez dans 15 minutes ou réinitialisez votre mot de passe.", "Te veel pogingen voor dit adres. Probeer het over 15 minuten opnieuw of stel je wachtwoord opnieuw in.", "Too many attempts for this address. Try again in 15 minutes or reset your password.", "محاولات كثيرة جدًا لهذا العنوان. أعد المحاولة بعد 15 دقيقة أو أعد تعيين كلمة المرور."],
  account_suspended: ["Ce compte est suspendu.", "Dit account is opgeschort.", "This account is suspended.", "هذا الحساب موقوف."],
  email_unverified: ["Confirmez d'abord votre adresse e-mail : un nouveau lien vient de vous être envoyé.", "Bevestig eerst je e-mailadres: er is net een nieuwe link verstuurd.", "Please confirm your email address first: a new link has just been sent.", "أكّد عنوان بريدك الإلكتروني أولًا: أُرسل إليك رابط جديد للتو."],
  mfa_required: ["Code de double authentification requis ou incorrect.", "Code voor tweestapsverificatie vereist of onjuist.", "Two-factor code required or incorrect.", "رمز المصادقة الثنائية مطلوب أو غير صحيح."],
  mfa_expired: ["Étape de vérification expirée. Reconnectez-vous.", "Verificatiestap verlopen. Meld je opnieuw aan.", "Verification step expired. Please sign in again.", "انتهت مهلة خطوة التحقق. سجّل الدخول من جديد."],
  mfa_already_enabled: ["La double authentification est déjà active.", "Tweestapsverificatie is al actief.", "Two-factor authentication is already enabled.", "المصادقة الثنائية مفعّلة بالفعل."],
  mfa_setup_first: ["Commencez par la configuration (scanner le code).", "Begin met de configuratie (de code scannen).", "Start with the setup (scan the code).", "ابدأ بالإعداد (امسح الرمز)."],
  wrong_code: ["Code incorrect.", "Onjuiste code.", "Incorrect code.", "رمز غير صحيح."],
  wrong_code_clock: ["Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.", "Onjuiste code. Controleer de tijd van je telefoon en probeer opnieuw.", "Incorrect code. Check your phone's clock and try again.", "رمز غير صحيح. تحقّق من ساعة هاتفك وأعد المحاولة."],
  wrong_password: ["Mot de passe incorrect.", "Onjuist wachtwoord.", "Incorrect password.", "كلمة المرور غير صحيحة."],
  wrong_current_password: ["Mot de passe actuel incorrect.", "Huidig wachtwoord onjuist.", "Current password is incorrect.", "كلمة المرور الحالية غير صحيحة."],
  verify_link_invalid: ["Lien invalide ou expiré. Demandez un nouveau lien de confirmation.", "Ongeldige of verlopen link. Vraag een nieuwe bevestigingslink aan.", "Invalid or expired link. Request a new confirmation link.", "رابط غير صالح أو منتهي الصلاحية. اطلب رابط تأكيد جديدًا."],
  reset_link_invalid: ["Lien invalide ou expiré. Refaites une demande de réinitialisation.", "Ongeldige of verlopen link. Vraag opnieuw een wachtwoordherstel aan.", "Invalid or expired link. Request a new password reset.", "رابط غير صالح أو منتهي الصلاحية. اطلب إعادة تعيين جديدة."],
  session_not_found: ["Session introuvable.", "Sessie niet gevonden.", "Session not found.", "الجلسة غير موجودة."],
  // Projets et fichiers
  project_not_found: ["Projet introuvable.", "Project niet gevonden.", "Project not found.", "المشروع غير موجود."],
  project_conflict: ["Ce projet a été modifié ailleurs (autre onglet ou appareil).", "Dit project is elders gewijzigd (ander tabblad of apparaat).", "This project was changed elsewhere (another tab or device).", "عُدّل هذا المشروع في مكان آخر (علامة تبويب أو جهاز آخر)."],
  name_mismatch: ["Le nom saisi ne correspond pas au projet.", "De ingevoerde naam komt niet overeen met het project.", "The name entered does not match the project.", "الاسم المُدخل لا يطابق المشروع."],
  version_not_found: ["Version introuvable.", "Versie niet gevonden.", "Version not found.", "النسخة غير موجودة."],
  no_design: ["Le projet ne contient pas encore de motif.", "Het project bevat nog geen ontwerp.", "The project does not contain a design yet.", "لا يحتوي المشروع على تصميم بعد."],
  no_file: ["Aucun fichier reçu.", "Geen bestand ontvangen.", "No file received.", "لم يُستلم أي ملف."],
  file_too_large: ["Fichier trop volumineux (20 Mo au plus).", "Bestand te groot (maximaal 20 MB).", "File too large (20 MB maximum).", "الملف كبير جدًا (20 ميغابايت كحد أقصى)."],
  file_type: ["Format refusé : PNG, JPG, WEBP, BMP, SVG ou PDF uniquement.", "Formaat geweigerd: alleen PNG, JPG, WEBP, BMP, SVG of PDF.", "Format refused: PNG, JPG, WEBP, BMP, SVG or PDF only.", "صيغة مرفوضة: PNG أو JPG أو WEBP أو BMP أو SVG أو PDF فقط."],
  file_not_found: ["Fichier introuvable.", "Bestand niet gevonden.", "File not found.", "الملف غير موجود."],
  export_not_found: ["Export introuvable.", "Export niet gevonden.", "Export not found.", "ملف التصدير غير موجود."],
  export_blocked: ["Export bloqué par le contrôle qualité.", "Export geblokkeerd door de kwaliteitscontrole.", "Export blocked by the quality check.", "التصدير محظور بسبب فحص الجودة."],
  file_infected: ["Fichier refusé : l'analyse antivirus a détecté une menace.", "Bestand geweigerd: de virusscan heeft een bedreiging gevonden.", "File refused: the antivirus scan detected a threat.", "رُفض الملف: اكتشف فحص مكافحة الفيروسات تهديدًا."],
  scan_unavailable: ["Analyse antivirus momentanément indisponible : le fichier n'est pas utilisé. Réessayez dans quelques minutes.", "Virusscan tijdelijk niet beschikbaar: het bestand wordt niet gebruikt. Probeer het over enkele minuten opnieuw.", "Antivirus scan temporarily unavailable: the file is not used. Try again in a few minutes.", "فحص مكافحة الفيروسات غير متاح مؤقتًا: لن يُستخدم الملف. أعد المحاولة بعد بضع دقائق."],
  // Moteur de calcul
  engine_error: ["Le moteur a refusé ce document.", "De engine heeft dit document geweigerd.", "The engine refused this document.", "رفض المحرّك هذا المستند."],
  engine_crash: ["Le calcul a échoué (mémoire ou erreur interne). Réessayez ; si le problème persiste, simplifiez le motif.", "De berekening is mislukt (geheugen of interne fout). Probeer opnieuw; blijft het probleem, vereenvoudig dan het ontwerp.", "The computation failed (memory or internal error). Try again; if the problem persists, simplify the design.", "فشل الحساب (الذاكرة أو خطأ داخلي). أعد المحاولة، وإذا استمرت المشكلة فبسّط التصميم."],
  engine_timeout: ["Calcul interrompu : il dépassait la durée maximale autorisée. Simplifiez le motif ou réduisez la densité.", "Berekening onderbroken: de maximale duur werd overschreden. Vereenvoudig het ontwerp of verlaag de dichtheid.", "Computation stopped: it exceeded the maximum allowed time. Simplify the design or reduce the density.", "توقف الحساب: تجاوز المدة القصوى المسموح بها. بسّط التصميم أو خفّض الكثافة."],
  engine_busy: ["Le service de calcul est saturé. Réessayez dans quelques instants.", "De rekendienst is overbelast. Probeer het zo meteen opnieuw.", "The computation service is busy. Try again in a moment.", "خدمة الحساب مشغولة. أعد المحاولة بعد لحظات."],
  engine_closed: ["Service en cours d'arrêt. Réessayez dans quelques instants.", "Dienst wordt afgesloten. Probeer het zo meteen opnieuw.", "Service shutting down. Try again in a moment.", "الخدمة قيد الإيقاف. أعد المحاولة بعد لحظات."],
  // Nuanciers
  chart_not_found: ["Nuancier introuvable.", "Kleurkaart niet gevonden.", "Thread chart not found.", "بطاقة الألوان غير موجودة."],
  chart_too_many: ["5 000 couleurs au plus par nuancier.", "Maximaal 5.000 kleuren per kleurkaart.", "5,000 colours at most per chart.", "5000 لون كحد أقصى لكل بطاقة."],
  chart_invalid: ["Nuancier invalide.", "Ongeldige kleurkaart.", "Invalid thread chart.", "بطاقة ألوان غير صالحة."],
  chart_empty: ["Fichier vide.", "Leeg bestand.", "Empty file.", "ملف فارغ."],
  chart_no_code_column: ["Colonne de référence introuvable (code, ref, reference…).", "Referentiekolom niet gevonden (code, ref, reference…).", "Reference column not found (code, ref, reference…).", "لم يُعثر على عمود المرجع (code أو ref أو reference…)."],
  chart_no_color_column: ["Colonne de couleur introuvable (hex ou r, g, b).", "Kleurkolom niet gevonden (hex of r, g, b).", "Colour column not found (hex or r, g, b).", "لم يُعثر على عمود اللون (hex أو r, g, b)."],
  chart_no_brand: ["Marque manquante.", "Merk ontbreekt.", "Brand missing.", "العلامة التجارية مفقودة."],
  chart_no_source: ["Source manquante : indiquez le document ou le site d'où viennent les couleurs.", "Bron ontbreekt: vermeld het document of de website waar de kleuren vandaan komen.", "Source missing: state the document or website the colours come from.", "المصدر مفقود: اذكر المستند أو الموقع الذي أُخذت منه الألوان."],
  chart_bad_status: ["Statut inconnu.", "Onbekende status.", "Unknown status.", "حالة غير معروفة."],
  chart_official_source: ["Un nuancier officiel doit citer son lien ou au moins le titre et l'année du document.", "Een officiële kleurkaart moet haar link vermelden of minstens de titel en het jaar van het document.", "An official chart must cite its link or at least the document's title and year.", "يجب أن تذكر البطاقة الرسمية رابطها أو على الأقل عنوان المستند وسنته."],
  chart_no_colors: ["Aucune couleur.", "Geen kleuren.", "No colours.", "لا توجد ألوان."],
  chart_line_code: ["Ligne {line} : référence manquante.", "Regel {line}: referentie ontbreekt.", "Line {line}: reference missing.", "السطر {line}: المرجع مفقود."],
  chart_line_color: ["Ligne {line} : couleur « {value} » invalide (attendu #RRVVBB).", "Regel {line}: kleur ‘{value}’ ongeldig (verwacht #RRGGBB).", "Line {line}: colour “{value}” invalid (expected #RRGGBB).", "السطر {line}: اللون «{value}» غير صالح (المتوقع #RRGGBB)."],
  chart_line_duplicate: ["Ligne {line} : référence {code} en double.", "Regel {line}: referentie {code} komt dubbel voor.", "Line {line}: reference {code} is duplicated.", "السطر {line}: المرجع {code} مكرر."],
  // Market : permissions et profils professionnels (lot 1)
  login_required: ["Connectez-vous pour continuer.", "Meld je aan om verder te gaan.", "Sign in to continue.", "سجّل الدخول للمتابعة."],
  role_required: ["Accès réservé.", "Beperkte toegang.", "Restricted access.", "وصول مقيّد."],
  seller_profile_required: ["Créez d'abord votre profil professionnel.", "Maak eerst je professionele profiel aan.", "Create your professional profile first.", "أنشئ ملفك المهني أولًا."],
  seller_profile_exists: ["Vous avez déjà un profil professionnel.", "Je hebt al een professioneel profiel.", "You already have a professional profile.", "لديك ملف مهني بالفعل."],
  seller_not_verified: ["Votre profil professionnel doit d'abord être vérifié.", "Je professionele profiel moet eerst geverifieerd worden.", "Your professional profile must be verified first.", "يجب التحقق من ملفك المهني أولًا."],
  seller_suspended: ["Votre profil professionnel est suspendu.", "Je professionele profiel is opgeschort.", "Your professional profile is suspended.", "ملفك المهني موقوف."],
  seller_not_found: ["Profil introuvable.", "Profiel niet gevonden.", "Profile not found.", "الملف غير موجود."],
  slug_taken: ["Cette adresse de profil est déjà prise.", "Dit profieladres is al in gebruik.", "This profile address is already taken.", "عنوان الملف هذا مستخدم بالفعل."],
  invalid_transition: ["Action impossible dans l'état actuel.", "Actie niet mogelijk in de huidige status.", "Action not possible in the current state.", "الإجراء غير ممكن في الحالة الحالية."],
  self_review: ["Vous ne pouvez pas examiner votre propre profil.", "Je kunt je eigen profiel niet beoordelen.", "You cannot review your own profile.", "لا يمكنك مراجعة ملفك الخاص."],
  self_role_change: ["Vous ne pouvez pas modifier vos propres rôles.", "Je kunt je eigen rollen niet wijzigen.", "You cannot change your own roles.", "لا يمكنك تعديل أدوارك الخاصة."],
  user_not_found: ["Compte introuvable.", "Account niet gevonden.", "Account not found.", "الحساب غير موجود."],
  // Détails de validation des formulaires
  v_email: ["Adresse e-mail invalide.", "Ongeldig e-mailadres.", "Invalid email address.", "عنوان بريد إلكتروني غير صالح."],
  v_required: ["Champ requis.", "Verplicht veld.", "Required field.", "حقل مطلوب."],
  v_min_chars: ["Au moins {n} caractères.", "Minstens {n} tekens.", "At least {n} characters.", "{n} أحرف على الأقل."],
  v_max_chars: ["{n} caractères au plus.", "Maximaal {n} tekens.", "{n} characters at most.", "{n} حرفًا كحد أقصى."],
  v_terms: ["Vous devez accepter les conditions d'utilisation.", "Je moet de gebruiksvoorwaarden aanvaarden.", "You must accept the terms of use.", "يجب أن توافق على شروط الاستخدام."],
  v_range: ["Valeur hors des limites autorisées.", "Waarde buiten de toegestane grenzen.", "Value outside the allowed range.", "القيمة خارج الحدود المسموح بها."],
};

export interface ApiErrorDetail {
  path?: string;
  message?: string;
  issue?: string;
  origin?: string;
  minimum?: number;
  maximum?: number;
  format?: string;
  reason?: string;
  params?: Record<string, string | number>;
}

/** Texte traduit d'un détail de validation (champ de formulaire, ligne de nuancier…). */
export function apiDetailText(t: TFn, d: ApiErrorDetail): string {
  if (d.reason && API_ERRORS[d.reason]) return t("apierr." + d.reason, d.params);
  if (d.path === "acceptTerms") return t("apierr.v_terms");
  if (d.issue === "invalid_format" && d.format === "email") return t("apierr.v_email");
  if (d.origin === "string" && d.issue === "too_small") return (d.minimum ?? 0) <= 1 ? t("apierr.v_required") : t("apierr.v_min_chars", { n: d.minimum! });
  if (d.origin === "string" && d.issue === "too_big") return t("apierr.v_max_chars", { n: d.maximum! });
  if (d.issue === "too_small" || d.issue === "too_big") return t("apierr.v_range");
  return t("apierr.validation");
}

/** Clé de traduction d'une erreur de l'API : raison précise, sinon catégorie, sinon statut HTTP. */
export function apiErrorKey(e: ApiError): string | null {
  if (e.reason && API_ERRORS[e.reason]) return e.reason;
  if (API_ERRORS[e.code]) return e.code;
  if (e.status === 413) return "too_large";
  if (e.status >= 500) return "server";
  if (e.status >= 400) return "refused";
  return null;
}

/** Message traduit pour n'importe quelle erreur levée par un appel à l'API. */
export function apiErrorText(t: TFn, e: unknown): string {
  if (!(e instanceof ApiError)) return t("common.error");
  if (e.code === "offline") return t("common.offline");
  if (e.code === "validation" && Array.isArray(e.details) && e.details[0]) return apiDetailText(t, e.details[0]);
  const k = apiErrorKey(e);
  return k ? t("apierr." + k, e.params) : t("common.error");
}
