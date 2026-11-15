// Atelier vêtement : aperçu de la broderie du projet, à taille réelle, sur un vêtement simulé (T-shirt, sweat,
// hoodie), avec des textes imprimés d'aperçu. Le vêtement 3D et le patron 2D partagent la même texture : une
// impression déplacée dans une vue bouge dans l'autre. Rien n'est envoyé au serveur : la mise en scène est
// gardée dans ce navigateur, par projet.
import "@fontsource/anton/400.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/bodoni-moda/600.css";
import "@fontsource/fraunces/500-italic.css";
import "@fontsource/caveat/600.css";
import "@fontsource/jetbrains-mono/700.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { analyze, planBounds, type Design } from "@vyra/engine";
import { renderPlan } from "@vyra/engine/browser";
import { get, Icon, Segmented, Spinner, useErrorText, useI18n, useToast } from "@vyra/ui";
import type { ProjectDTO } from "@vyra/shared";
import { Atlas, FONTS, fontOf, hitTest, type AtelierLayer, type EmbroideryArt, type PrintType, type RenderMode, type TextLayer } from "../atelier/atlas.js";
import { clampToPiece, GARMENTS, layoutFor, PIECES, type GarmentId, type PieceId } from "../atelier/garments.js";
import { PatternView, type LayerPatch } from "../atelier/pattern2d.js";
import { GarmentScene, type CameraView, type SceneStats } from "../atelier/scene.js";

const COLORWAYS: { id: string; hex: string }[] = [
  { id: "ecru", hex: "#f4f2ec" }, { id: "heather", hex: "#b9bdc3" }, { id: "black", hex: "#1b1c20" }, { id: "navy", hex: "#1f2d4f" },
  { id: "forest", hex: "#2f4f3e" }, { id: "burgundy", hex: "#7e2b2e" }, { id: "lavender", hex: "#b9aed8" }, { id: "mustard", hex: "#d6b45a" },
];
const INKS = ["#fbfaf6", "#16181d", "#1f2c5c", "#c23a2b", "#2f56c9", "#e3b23c", "#e58bb0", "#2e6b45"];

interface Saved { garment: GarmentId; render: RenderMode; colorway: string; printType: PrintType; layers: AtelierLayer[] }
const storeKey = (id: string) => `vyra.atelier.${id}`;
function loadSaved(id: string): Saved | null {
  try {
    const raw = localStorage.getItem(storeKey(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!(s.garment in GARMENTS) || !Array.isArray(s.layers)) return null;
    s.layers = s.layers.filter((l) => (l.kind === "text" || l.kind === "embroidery") && PIECES.includes(l.piece));
    return s;
  } catch {
    return null;
  }
}

/** Broderie rendue point par point par le moteur, à sa taille réelle (cm). */
function embroideryArt(project: ProjectDTO | null): EmbroideryArt | null {
  if (!project?.design) return null;
  const s = project.settings ?? {};
  const plan = analyze(project.design as Design, s.machineId, s.hoopId).plan;
  if (!plan.stitches.length) return null;
  const b = planBounds(plan);
  const wMm = b.maxX - b.minX, hMm = b.maxY - b.minY;
  if (!(wMm > 0 && hMm > 0)) return null;
  const k = Math.min(6, 2400 / Math.max(wMm, hMm)); // pixels par mm
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(wMm * k);
  canvas.height = Math.ceil(hMm * k);
  renderPlan(canvas.getContext("2d")!, plan, { scale: k, ox: -b.minX * k, oy: -b.minY * k }, { realistic: true, showJumps: false });
  return { canvas, wCm: wMm / 10, hCm: hMm / 10 };
}

let nextId = 1;
const newId = (layers: AtelierLayer[]) => Math.max(nextId++, ...layers.map((l) => l.id + 1));

function Range({ id, label, min, max, step, value, format, onChange }: { id: string; label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="at-range" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <output htmlFor={id} className="num">{format(value)}</output>
    </label>
  );
}
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="at-sec">
      <h2>{title}{aside != null && <span className="num">{aside}</span>}</h2>
      {children}
    </section>
  );
}

