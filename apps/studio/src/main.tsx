import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@vyra/ui/tokens.css";
import "./styles.css";
import {
  AccountSettings,
  ForgotPasswordPage,
  I18nProvider,
  LoginPage,
  RequireAuth,
  ResetPasswordPage,
  SessionProvider,
  SignupPage,
  Spinner,
  ToastProvider,
  useI18n,
  VerifyBanner,
  VerifyEmailPage,
} from "@vyra/ui";
import { STUDIO_DICTS } from "./i18n.js";
import Dashboard, { StudioBar } from "./pages/Dashboard.js";

const Editor = lazy(() => import("./pages/Editor.js"));

function AccountPage() {
  const { t } = useI18n();
  return (
    <>
      <StudioBar />
      <VerifyBanner />
      <main className="page">
        <h1>{t("account.title")}</h1>
        <AccountSettings />
      </main>
    </>
  );
}

function App() {
  const app = "Studio";
  return (
    <Routes>
      <Route path="/login" element={<LoginPage app={app} />} />
      <Route path="/signup" element={<SignupPage app={app} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage app={app} />} />
      <Route path="/reset-password" element={<ResetPasswordPage app={app} />} />
      <Route path="/verify-email" element={<VerifyEmailPage app={app} />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
      <Route
        path="/p/:id"
        element={
          <RequireAuth>
            <Suspense fallback={<div className="auth-shell"><Spinner /></div>}>
              <Editor />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="*" element={<RequireAuth><Dashboard /></RequireAuth>} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/studio">
      <I18nProvider dicts={STUDIO_DICTS}>
        <SessionProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SessionProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
