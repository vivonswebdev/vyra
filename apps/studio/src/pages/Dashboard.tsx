import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { DEMO_COLORS, DEMO_MOTIFS, nearestPecThread, traceOptions, type Design } from "@vyra/engine";
import { api, Brand, ConfirmDialog, del, get, LangSwitch, Modal, patch, post, Spinner, ThemeSwitch, useErrorText, useI18n, useToast, UserMenu, VerifyBanner } from "@vyra/ui";
import type { ProjectDTO, ProjectSummaryDTO } from "@vyra/shared";
import { ACCEPT, fileToRaster, isSupported, MAX_UPLOAD, urlToRaster } from "../lib/image.js";
import { traceInWorker } from "../lib/trace.js";

const BASE = import.meta.env.BASE_URL;

export function StudioBar({ onNew }: { onNew?: () => void }) {
  const { t } = useI18n();
  return (
    <header className="appbar">
      <Brand app={"Studio · " + t("studio.app")} href={BASE} />
      <span className="spacer" />
      {onNew && (
        <button className="btn primary" onClick={onNew} data-testid="new-design">
          {t("dash.new")}
        </button>
      )}
      <LangSwitch />
      <ThemeSwitch />
      <UserMenu links={[{ label: t("dash.title"), href: BASE }, { label: t("dash.account"), href: BASE + "account" }]} />
    </header>
  );
}

