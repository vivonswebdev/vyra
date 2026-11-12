import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UserDTO } from "@vyra/shared";
import { get, patch, post } from "./api.js";
import { useI18n, type Lang } from "./i18n.js";

export type Theme = "auto" | "light" | "dark";
const THEME_KEY = "vyra.theme";

interface SessionCtx {
  user: UserDTO | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: UserDTO | null) => void;
  logout: () => Promise<void>;
  theme: Theme;
  setTheme: (t: Theme) => void;
  updateProfile: (p: Record<string, unknown>) => Promise<UserDTO>;
}

const Ctx = createContext<SessionCtx | null>(null);

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark" || t === "auto") return t;
  } catch {}
  return "auto";
}

/** Applique le thème : « auto » suit le réglage de l'appareil et ses changements. */
export function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "auto" && !!mq?.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    mq?.addEventListener?.("change", apply);
    return () => mq?.removeEventListener?.("change", apply);
  }, [theme]);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const { lang, setLang } = useI18n();
  useApplyTheme(theme);

  const refresh = useCallback(async () => {
    try {
      const r = await get<{ user: UserDTO | null }>("/api/auth/me");
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Les préférences du compte priment sur celles de l'appareil à la connexion.
  useEffect(() => {
    if (!user) return;
    if (user.locale && user.locale !== lang) setLang(user.locale as Lang);
    if (user.theme && user.theme !== theme) setThemeLocal(user.theme as Theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const setThemeLocal = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  };

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeLocal(t);
      if (user) patch("/api/me", { theme: t }).catch(() => {});
    },
    [user],
  );

  const logout = useCallback(async () => {
    await post("/api/auth/logout").catch(() => {});
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (p: Record<string, unknown>) => {
    const r = await patch<{ user: UserDTO }>("/api/me", p);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, setUser, logout, theme, setTheme, updateProfile }),
    [user, loading, refresh, logout, theme, setTheme, updateProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider manquant");
  return c;
}
