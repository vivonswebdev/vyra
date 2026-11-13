import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PASSWORD_MIN, type UserDTO } from "@vyra/shared";
import { api, downloadUrl, get, post, saveBlob } from "./api.js";
import { Brand, Field, LangSwitch, Spinner, ThemeSwitch, useErrorText, useFieldErrors, useToast, Segmented } from "./components.js";
import { useI18n, type Lang } from "./i18n.js";
import { useSession, type Theme } from "./session.js";

function AuthShell({ app, title, children }: { app: string; title: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <Brand app={app} />
          <div style={{ display: "flex", gap: 6 }}>
            <LangSwitch />
            <ThemeSwitch />
          </div>
        </div>
        <section className="card" style={{ marginTop: 20 }}>
          <h1 style={{ fontSize: 24 }}>{title}</h1>
          {children}
        </section>
      </div>
    </main>
  );
}

/** Redirige vers la connexion si aucune session ; conserve la page demandée. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  const { t } = useI18n();
  if (loading)
    return (
      <div className="auth-shell">
        <Spinner label={t("common.loading")} />
      </div>
    );
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export function LoginPage({ app }: { app: string }) {
  const { t } = useI18n();
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  if (user) return <Navigate to={safeNext(params.get("next"))} replace />;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await post<{ user?: UserDTO; mfaRequired?: boolean; mfaToken?: string }>("/api/auth/login", { email: f.get("email"), password: f.get("password") });
      if (r.mfaRequired) return setMfaToken(r.mfaToken!);
      setUser(r.user!);
      nav(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const submitMfa = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const r = await post<{ user: UserDTO }>("/api/auth/login/mfa", { mfaToken, ...(useRecovery ? { recoveryCode: v } : { code: v }) });
      setUser(r.user);
      nav(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError(errText(err));
      if ((err as { status?: number }).status === 401 && /expirée/.test(errText(err))) setMfaToken(null);
    } finally {
      setBusy(false);
    }
  };
  if (mfaToken)
    return (
      <AuthShell app={app} title={t("mfa.title")}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={submitMfa} noValidate>
          <p className="muted">{t("mfa.intro")}</p>
          <Field label={useRecovery ? t("mfa.recovery") : t("mfa.code")}>
            <input
              className="input num"
              name="code"
              key={String(useRecovery)}
              autoComplete="one-time-code"
              inputMode={useRecovery ? "text" : "numeric"}
              maxLength={useRecovery ? 11 : 6}
              autoFocus
              data-testid="mfa-code"
            />
          </Field>
          <button className="btn primary block" disabled={busy}>
            {t("mfa.verify")}
          </button>
        </form>
        <div className="auth-links">
          <button className="link" onClick={() => setUseRecovery(!useRecovery)}>
            {useRecovery ? t("mfa.useApp") : t("mfa.useRecovery")}
          </button>
        </div>
      </AuthShell>
    );
  return (
    <AuthShell app={app} title={t("auth.login")}>
      {params.get("reset") === "1" && <div className="alert info">{t("auth.loginAgain")}</div>}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field label={t("auth.email")}>
          <input className="input" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("auth.password")}>
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <button className="btn primary block" disabled={busy}>
          {busy ? <Spinner /> : t("auth.login")}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/forgot-password">{t("auth.forgot")}</Link>
        <span>
          {t("auth.noAccount")} <Link to={"/signup" + (params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : "")}>{t("auth.signup")}</Link>
        </span>
      </div>
    </AuthShell>
  );
}

export function SignupPage({ app }: { app: string }) {
  const { t, lang } = useI18n();
  const { user, setUser } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const errText = useErrorText();
  const fieldErrors = useFieldErrors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState("");
  const toast = useToast();
  if (user) return <Navigate to={safeNext(params.get("next"))} replace />;
  if (sentTo)
    return (
      <AuthShell app={app} title={t("auth.checkTitle")}>
        <div className="alert ok" role="status" data-testid="signup-sent">
          {t("auth.checkInbox", { email: sentTo })}
        </div>
        <button
          className="btn"
          onClick={() => post("/api/auth/resend-verification-email", { email: sentTo }).then(() => toast(t("auth.resent")), (e) => toast(errText(e), "error"))}
        >
          {t("auth.resend")}
        </button>
        <div className="auth-links">
          <Link to="/login">{t("auth.backToLogin")}</Link>
        </div>
      </AuthShell>
    );
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setFields({});
    try {
      await post("/api/auth/signup", {
        email: f.get("email"),
        password: f.get("password"),
        displayName: f.get("displayName"),
        acceptTerms: f.get("acceptTerms") === "on",
        locale: lang,
      });
      setSentTo(String(f.get("email") ?? ""));
    } catch (err) {
      const fe = fieldErrors(err);
      setFields(fe);
      if (!Object.keys(fe).length) setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell app={app} title={t("auth.signup")}>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field label={t("auth.displayName")} error={fields.displayName}>
          <input className="input" name="displayName" autoComplete="name" required maxLength={80} />
        </Field>
        <Field label={t("auth.email")} error={fields.email}>
          <input className="input" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("auth.password")} hint={t("auth.passwordHint")} error={fields.password}>
          <input className="input" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} />
        </Field>
        <label className="check">
          <input type="checkbox" name="acceptTerms" required />
          <span>{t("auth.acceptTerms")}</span>
        </label>
        {fields.acceptTerms && (
          <p className="small" style={{ color: "var(--err)" }} role="alert">
            {fields.acceptTerms}
          </p>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? <Spinner /> : t("auth.signup")}
        </button>
      </form>
      <div className="auth-links">
        <span>
          {t("auth.haveAccount")} <Link to="/login">{t("auth.login")}</Link>
        </span>
      </div>
    </AuthShell>
  );
}

export function ForgotPasswordPage({ app }: { app: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/forgot-password", { email: new FormData(e.currentTarget).get("email") });
      setSent(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell app={app} title={t("auth.forgotTitle")}>
      {sent ? (
        <div className="alert ok" role="status">
          {t("auth.forgotSent")}
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="muted">{t("auth.forgotIntro")}</p>
          {error && <div className="alert error">{error}</div>}
          <Field label={t("auth.email")}>
            <input className="input" name="email" type="email" autoComplete="email" required />
          </Field>
          <button className="btn primary block" disabled={busy}>
            {t("auth.forgotSend")}
          </button>
        </form>
      )}
      <div className="auth-links">
        <Link to="/login">{t("auth.backToLogin")}</Link>
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPage({ app }: { app: string }) {
  const { t } = useI18n();
  const { setUser } = useSession();
  const nav = useNavigate();
  const errText = useErrorText();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await post<{ user: UserDTO | null; loginRequired?: boolean }>("/api/auth/reset-password", { token, password: new FormData(e.currentTarget).get("password") });
      if (r.loginRequired) return nav("/login?reset=1", { replace: true });
      setUser(r.user);
      nav("/", { replace: true });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell app={app} title={t("auth.resetTitle")}>
      {!token ? (
        <div className="alert error">{t("auth.resetMissing")}</div>
      ) : (
        <form onSubmit={submit} noValidate>
          {error && <div className="alert error">{error}</div>}
          <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")}>
            <input className="input" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} />
          </Field>
          <button className="btn primary block" disabled={busy}>
            {t("auth.resetSave")}
          </button>
        </form>
      )}
      <div className="auth-links">
        <Link to="/login">{t("auth.backToLogin")}</Link>
      </div>
    </AuthShell>
  );
}

export function VerifyEmailPage({ app }: { app: string }) {
  const { t } = useI18n();
  const { setUser } = useSession();
  const nav = useNavigate();
  const errText = useErrorText();
  const [params] = useSearchParams();
  const [state, setState] = useState<"busy" | "ok" | "error">("busy");
  const [error, setError] = useState("");
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    post<{ user: UserDTO | null; loginRequired?: boolean }>("/api/auth/verify-email", { token: params.get("token") ?? "" })
      .then((r) => {
        if (r.user) {
          setUser(r.user);
          return nav("/", { replace: true });
        }
        setState("ok");
      })
      .catch((e) => {
        setError(errText(e));
        setState("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AuthShell app={app} title={t("auth.verifyTitle")}>
      {state === "busy" && <Spinner label={t("auth.verifying")} />}
      {state === "ok" && (
        <div className="alert ok" role="status">
          {t("auth.verifyOk")}
        </div>
      )}
      {state === "error" && <div className="alert error">{error}</div>}
      <div className="auth-links">
        <Link to="/">{t("common.back")}</Link>
      </div>
    </AuthShell>
  );
}

export function VerifyBanner() {
  const { user } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  if (!user || user.emailVerified) return null;
  return (
    <div className="alert info" style={{ margin: 0, borderRadius: 0, borderInline: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span>{t("auth.verifyBanner")}</span>
      <button
        className="btn sm"
        onClick={() => post("/api/auth/resend-verification").then(() => toast(t("auth.resent")), () => toast(t("common.error"), "error"))}
      >
        {t("auth.resend")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Réglages du compte

export function AccountSettings() {
  const { t, lang, setLang } = useI18n();
  const { user, updateProfile, theme, setTheme } = useSession();
  const toast = useToast();
  const errText = useErrorText();
  const fieldErrors = useFieldErrors();
  const [sessions, setSessions] = useState<any[]>([]);
  const [pwError, setPwError] = useState("");
  const loadSessions = () => get<{ sessions: any[] }>("/api/me/sessions").then((r) => setSessions(r.sessions), () => {});
  useEffect(() => {
    loadSessions();
  }, []);
  if (!user) return null;
  const uiMode = (user.preferences?.uiMode as string) ?? "simple";
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <section className="card">
        <h2>{t("account.profile")}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await updateProfile({ displayName: new FormData(e.currentTarget).get("displayName") });
              toast(t("account.saved"));
            } catch (err) {
              toast(errText(err), "error");
            }
          }}
        >
          <Field label={t("auth.displayName")}>
            <input className="input" name="displayName" defaultValue={user.displayName} maxLength={80} />
          </Field>
          <Field label={t("auth.email")}>
            <input className="input" value={user.email} readOnly />
          </Field>
          <button className="btn primary">{t("common.save")}</button>
        </form>
      </section>
      <section className="card">
        <h2>{t("account.preferences")}</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <h3>{t("account.language")}</h3>
            <Segmented<Lang>
              label={t("account.language")}
              value={lang}
              onChange={(l) => {
                setLang(l);
                updateProfile({ locale: l }).catch(() => {});
              }}
              options={[
                { id: "fr", label: "Français" },
                { id: "nl", label: "Nederlands" },
                { id: "en", label: "English" },
                { id: "ar", label: "العربية" },
              ]}
            />
          </div>
          <div>
            <h3>{t("account.theme")}</h3>
            <Segmented<Theme>
              label={t("account.theme")}
              value={theme}
              onChange={setTheme}
              options={[
                { id: "auto", label: t("account.themeAuto") },
                { id: "light", label: t("account.themeLight") },
                { id: "dark", label: t("account.themeDark") },
              ]}
            />
          </div>
          <div>
            <h3>{t("account.uiMode")}</h3>
            <Segmented
              label={t("account.uiMode")}
              value={uiMode}
              onChange={(m) => updateProfile({ preferences: { uiMode: m } }).then(() => toast(t("account.saved")))}
              options={[
                { id: "simple", label: t("account.modeSimple") },
                { id: "expert", label: t("account.modeExpert") },
              ]}
            />
          </div>
        </div>
      </section>
      <section className="card">
        <h2>{t("account.security")}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            setPwError("");
            try {
              await post("/api/auth/change-password", { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") });
              form.reset();
              toast(t("account.passwordChanged"));
              loadSessions();
            } catch (err) {
              setPwError(fieldErrors(err).newPassword ?? errText(err));
            }
          }}
        >
          <h3>{t("account.changePassword")}</h3>
          {pwError && <div className="alert error">{pwError}</div>}
          <Field label={t("auth.currentPassword")}>
            <input className="input" name="currentPassword" type="password" autoComplete="current-password" />
          </Field>
          <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")}>
            <input className="input" name="newPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} />
          </Field>
          <button className="btn">{t("account.changePassword")}</button>
        </form>
        <h3 style={{ marginTop: 20 }}>{t("account.sessions")}</h3>
        <ul className="session-list" data-testid="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.device}</strong>
                {s.current && <span className="badge ok"> {t("account.current")}</span>}
                <br />
                <small className="muted">
                  {s.ip ?? "?"} · {t("account.lastSeen", { date: new Date(s.lastSeenAt).toLocaleString(lang) })}
                </small>
              </span>
              {!s.current && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    await api("DELETE", `/api/me/sessions/${s.id}`);
                    loadSessions();
                  }}
                >
                  {t("account.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          className="btn"
          disabled={sessions.length < 2}
          onClick={async () => {
            const r = await post<{ revoked: number }>("/api/me/sessions/revoke-others");
            toast(t("account.revoked", { n: r.revoked }));
            loadSessions();
          }}
        >
          {t("account.revokeOthers")}
        </button>
      </section>
      <TwoFactorSection />
      <DataSection />
    </div>
  );
}

function TwoFactorSection() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [state, setState] = useState<{ enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const load = () => get<any>("/api/me/2fa").then(setState, () => {});
  useEffect(() => {
    load();
  }, []);
  if (!state) return null;
  const run = (fn: () => Promise<void>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    try {
      await fn.call(e.currentTarget);
    } catch (err) {
      setError(errText(err));
    }
  };
  return (
    <section className="card" data-testid="mfa-section">
      <h2>{t("mfa.section")}</h2>
      {error && <div className="alert error">{error}</div>}
      {codes && (
        <div className="alert ok">
          <strong>{t("mfa.codesTitle")}</strong>
          <p className="small">{t("mfa.codesNote")}</p>
          <ul className="recovery-codes num" data-testid="recovery-codes">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button className="btn sm" onClick={() => saveBlob(new Blob([codes.join("\n") + "\n"], { type: "text/plain" }), "vyra-codes-de-secours.txt")}>
            {t("mfa.download")}
          </button>
        </div>
      )}
      {state.enabled ? (
        <>
          <p>{t("mfa.on", { date: new Date(state.enabledAt!).toLocaleDateString(lang), n: state.recoveryCodesRemaining })}</p>
          <form
            onSubmit={run(async function (this: HTMLFormElement) {
              const f = new FormData(this);
              await post("/api/me/2fa/disable", { password: f.get("password"), code: f.get("code") });
              setCodes(null);
              toast(t("mfa.disabled"));
              load();
            })}
          >
            <div className="row2">
              <Field label={t("auth.password")}>
                <input className="input" name="password" type="password" autoComplete="current-password" />
              </Field>
              <Field label={t("mfa.code")}>
                <input className="input num" name="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
              </Field>
            </div>
            <button className="btn danger sm">{t("mfa.disable")}</button>
          </form>
        </>
      ) : setup ? (
        <form
          onSubmit={run(async function (this: HTMLFormElement) {
            const r = await post<{ recoveryCodes: string[] }>("/api/me/2fa/enable", { code: new FormData(this).get("code") });
            setCodes(r.recoveryCodes);
            setSetup(null);
            toast(t("mfa.enabled"));
            load();
          })}
        >
          <p className="small">{t("mfa.scan")}</p>
          <img className="qr" alt="QR code" src={"data:image/svg+xml;base64," + btoa(setup.qrSvg)} width={180} height={180} />
          <p className="small">
            {t("mfa.key")} : <code className="num" data-testid="mfa-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          </p>
          <Field label={t("mfa.code")}>
            <input className="input num" name="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" data-testid="mfa-enable-code" />
          </Field>
          <button className="btn primary sm">{t("mfa.confirm")}</button>
        </form>
      ) : (
        <form
          onSubmit={run(async function (this: HTMLFormElement) {
            setSetup(await post("/api/me/2fa/setup", { password: new FormData(this).get("password") }));
          })}
        >
          <p className="muted">{t("mfa.off")}</p>
          <Field label={t("auth.password")}>
            <input className="input" name="password" type="password" autoComplete="current-password" data-testid="mfa-password" />
          </Field>
          <button className="btn sm">{t("mfa.start")}</button>
        </form>
      )}
    </section>
  );
}

function DataSection() {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const { setUser } = useSession();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="card" data-testid="data-section">
      <h2>{t("account.data")}</h2>
      <p className="small">{t("account.exportIntro")}</p>
      <button className="btn" data-testid="export-data" onClick={() => downloadUrl("/api/me/export", "vyra-donnees.zip").catch((e) => toast(errText(e), "error"))}>
        {t("account.export")}
      </button>
      <h3 style={{ marginTop: 20, color: "var(--err)" }}>{t("account.deleteTitle")}</h3>
      <p className="small">{t("account.deleteIntro")}</p>
      {error && <div className="alert error">{error}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setError("");
          try {
            await api("DELETE", "/api/me", { password: f.get("password"), confirm, ...(f.get("code") ? { code: f.get("code") } : {}) });
            setUser(null);
            nav("/login", { replace: true });
          } catch (err) {
            setError(errText(err));
          }
        }}
      >
        <div className="row2">
          <Field label={t("auth.password")}>
            <input className="input" name="password" type="password" autoComplete="current-password" data-testid="delete-password" />
          </Field>
          <Field label={t("mfa.code")} hint="2FA">
            <input className="input num" name="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          </Field>
        </div>
        <Field label={t("account.deleteConfirm")}>
          <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="delete-confirm" />
        </Field>
        <button className="btn danger" disabled={confirm !== "SUPPRIMER"} data-testid="delete-account">
          {t("account.deleteGo")}
        </button>
      </form>
    </section>
  );
}
