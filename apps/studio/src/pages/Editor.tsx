import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { findMachine, objectBounds, traceOptions, type Point, type QualityIssue } from "@vyra/engine";
import { get, Icon, LangSwitch, Modal, Spinner, ThemeSwitch, useErrorText, useI18n, useSession, useToast, UserMenu } from "@vyra/ui";
import type { ProjectDTO } from "@vyra/shared";
import { useEditor, type Editor } from "../editor/useEditor.js";
import { StitchCanvas, type CanvasHandle, type Display, type Tool } from "../editor/Canvas.js";
import { AnalysisPanel, ExportPanel, HistoryPanel, LayersPanel, MachinePanel, ObjectPanel, QualityPanel, ThreadsPanel } from "../editor/panels.js";
import { fileToRaster, urlToRaster } from "../lib/image.js";
import { traceInWorker } from "../lib/trace.js";

type Tab = "object" | "layers" | "threads" | "analysis" | "machine" | "quality" | "export" | "history";
const SPEEDS = [1, 10, 50, 200, 1000];

const TOOL_ICONS: Record<Tool, string> = {
  select: "M5 3l13 8-6 1.5L9 19z",
  nodes: "M4 18L10 6l10 4M4 18h2v2H4zM9 5h2v2H9zM19 9h2v2h-2z",
  pan: "M8 13V5.5a1.5 1.5 0 013 0V12m0-6.5v-1a1.5 1.5 0 013 0V12m0-5.5a1.5 1.5 0 013 0V13m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-2a6 6 0 01-5-2.7L5 15.5a1.5 1.5 0 012.5-1.6L8 15",
  pen: "M3 21c3-1 5-3 7-7s5-8 8-10c1 2 0 4-2 6s-4 4-7 6",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
};
const KEYS: Record<string, Tool> = { v: "select", n: "nodes", h: "pan", p: "pen", r: "rect", e: "ellipse" };

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export default function EditorPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [error, setError] = useState("");
  const errText = useErrorText();
  useEffect(() => {
    setProject(null);
    get<{ project: ProjectDTO }>(`/api/projects/${id}`).then(
      (r) => setProject(r.project),
      (e) => setError(e.status === 404 ? t("ed.notFound") : errText(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (error)
    return (
      <div className="auth-shell">
        <div className="card">
          <p>{error}</p>
          <Link className="btn" to="/">
            {t("ed.projects")}
          </Link>
        </div>
      </div>
    );
  if (!project)
    return (
      <div className="auth-shell">
        <Spinner label={t("common.loading")} />
      </div>
    );
  return <EditorInner key={project.id} project={project} />;
}

function EditorInner({ project }: { project: ProjectDTO }) {
  const { t, lang } = useI18n();
  const { user, updateProfile } = useSession();
  const toast = useToast();
  const errText = useErrorText();
  const nav = useNavigate();
  const ed = useEditor(project);
  const canvas = useRef<CanvasHandle>(null);
  const desktop = useMedia("(min-width: 1200px)");
  const mobile = useMedia("(max-width: 767px)");

  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("object");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [display, setDisplay] = useState<Display>({ realistic: true, showJumps: false, mode: "thread", dimColor: null });
  const [upto, setUpto] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(50);
  const [drawColor, setDrawColor] = useState(0);
  const [marker, setMarker] = useState<Point[] | null>(null);
  const [space, setSpace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [overlay, setOverlay] = useState<HTMLImageElement | null>(null);
  const hasSource = !!(ed.settings.sourceFileId || ed.settings.demoMotif);
  useEffect(() => {
    if (!showSource || !hasSource) return setOverlay(null);
    let url = "";
    let cancelled = false;
    (async () => {
      if (ed.settings.sourceFileId) {
        const res = await fetch(`/api/files/${ed.settings.sourceFileId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        url = URL.createObjectURL(await res.blob());
      } else url = `${import.meta.env.BASE_URL}motifs/${ed.settings.demoMotif}.png`;
      const img = new Image();
      img.onload = () => !cancelled && setOverlay(img);
      img.src = url;
    })();
    return () => {
      cancelled = true;
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [showSource, hasSource, ed.settings.sourceFileId, ed.settings.demoMotif]);
  const expert = (user?.preferences?.uiMode as string) === "expert";
  const machine = findMachine(ed.machineId);
  const hoop = machine.hoops.find((h) => h.id === ed.hoopId) ?? machine.hoops[0] ?? null;
  const plan = ed.analysis?.plan ?? null;
  const total = plan?.stitches.length ?? 0;
  const errors = ed.analysis?.qc.issues.filter((i) => i.level === "error").length ?? 0;
  const warnings = ed.analysis?.qc.issues.filter((i) => i.level === "warning").length ?? 0;

  // Sélection invalide après annulation : on l'efface.
  useEffect(() => {
    if (selection && !ed.design?.objects.some((o) => o.id === selection)) setSelection(null);
  }, [ed.design, selection]);

  // Simulation
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      setUpto((u) => {
        const next = Math.min(total, (u ?? 0) + speed);
        if (next >= total) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);
  useEffect(() => {
    setUpto(null);
    setPlaying(false);
  }, [plan]);

  const newObjectName = useCallback(
    (k: "rect" | "ellipse" | "pen") => `${t("tool." + k).replace(/\s*\(.*\)$/, "")} ${(ed.design?.objects.length ?? 0) + 1}`,
    [t, ed.design],
  );

  // Raccourcis clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? ed.redo() : ed.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        ed.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        ed.saveNow().catch(() => {});
      } else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        setSpace(true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        ed.commit((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== selection) }));
        setSelection(null);
        toast(t("obj.deleted"));
      } else if (e.key === "Escape") setSelection(null);
      else if (!mod && e.key.toLowerCase() === "f") canvas.current?.fit();
      else if (!mod && KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
    };
    const onUp = (e: KeyboardEvent) => e.key === " " && setSpace(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [ed, selection, t, toast]);

  const select = (id: string | null) => {
    setSelection(id);
    setMarker(null);
    if (id && tab !== "object" && (desktop || tab === "layers")) setTab("object");
  };

  const locate = (iss: QualityIssue) => {
    if (iss.objectId) setSelection(iss.objectId);
    const o = ed.design?.objects.find((x) => x.id === iss.objectId);
    if (iss.at?.length) setMarker(iss.at);
    else if (o) {
      const b = objectBounds(o);
      setMarker([{ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }]);
    }
  };

  const runAnalysis = async (opts: Record<string, unknown>) => {
    setBusy(true);
    try {
      let raster;
      if (ed.settings.sourceFileId) {
        const res = await fetch(`/api/files/${ed.settings.sourceFileId}`, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        raster = await fileToRaster(Object.assign(blob, { name: ed.settings.sourceName ?? "source" }));
      } else if (ed.settings.demoMotif) raster = await urlToRaster(`${import.meta.env.BASE_URL}motifs/${ed.settings.demoMotif}.png`);
      else return;
      const r = await traceInWorker(raster.img, traceOptions(opts as any), ed.name);
      ed.commit(r.design);
      ed.setReport(r.report);
      ed.updateSettings({ traceOptions: opts, lastReport: r.report } as any);
      setSelection(null);
      canvas.current?.fit();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "object", label: t("tab.object") },
    ...(!desktop ? [{ id: "layers" as Tab, label: t("tab.layers") }] : []),
    { id: "threads", label: t("tab.threads") },
    { id: "analysis", label: t("tab.analysis") },
    { id: "machine", label: t("tab.machine") },
    { id: "quality", label: t("tab.quality"), badge: errors ? String(errors) : warnings ? String(warnings) : undefined },
    { id: "export", label: t("tab.export") },
    { id: "history", label: t("tab.history") },
  ];

  const panel = (
    <div className="panel-scroll" role="tabpanel">
      {tab === "object" && <ObjectPanel ed={ed} selection={selection} expert={expert} onDeleted={() => (setSelection(null), toast(t("obj.deleted")))} />}
      {tab === "layers" && <LayersPanel ed={ed} selection={selection} onSelect={select} />}
      {tab === "threads" && <ThreadsPanel ed={ed} dimColor={display.dimColor} setDimColor={(i) => setDisplay((d) => ({ ...d, dimColor: i }))} />}
      {tab === "analysis" && <AnalysisPanel ed={ed} expert={expert} onRun={runAnalysis} busy={busy} />}
      {tab === "machine" && <MachinePanel ed={ed} />}
      {tab === "quality" && <QualityPanel ed={ed} onLocate={locate} />}
      {tab === "export" && <ExportPanel ed={ed} />}
      {tab === "history" && <HistoryPanel ed={ed} />}
    </div>
  );

  const tabBar = (
    <div className="tabs" role="tablist" aria-label="Panneaux">
      {tabs.map((x) => (
        <button
          key={x.id}
          role="tab"
          aria-selected={tab === x.id}
          data-testid={"tab-" + x.id}
          onClick={() => {
            setTab(x.id);
            if (!desktop && !mobile) setSheetOpen(true);
            if (mobile) setSheetOpen(true);
          }}
        >
          {x.label}
          {x.badge && <span className={"dot " + (errors ? "error" : "warn")}>{x.badge}</span>}
        </button>
      ))}
    </div>
  );

  const saveLabel = { saved: t("ed.saved"), dirty: t("ed.unsaved"), saving: t("ed.saving"), error: t("ed.saveError"), conflict: t("ed.conflict") }[ed.saveState];
  const stats = ed.analysis?.stats;

  return (
    <div className={"editor" + (desktop ? " desktop" : mobile ? " mobile" : " tablet")} data-testid="editor">
      <header className="ed-top">
        <Link to="/" className="icon-btn" title={t("ed.projects")} aria-label={t("ed.projects")}>
          <Icon d="M15 18l-6-6 6-6" />
        </Link>
        <input
          className="name-input"
          aria-label={t("new.name")}
          defaultValue={ed.name}
          key={ed.name}
          maxLength={120}
          onBlur={(e) => e.target.value.trim() !== ed.name && ed.rename(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          data-testid="project-name"
        />
        <span className={"save-state " + ed.saveState} role="status" data-testid="save-state">
          {saveLabel}
        </span>
        <span className="spacer" />
        <button className="icon-btn" title={t("ed.undo") + " (Ctrl+Z)"} aria-label={t("ed.undo")} disabled={!ed.canUndo} onClick={ed.undo} data-testid="undo">
          <Icon d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4" />
        </button>
        <button className="icon-btn" title={t("ed.redo") + " (Ctrl+Maj+Z)"} aria-label={t("ed.redo")} disabled={!ed.canRedo} onClick={ed.redo} data-testid="redo">
          <Icon d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h4" />
        </button>
        {!mobile && (
          <div className="segmented" role="group" aria-label="Mode">
            {(["simple", "expert"] as const).map((m) => (
              <button key={m} aria-pressed={(expert ? "expert" : "simple") === m} onClick={() => updateProfile({ preferences: { uiMode: m } })}>
                {t("mode." + m)}
              </button>
            ))}
          </div>
        )}
        <button
          className={"btn " + (errors ? "" : "primary")}
          onClick={() => {
            setTab("export");
            setSheetOpen(true);
          }}
          data-testid="open-export"
        >
          {t("ed.export")}
          {errors > 0 && <span className="badge error">{errors}</span>}
        </button>
        {!mobile && <LangSwitch />}
        {!mobile && <ThemeSwitch />}
        <UserMenu links={[{ label: t("dash.title"), href: import.meta.env.BASE_URL }, { label: t("dash.account"), href: import.meta.env.BASE_URL + "account" }]} />
      </header>

      <nav className="toolrail" aria-label="Outils">
        {(Object.keys(TOOL_ICONS) as Tool[]).map((k) => (
          <button key={k} className="icon-btn" aria-pressed={tool === k} title={t("tool." + k)} aria-label={t("tool." + k)} onClick={() => setTool(k)} data-testid={"tool-" + k}>
            <Icon d={TOOL_ICONS[k]} />
          </button>
        ))}
        <span className="rail-sep" />
        <button className="icon-btn" title={t("tool.zoomIn")} aria-label={t("tool.zoomIn")} onClick={() => canvas.current?.zoom(1.25)}>
          <Icon d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M11 8v6M8 11h6" />
        </button>
        <button className="icon-btn" title={t("tool.zoomOut")} aria-label={t("tool.zoomOut")} onClick={() => canvas.current?.zoom(0.8)}>
          <Icon d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6" />
        </button>
        <button className="icon-btn" title={t("tool.fit")} aria-label={t("tool.fit")} onClick={() => canvas.current?.fit()}>
          <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </button>
        {ed.design && ed.design.threads.length > 0 && (
          <label className="draw-color" title={t("tool.drawColor")}>
            <span className="sw" style={{ background: ed.design.threads[drawColor]?.rgb }} />
            <select aria-label={t("tool.drawColor")} value={drawColor} onChange={(e) => setDrawColor(Number(e.target.value))}>
              {ed.design.threads.map((th, i) => (
                <option key={i} value={i}>
                  {i + 1}. {th.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </nav>

      {desktop && (
        <aside className="layers-col" aria-label={t("tab.layers")}>
          <h2 className="col-title">{t("tab.layers")}</h2>
          <LayersPanel ed={ed} selection={selection} onSelect={select} />
        </aside>
      )}

      <main className="stage">
        <StitchCanvas
          handle={canvas}
          design={ed.design}
          plan={plan}
          hoop={hoop}
          tool={tool}
          spaceDown={space}
          selection={selection}
          onSelect={select}
          display={display}
          upto={upto}
          drawColor={Math.min(drawColor, Math.max(0, (ed.design?.threads.length ?? 1) - 1))}
          onCommit={ed.commit}
          marker={marker}
          overlay={overlay}
          newObjectName={newObjectName}
        />
        <div className="view-opts">
          <label className="check">
            <input type="checkbox" checked={display.realistic} onChange={(e) => setDisplay((d) => ({ ...d, realistic: e.target.checked }))} />
            <span>{t("v.realistic")}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={display.showJumps} onChange={(e) => setDisplay((d) => ({ ...d, showJumps: e.target.checked }))} />
            <span>{t("v.jumps")}</span>
          </label>
          {hasSource && (
            <label className="check">
              <input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} data-testid="show-source" />
              <span>{t("v.source")}</span>
            </label>
          )}
          {expert && (
            <select className="input sm" aria-label={t("v.mode")} value={display.mode} onChange={(e) => setDisplay((d) => ({ ...d, mode: e.target.value as Display["mode"] }))}>
              {(["thread", "directions", "density", "types"] as const).map((m) => (
                <option key={m} value={m}>
                  {t("v." + m)}
                </option>
              ))}
            </select>
          )}
        </div>
        {(!ed.design || !ed.design.objects.length) && <div className="stage-empty">{t("ed.empty")}</div>}
        {busy && (
          <div className="stage-busy">
            <Spinner label={t("new.analysing")} />
          </div>
        )}
      </main>

      {desktop ? (
        <aside className="panel-col">
          {tabBar}
          {panel}
        </aside>
      ) : (
        <>
          <div className="bottom-tabs">{tabBar}</div>
          {sheetOpen && (
            <div className="sheet" role="dialog" aria-label={tabs.find((x) => x.id === tab)?.label}>
              <div className="sheet-head">
                <strong>{tabs.find((x) => x.id === tab)?.label}</strong>
                <button className="icon-btn" aria-label={t("common.close")} onClick={() => setSheetOpen(false)}>
                  <Icon d="M6 6l12 12M18 6L6 18" />
                </button>
              </div>
              {panel}
            </div>
          )}
        </>
      )}

      <footer className="simbar">
        <button className="icon-btn" aria-label={playing ? t("sim.pause") : t("sim.play")} title={playing ? t("sim.pause") : t("sim.play")} disabled={!total} onClick={() => {
          if (!playing && (upto == null || upto >= total)) setUpto(0);
          setPlaying(!playing);
        }} data-testid="sim-play">
          <Icon d={playing ? "M8 5v14M16 5v14" : "M7 4l13 8-13 8z"} />
        </button>
        <select className="input sm speed" aria-label={t("sim.speed")} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <input type="range" min={0} max={total} value={upto ?? total} aria-label={t("sim.position")} disabled={!total} onChange={(e) => {
          setPlaying(false);
          setUpto(Number(e.target.value));
        }} data-testid="sim-range" />
        <span className="num small sim-count" data-testid="sim-count">
          {(upto ?? total).toLocaleString(lang)} / {total.toLocaleString(lang)}
        </span>
        {stats && !mobile && (
          <span className="small stats" data-testid="stats">
            {t("st.summary", { s: stats.stitches.toLocaleString(lang), c: ed.design?.threads.length ?? 0, ch: stats.colorChanges, t: stats.trims, m: Math.round(stats.estMinutes) })} ·{" "}
            <span className="num">{t("st.size", { w: stats.widthMm.toFixed(1), h: stats.heightMm.toFixed(1) })}</span>
          </span>
        )}
      </footer>

      {ed.saveState === "conflict" && (
        <Modal
          title={t("ed.conflict")}
          onClose={() => {}}
          actions={
            <>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    const p = await ed.saveAsCopy();
                    nav(`/p/${p.id}`);
                  } catch (e) {
                    toast(errText(e), "error");
                  }
                }}
              >
                {t("ed.saveAsCopy")}
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  const r = await get<{ project: ProjectDTO }>(`/api/projects/${ed.id}`);
                  ed.reset(r.project);
                }}
              >
                {t("ed.reload")}
              </button>
            </>
          }
        >
          <p>{t("ed.conflictMsg")}</p>
        </Modal>
      )}
    </div>
  );
}

export type { Editor };
