import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fieldErrors } from "./api.js";
import { apiDetailText, apiErrorText } from "./api-errors.js";
import { LANG_LABELS, useI18n, type Lang } from "./i18n.js";
import { useSession, type Theme } from "./session.js";

export function Brand({ app, large, href }: { app?: string; large?: boolean; href?: string }) {
  const inner = (
    <>
      <span className="brand-word">VYRA</span>
      <span className="brand-sig">MACHINE EMBROIDERY</span>
      {app && <span className="brand-app">{app}</span>}
    </>
  );
  return href ? (
    <a className={"brand" + (large ? " large" : "")} href={href} aria-label={"VYRA " + (app ?? "")}>
      {inner}
    </a>
  ) : (
    <span className={"brand" + (large ? " large" : "")}>{inner}</span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">· {hint}</span>}
      </span>
      {children}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
  confirmDisabled,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button className="btn" data-close onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className={"btn " + (danger ? "danger" : "primary")} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
      {children}
    </Modal>
  );
}

// ---------------------------------------------------------------- Notifications

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}
const ToastCtx = createContext<(text: string, kind?: "info" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={"toast " + t.kind} role={t.kind === "error" ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Message lisible pour une erreur d'API. */
/** Message traduit d'une erreur de l'API (jamais le texte français brut du serveur). */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown) => apiErrorText(t, e);
}

/** Erreurs de validation par champ, traduites. */
export function useFieldErrors() {
  const { t } = useI18n();
  return (e: unknown) => fieldErrors(e, (d) => apiDetailText(t, d));
}

// ---------------------------------------------------------------- Langue et thème

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  const { user, updateProfile } = useSession();
  return (
    <div className="segmented" role="group" aria-label={t("account.language")} data-testid="lang-switch">
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === lang}
          onClick={() => {
            setLang(l);
            if (user) updateProfile({ locale: l }).catch(() => {});
          }}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

const THEME_ICON: Record<Theme, string> = {
  auto: "M12 3a9 9 0 100 18V3z",
  light: "M12 7a5 5 0 100 10 5 5 0 000-10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  dark: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
};

export function ThemeSwitch() {
  const { theme, setTheme } = useSession();
  const { t } = useI18n();
  const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  const label = t("account.theme") + " : " + t(theme === "auto" ? "account.themeAuto" : theme === "light" ? "account.themeLight" : "account.themeDark");
  return (
    <button className="icon-btn" type="button" title={label} aria-label={label} onClick={() => setTheme(next)} data-testid="theme-switch">
      <Icon d={THEME_ICON[theme]} />
    </button>
  );
}

export function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function UserMenu({ links = [] }: { links?: { label: string; href: string }[] }) {
  const { user, logout } = useSession();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  if (!user) return null;
  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="menu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="user-menu">
        <span aria-hidden="true" className="num">
          {initials}
        </span>
        <span className="sr-only">{user.displayName}</span>
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <div className="small muted" style={{ padding: "6px 10px" }}>
            {user.displayName}
            <br />
            {user.email}
          </div>
          <hr />
          {links.map((l) => (
            <a key={l.href} href={l.href} role="menuitem">
              {l.label}
            </a>
          ))}
          <button
            role="menuitem"
            onClick={async () => {
              await logout();
              location.reload();
            }}
          >
            {t("auth.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