export default function Dashboard() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const nav = useNavigate();
  const [trash, setTrash] = useState(false);
  const [items, setItems] = useState<ProjectSummaryDTO[] | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummaryDTO | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummaryDTO | null>(null);
  const [confirmName, setConfirmName] = useState("");

  const load = () =>
    get<{ projects: ProjectSummaryDTO[] }>("/api/projects" + (trash ? "?trash=1" : "")).then(
      (r) => setItems(r.projects),
      (e) => toast(errText(e), "error"),
    );
  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trash]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      load();
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const shown = (items ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <StudioBar onNew={() => setCreating(true)} />
      <VerifyBanner />
      <main className="page">
        <div className="dash-head">
          <h1>{t("dash.title")}</h1>
          <div className="segmented" role="tablist">
            <button role="tab" aria-pressed={!trash} aria-selected={!trash} onClick={() => setTrash(false)}>
              {t("dash.projects")}
            </button>
            <button role="tab" aria-pressed={trash} aria-selected={trash} onClick={() => setTrash(true)} data-testid="trash-tab">
              {t("dash.trash")}
            </button>
          </div>
          <input className="input search" type="search" placeholder={t("dash.search")} aria-label={t("dash.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {items === null ? (
          <Spinner label={t("common.loading")} />
        ) : shown.length === 0 ? (
          <div className="empty card">
            <p>{trash ? t("dash.trashEmpty") : t("dash.empty")}</p>
            {!trash && (
              <button className="btn primary" onClick={() => setCreating(true)}>
                {t("dash.new")}
              </button>
            )}
          </div>
        ) : (
          <ul className="project-grid" data-testid="project-list">
            {shown.map((p) => (
              <li key={p.id} className="project-card">
                <button className="thumb" onClick={() => !trash && nav(`/p/${p.id}`)} disabled={trash} aria-label={`${t("dash.open")} ${p.name}`}>
                  {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" loading="lazy" /> : <span className="muted small">{t("dash.noDesign")}</span>}
                </button>
                <div className="project-meta">
                  <strong className="project-name">{p.name}</strong>
                  {p.stats && (
                    <span className="small muted num">
                      {t("dash.stats", { objects: p.stats.objects, colors: p.stats.colors, w: p.stats.widthMm, h: p.stats.heightMm })}
                    </span>
                  )}
                  <span className="small muted">{t("dash.updated", { date: new Date(trash ? p.deletedAt! : p.updatedAt).toLocaleString(lang) })}</span>
                </div>
                <div className="project-actions">
                  {trash ? (
                    <>
                      <button className="btn sm" onClick={() => act(() => post(`/api/projects/${p.id}/restore`), t("dash.restored"))}>
                        {t("dash.restore")}
                      </button>
                      <button
                        className="btn sm danger"
                        onClick={() => {
                          setConfirmName("");
                          setDeleting(p);
                        }}
                      >
                        {t("dash.deleteForever")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn sm primary" onClick={() => nav(`/p/${p.id}`)}>
                        {t("dash.open")}
                      </button>
                      <button className="btn sm" onClick={() => setRenaming(p)}>
                        {t("dash.rename")}
                      </button>
                      <button className="btn sm" onClick={() => act(() => post(`/api/projects/${p.id}/duplicate`), t("dash.duplicated"))}>
                        {t("dash.duplicate")}
                      </button>
                      <button className="btn sm" onClick={() => act(() => del(`/api/projects/${p.id}`), t("dash.trashed"))} data-testid="to-trash">
                        {t("dash.toTrash")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      {creating && <NewDesignDialog onClose={() => setCreating(false)} />}
      {renaming && (
        <Modal
          title={t("dash.rename")}
          onClose={() => setRenaming(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn primary" form="rename-form">
                {t("common.save")}
              </button>
            </>
          }
        >
          <form
            id="rename-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              const p = renaming;
              setRenaming(null);
              if (name && name !== p.name) await act(() => patch(`/api/projects/${p.id}`, { baseRevision: p.revision, name }), t("account.saved"));
            }}
          >
            <label className="field">
              <span>{t("dash.newName")}</span>
              <input className="input" name="name" defaultValue={renaming.name} maxLength={120} />
            </label>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title={t("dash.deleteForever")}
          message={t("dash.deleteForeverMsg", { name: deleting.name })}
          confirmLabel={t("dash.deleteForever")}
          danger
          confirmDisabled={confirmName !== deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const p = deleting;
            setDeleting(null);
            act(() => api("DELETE", `/api/projects/${p.id}/permanent`, { confirmName }), t("dash.deleted"));
          }}
        >
          <input className="input" style={{ marginTop: 12 }} aria-label={t("new.name")} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} data-testid="confirm-name" />
        </ConfirmDialog>
      )}
    </>
  );
}

function NewDesignDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const projInput = useRef<HTMLInputElement>(null);

  const create = async (body: { name: string; design: Design | null; settings: Record<string, unknown> }, source?: File) => {
    const r = await post<{ project: ProjectDTO }>("/api/projects", body);
    if (source) {
      const fd = new FormData();
      fd.append("file", source, source.name);
      const up = await api<{ file: { id: string } }>("POST", `/api/projects/${r.project.id}/source`, fd);
      await patch(`/api/projects/${r.project.id}`, { baseRevision: r.project.revision, settings: { ...body.settings, sourceFileId: up.file.id } });
    }
    nav(`/p/${r.project.id}`);
  };

  const fromFile = async (file: File) => {
    setError("");
    if (file.size > MAX_UPLOAD) return setError(t("new.tooBig"));
    if (!isSupported(file)) return setError(t("new.badFormat"));
    setBusy(true);
    try {
      const { img } = await fileToRaster(file);
      const projName = (name.trim() || file.name.replace(/\.[^.]+$/, "")).slice(0, 120);
      const options = traceOptions({ colors: 6 });
      const r = await traceInWorker(img, options, projName);
      await create({ name: projName, design: r.design, settings: { machineId: "brother-xe1", hoopId: "sa439s", traceOptions: { colors: 6, targetWidthMm: 100 }, sourceName: file.name, lastReport: r.report } }, file);
    } catch (e) {
      setError(errText(e) === t("common.error") ? String((e as Error).message ?? e) : errText(e));
      setBusy(false);
    }
  };

  const fromDemo = async (m: string) => {
    setBusy(true);
    setError("");
    try {
      const { img } = await urlToRaster(`${BASE}motifs/${m}.png`);
      const colors = DEMO_COLORS[m] ?? 6;
      const r = await traceInWorker(img, traceOptions({ colors }), m);
      await create({ name: (name.trim() || t("demo." + m)).slice(0, 120), design: r.design, settings: { machineId: "brother-xe1", hoopId: "sa439s", demoMotif: m, traceOptions: { colors, targetWidthMm: 100 }, lastReport: r.report } });
    } catch (e) {
      toast(errText(e), "error");
      setBusy(false);
    }
  };

  const blank = async () => {
    setBusy(true);
    const projName = (name.trim() || t("new.blank")).slice(0, 120);
    const th = nearestPecThread("#5a3a28");
    try {
      await create({ name: projName, design: { name: projName, widthMm: 100, heightMm: 100, threads: [{ rgb: th.rgb, name: th.name, brand: th.brand, code: th.code }], objects: [] }, settings: { machineId: "brother-xe1", hoopId: "sa439s" } });
    } catch (e) {
      toast(errText(e), "error");
      setBusy(false);
    }
  };

  const fromProjectFile = async (file: File) => {
    setError("");
    if (file.size > 12 * 1024 * 1024) return setError(t("new.tooBig"));
    let design: Design;
    try {
      design = JSON.parse(await file.text());
      if (!design || !Array.isArray(design.objects) || !Array.isArray(design.threads)) throw new Error();
    } catch {
      return setError(t("new.badProject"));
    }
    setBusy(true);
    try {
      const projName = (name.trim() || design.name || file.name.replace(/\.stitch\.json$|\.json$/i, "")).slice(0, 120);
      await create({ name: projName, design, settings: { machineId: "brother-xe1", hoopId: "sa439s", importedFrom: file.name.slice(0, 200) } });
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) (/\.json$/i.test(f.name) ? fromProjectFile(f) : fromFile(f));
  };

  return (
    <Modal title={t("new.title")} onClose={() => !busy && onClose()} wide>
      {busy ? (
        <div style={{ padding: 32, textAlign: "center" }}>
          <Spinner label={t("new.analysing")} />
        </div>
      ) : (
        <>
          <label className="field">
            <span>{t("new.name")}</span>
            <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="new-name" />
          </label>
          {error && <div className="alert error">{error}</div>}
          <div className="new-grid">
            <div
              className={"dropzone" + (over ? " over" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <h3>{t("new.fromImage")}</h3>
              <p className="small muted">{t("new.formats")}</p>
              <button className="btn primary" onClick={() => input.current?.click()}>
                {t("new.fromImage")}
              </button>
              <input ref={input} type="file" accept={ACCEPT} hidden data-testid="file-input" onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
            </div>
            <div className="blank-card">
              <h3>{t("new.importProject")}</h3>
              <p className="small muted">{t("new.importHint")}</p>
              <button className="btn" onClick={() => projInput.current?.click()}>
                {t("new.importProject")}
              </button>
              <input ref={projInput} type="file" accept=".json,application/json" hidden data-testid="project-file-input" onChange={(e) => e.target.files?.[0] && fromProjectFile(e.target.files[0])} />
            </div>
            <div className="blank-card">
              <h3>{t("new.blank")}</h3>
              <p className="small muted">{t("new.blankHint")}</p>
              <button className="btn" onClick={blank} data-testid="new-blank">
                {t("new.blank")}
              </button>
            </div>
          </div>
          <h3 style={{ marginTop: 16 }}>{t("new.fromDemo")}</h3>
          <ul className="demo-grid">
            {DEMO_MOTIFS.map((m) => (
              <li key={m}>
                <button onClick={() => fromDemo(m)} data-testid={"demo-" + m}>
                  <img src={`${BASE}motifs/${m}.png`} alt="" />
                  <span>{t("demo." + m)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