export default function Atelier() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    get<{ project: ProjectDTO }>(`/api/projects/${id}`).then((r) => setProject(r.project), (e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (error) return <p className="page">{error}</p>;
  if (!project) return <div className="auth-shell"><Spinner /></div>;
  return <AtelierView project={project} t={t} lang={lang} toast={toast} />;
}

function AtelierView({ project, t, lang, toast }: { project: ProjectDTO; t: ReturnType<typeof useI18n>["t"]; lang: string; toast: (m: string) => void }) {
  const saved = useMemo(() => loadSaved(project.id), [project.id]);
  const art = useMemo(() => embroideryArt(project), [project]);
  const [garmentId, setGarmentId] = useState<GarmentId>(saved?.garment ?? "tee");
  const [render, setRender] = useState<RenderMode>(saved?.render ?? "blueprint");
  const [colorway, setColorway] = useState(saved?.colorway ?? COLORWAYS[0].hex);
  const [printType, setPrintType] = useState<PrintType>(saved?.printType ?? "screen");
  const garment = GARMENTS[garmentId];
  const layout = useMemo(() => layoutFor(garment), [garment]);
  const [layers, setLayers] = useState<AtelierLayer[]>(() => {
    if (saved) return saved.layers;
    const g = GARMENTS.tee;
    const out: AtelierLayer[] = [];
    if (art) out.push({ id: 1, kind: "embroidery", piece: "front", x: 0, y: g.neckDrop + 6 + art.hCm / 2, rotate: 0, visible: true });
    out.push({ id: 2, kind: "text", piece: "back", x: 0, y: 9, rotate: 0, visible: true, text: project.name.toUpperCase(), font: "mono", layout: "box", align: "center", cap: 0.7, width: 30, bend: 0.3, leading: 1.2, tracking: 0.12, ink: "#1f2c5c", opacity: 1 });
    return out;
  });
  const [selected, setSelected] = useState<number | null>(() => layers[0]?.id ?? null);
  const [mode, setMode] = useState<"pull" | "move">("pull");
  const [turntable, setTurntable] = useState(false);
  const [breeze, setBreeze] = useState(false);
  const [view, setView] = useState<CameraView | null>("front");
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const [fontsTick, setFontsTick] = useState(0);
  const [scale2d, setScale2d] = useState(0);

  const c3d = useRef<HTMLCanvasElement>(null);
  const c2d = useRef<HTMLCanvasElement>(null);
  const atlas = useMemo(() => new Atlas(), []);
  const scene = useRef<GarmentScene | null>(null);
  const pattern = useRef<PatternView | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const moveOffset = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const fmt = useCallback((v: number, d = 1) => v.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d }), [lang]);
  const fabric = t(garment.fabric);

  const edit = useCallback((lid: number, patch: LayerPatch) => {
    setLayers((ls) => ls.map((l) => {
      if (l.id !== lid) return l;
      const n = { ...l, ...patch } as AtelierLayer;
      const box = atlas.boxes.get(lid);
      [n.x, n.y] = clampToPiece(layoutRef.current, n.piece, n.x, n.y, n.kind === "embroidery" ? box?.w : 0, n.kind === "embroidery" ? box?.h : 0);
      return n;
    }));
  }, [atlas]);

  // Vues : création unique, destruction au départ de la page.
  useEffect(() => {
    const pv = new PatternView(c2d.current!);
    pv.onPick = (lid) => setSelected(lid);
    pv.onEdit = (lid, patch) => edit(lid, patch);
    pattern.current = pv;
    let sc: GarmentScene | null = null;
    try {
      sc = new GarmentScene(c3d.current!, atlas);
      sc.onStats = setStats;
      sc.onViewChange = setView;
      sc.onPrint = (phase, at) => {
        if (phase === "down") {
          if (!at) return false;
          const hit = hitTest(layersRef.current, atlas.boxes, at.piece, at.x, at.y);
          if (!hit) return false;
          setSelected(hit.id);
          moveOffset.current = { id: hit.id, dx: hit.x - at.x, dy: hit.y - at.y };
          return true;
        }
        if (phase === "move" && at && moveOffset.current) {
          const m = moveOffset.current, L = layersRef.current.find((l) => l.id === m.id);
          if (L && L.piece === at.piece) edit(m.id, { x: at.x + m.dx, y: at.y + m.dy });
        }
        if (phase === "up") moveOffset.current = null;
      };
      sc.start();
      scene.current = sc;
    } catch {
      setNoWebgl(true);
    }
    // Polices des textes : le dessin sur canvas les attend.
    let alive = true;
    Promise.all(FONTS.map((f) => document.fonts.load(`${f.style} ${f.weight} 100px ${f.css.split(",")[0]}`).catch(() => null))).then(() => alive && setFontsTick((n) => n + 1));
    return () => {
      alive = false;
      pv.dispose();
      sc?.dispose();
      scene.current = null;
      pattern.current = null;
    };
  }, [atlas, edit]);

  useEffect(() => {
    scene.current?.setGarment(garment, layout);
    setLayers((ls) => ls.map((l) => {
      const box = atlas.boxes.get(l.id);
      const [x, y] = clampToPiece(layout, l.piece, l.x, l.y, l.kind === "embroidery" ? box?.w : 0, l.kind === "embroidery" ? box?.h : 0);
      return x === l.x && y === l.y ? l : { ...l, x, y };
    }));
  }, [garment, layout, atlas]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.mode = mode; s.turntable = turntable; s.breeze = breeze;
    s.setCordColor(render === "blueprint" ? "#e6ebf2" : colorway);
    s.setRelief(printType === "puff");
  }, [mode, turntable, breeze, render, colorway, printType]);

  // Texture et patron : redessinés à chaque changement.
  useEffect(() => {
    atlas.render({
      garment, layout, render, colorway, printType, layers, embroidery: art,
      labels: { front: t("at.sheetFront", { fabric: fabric.toUpperCase() }), back: t("at.sheetBack", { fabric: fabric.toUpperCase() }) },
    });
    const pv = pattern.current;
    if (pv) {
      pv.set({
        garment, layout, atlas, layers, selected, hoodFill: render === "blueprint" ? "#fbfcfd" : colorway,
        labels: {
          front: t("at.labelFront"), back: t("at.labelBack"), hood: t("at.labelHood"),
          frontInfo: t("at.labelInfo", { n: 1, fabric: fabric.toUpperCase(), h: garment.H }),
          backInfo: t("at.labelInfo", { n: 2, fabric: fabric.toUpperCase(), h: garment.H }),
        },
      });
      setScale2d(pv.scale);
    }
  }, [atlas, garment, layout, render, colorway, printType, layers, art, selected, fontsTick, t, fabric]);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(project.id), JSON.stringify({ garment: garmentId, render, colorway, printType, layers } satisfies Saved));
    } catch {
      /* stockage indisponible : la mise en scène n'est simplement pas gardée */
    }
  }, [project.id, garmentId, render, colorway, printType, layers]);

  const sel = layers.find((l) => l.id === selected) ?? null;
  const box = sel ? atlas.boxes.get(sel.id) : undefined;
  const patch = (p: Partial<TextLayer>) => sel && setLayers((ls) => ls.map((l) => (l.id === sel.id ? ({ ...l, ...p } as AtelierLayer) : l)));
  const add = (L: AtelierLayer) => { setLayers((ls) => [...ls, L]); setSelected(L.id); };
  const addEmbroidery = () => art && add({ id: newId(layers), kind: "embroidery", piece: "front", x: 0, y: garment.neckDrop + 6 + art.hCm / 2, rotate: 0, visible: true });
  const addText = () => add({ id: newId(layers), kind: "text", piece: "front", x: 0, y: Math.min(garment.H - 12, 38), rotate: 0, visible: true, text: t("at.newText"), font: "anton", layout: "box", align: "center", cap: 2.4, width: 26, bend: 0.3, leading: 1.15, tracking: 0.02, ink: "#1f2c5c", opacity: 1 });
  const reorder = (dir: 1 | -1) => setLayers((ls) => {
    const i = ls.findIndex((l) => l.id === selected), j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return ls;
    const n = [...ls];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const layerName = (l: AtelierLayer) => (l.kind === "embroidery" ? t("at.embroidery") : l.text.replace(/\s+/g, " ") || t("at.text"));
  const cm = (v: number) => `${fmt(v)} cm`;

  return (
    <div className="atelier" data-testid="atelier">
      <header className="ed-top at-top">
        <Link to={`/p/${project.id}`} className="icon-btn" title={t("at.back")} aria-label={t("at.back")}>
          <Icon d="M15 18l-6-6 6-6" />
        </Link>
        <h1 className="at-title">{t("at.title")} <span className="muted">· {project.name}</span></h1>
        <span className="spacer" />
        <div className="at-controls">
          <Segmented label={t("at.garment")} value={garmentId} onChange={(v) => { setGarmentId(v); toast(t("at.dropped")); }} options={(Object.keys(GARMENTS) as GarmentId[]).map((g) => ({ id: g, label: t("at.g." + g) }))} />
          <Segmented label={t("at.render")} value={render} onChange={setRender} options={[{ id: "blueprint", label: t("at.r.blueprint") }, { id: "fabric", label: t("at.r.fabric") }]} />
          <Segmented label={t("at.print")} value={printType} onChange={setPrintType} options={[{ id: "screen", label: t("at.p.screen") }, { id: "puff", label: t("at.p.puff") }]} />
          <div className="at-swatches" role="group" aria-label={t("at.colorway")}>
            {COLORWAYS.map((c) => (
              <button key={c.id} type="button" className="at-sw" style={{ background: c.hex }} title={t("at.cw." + c.id)} aria-label={t("at.cw." + c.id)} aria-pressed={c.hex === colorway}
                onClick={() => { setColorway(c.hex); setRender("fabric"); }} />
            ))}
          </div>
        </div>
      </header>

      <div className="at-body">
        <aside className="at-side">
          <Section title={t("at.add")}>
            <div className="at-row2">
              <button type="button" className="btn sm" onClick={addEmbroidery} disabled={!art} data-testid="at-add-emb">{t("at.addEmb")}</button>
              <button type="button" className="btn sm" onClick={addText} data-testid="at-add-text">{t("at.addText")}</button>
            </div>
            {!art && <p className="small muted">{t("at.embEmpty")}</p>}
          </Section>
          <Section title={t("at.layers")} aside={layers.length}>
            <ul className="at-layers" data-testid="at-layers">
              {[...layers].reverse().map((l) => (
                <li key={l.id} className={l.id === selected ? "sel" : ""}>
                  <button type="button" className="at-layer" onClick={() => setSelected(l.id)} aria-pressed={l.id === selected}>
                    <span aria-hidden="true">{l.kind === "embroidery" ? "✶" : "T"}</span>
                    <span className="nm">{layerName(l)}</span>
                    <span className="pc">{t("at.pc." + l.piece)}</span>
                  </button>
                  <button type="button" className={"at-eye" + (l.visible ? "" : " off")} aria-label={l.visible ? t("at.hide") : t("at.show")}
                    onClick={() => setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)))} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t("at.selected")}>
            {!sel ? <p className="small muted">{t("at.none")}</p> : (
              <div className="at-props" data-testid="at-props">
                <Segmented label={t("at.piece")} value={sel.piece} options={PIECES.map((p) => ({ id: p, label: t("at.pc." + p) }))}
                  onChange={(p: PieceId) => {
                    const r = layout.regions[p], sleeve = p.startsWith("sleeve");
                    patch({ piece: p, x: sleeve ? r.w / 8 : 0, y: Math.min(sel.y, r.h * 0.5), rotate: sleeve ? 90 : 0 });
                  }} />
                <p className="small muted num">{t("at.coords", { x: fmt(sel.x), y: fmt(sel.y) })}</p>
                {sel.kind === "embroidery" ? (
                  <p className="small">{t("at.embSize", { w: fmt(box?.w ?? art?.wCm ?? 0), h: fmt(box?.h ?? art?.hCm ?? 0) })}</p>
                ) : (
                  <>
                    <label className="at-field">
                      <span>{t("at.text")}</span>
                      <textarea id="at-text" className="input" value={sel.text} rows={3} maxLength={400} onChange={(e) => patch({ text: e.target.value })} data-testid="at-text" />
                    </label>
                    <div className="at-fonts" role="group" aria-label={t("at.font")}>
                      {FONTS.map((f) => (
                        <button key={f.id} type="button" aria-pressed={f.id === sel.font} onClick={() => patch({ font: f.id })} style={{ fontFamily: f.css, fontWeight: Number(f.weight), fontStyle: f.style }}>
                          {fontOf(f.id).name}
                        </button>
                      ))}
                    </div>
                    <Segmented label={t("at.layout")} value={sel.layout} onChange={(v) => patch({ layout: v })} options={[{ id: "box", label: t("at.l.box") }, { id: "arc", label: t("at.l.arc") }, { id: "circle", label: t("at.l.circle") }]} />
                    {sel.layout === "box" && (
                      <Segmented label={t("at.align")} value={sel.align} onChange={(v) => patch({ align: v })} options={(["left", "center", "right", "justify"] as const).map((a) => ({ id: a, label: t("at.a." + a) }))} />
                    )}
                    <Range id="at-cap" label={t("at.cap")} min={0.3} max={12} step={0.1} value={sel.cap} format={cm} onChange={(v) => patch({ cap: v })} />
                    {sel.layout !== "arc" && <Range id="at-width" label={t(sel.layout === "circle" ? "at.diameter" : "at.width")} min={4} max={50} step={0.5} value={sel.width} format={cm} onChange={(v) => patch({ width: v })} />}
                    {sel.layout === "arc" && <Range id="at-bend" label={t("at.bend")} min={-1} max={1} step={0.01} value={sel.bend} format={(v) => fmt(v, 2)} onChange={(v) => patch({ bend: v })} />}
                    {sel.layout !== "arc" && <Range id="at-leading" label={t("at.leading")} min={0.7} max={2.2} step={0.01} value={sel.leading} format={(v) => fmt(v, 2)} onChange={(v) => patch({ leading: v })} />}
                    <Range id="at-tracking" label={t("at.tracking")} min={-0.08} max={0.5} step={0.01} value={sel.tracking} format={(v) => fmt(v, 2)} onChange={(v) => patch({ tracking: v })} />
                    <div className="at-inks" role="group" aria-label={t("at.ink")}>
                      {INKS.map((c) => <button key={c} type="button" className="at-sw" style={{ background: c }} aria-label={`${t("at.ink")} ${c}`} aria-pressed={c === sel.ink} onClick={() => patch({ ink: c })} />)}
                      <input type="color" id="at-ink" value={sel.ink} aria-label={t("at.inkCustom")} onChange={(e) => patch({ ink: e.target.value })} />
                    </div>
                    <Range id="at-opacity" label={t("at.opacity")} min={0.1} max={1} step={0.01} value={sel.opacity} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch({ opacity: v })} />
                  </>
                )}
                <Range id="at-rotate" label={t("at.rotate")} min={-180} max={180} step={1} value={sel.rotate} format={(v) => `${Math.round(v)}°`} onChange={(v) => patch({ rotate: v })} />
                <div className="at-row2">
                  <button type="button" className="btn sm" onClick={() => edit(sel.id, { x: sel.piece.startsWith("sleeve") ? layout.regions[sel.piece].w / 8 : 0 })}>{t("at.center")}</button>
                  <button type="button" className="btn sm" onClick={() => add({ ...sel, id: newId(layers), y: Math.min(sel.y + 4, layout.regions[sel.piece].h - 2) })}>{t("at.duplicate")}</button>
                  <button type="button" className="btn sm" onClick={() => reorder(1)}>{t("at.forward")}</button>
                  <button type="button" className="btn sm" onClick={() => reorder(-1)}>{t("at.backward")}</button>
                  <button type="button" className="btn sm danger" onClick={() => { setLayers((ls) => ls.filter((l) => l.id !== sel.id)); setSelected(null); toast(t("at.deleted")); }}>{t("at.delete")}</button>
                </div>
              </div>
            )}
          </Section>
          <p className="small muted at-note">{t("at.note")}</p>
        </aside>

        <main className="at-main">
          <section className="at-view at-v3" aria-label={t("at.view3d")}>
            <div className="at-vhead">
              <h2>{t("at.view3d")} <small>{t("at.view3dSub")}</small></h2>
              <Segmented label={t("at.mode")} value={mode} onChange={setMode} options={[{ id: "pull", label: t("at.pull") }, { id: "move", label: t("at.move") }]} />
            </div>
            <canvas ref={c3d} className="at-canvas" data-testid="at-3d" aria-label={`${t("at.view3d")} — ${t("at.hint3d")}`} />
            {noWebgl ? <p className="alert info at-overlay">{t("at.noWebgl")}</p> : (
              <>
                <div className="at-cams">
                  <Segmented label={t("at.camera")} value={view ?? ("" as CameraView)} onChange={(v) => { scene.current?.view(v); setView(v); setTurntable(false); }}
                    options={(["front", "side", "back"] as const).map((v) => ({ id: v, label: t("at.cam." + v) }))} />
                  <div className="segmented" role="group" aria-label={t("at.camera")}>
                    <button type="button" aria-pressed={turntable} onClick={() => { setTurntable(!turntable); setView(null); }}>{t("at.turntable")}</button>
                    <button type="button" aria-pressed={breeze} onClick={() => setBreeze(!breeze)}>{t("at.breeze")}</button>
                  </div>
                  <button type="button" className="btn sm" onClick={() => { scene.current?.redrape(); toast(t("at.dropped")); }} data-testid="at-redrape">{t("at.redrape")}</button>
                </div>
                {stats && (
                  <p className="at-stats num small">
                    {t("at.g." + garmentId)} · {fabric} · {t("at.stats", { n: stats.nodes.toLocaleString(lang), c: stats.constraints.toLocaleString(lang), ms: fmt(stats.solverMs), fps: stats.fps })}
                  </p>
                )}
              </>
            )}
          </section>
          <section className="at-view at-v2" aria-label={t("at.pattern")}>
            <div className="at-vhead">
              <h2>{t("at.pattern")} <small className="num">{t("at.scale", { k: fmt(scale2d) })}</small></h2>
              <button type="button" className="btn sm" onClick={() => { pattern.current?.fit(); pattern.current?.draw(); }}>{t("at.fit")}</button>
            </div>
            <canvas ref={c2d} className="at-canvas" data-testid="at-2d" aria-label={t("at.pattern")} />
          </section>
        </main>
      </div>
    </div>
  );
}
