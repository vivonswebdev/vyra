// Panneaux contextuels du Studio. Chaque commande modifie le document par le moteur,
// en une étape d'historique ; aucune commande n'est décorative.
import { useEffect, useMemo, useState } from "react";
import {
  matchChartEntries,
  PEC_CHART,
  findMachine,
  MACHINES,
  nearestPecThread,
  objectCenter,
  mapObjectPoints,
  planToSvg,
  qcLabel,
  stitchThreadIndex,
  stitchTypesFor,
  summarizeRegistry,
  translateIssue,
  translateStrategy,
  STITCH,
  type Design,
  type DesignObject,
  type ExportFormat,
  type Point,
  type QualityIssue,
  type StitchType,
  type Thread,
} from "@vyra/engine";
import { planToPngBlob } from "@vyra/engine/browser";
import registry from "@vyra/engine/fixtures/xe1-essais.json";
import { ConfirmDialog, del, downloadUrl, get, post, saveBlob, useErrorText, useI18n, useToast, type Lang } from "@vyra/ui";
import type { ExportDTO, ProjectDTO, ProjectVersionDTO } from "@vyra/shared";
import type { Editor } from "./useEditor.js";

const fmt = (n: number, lang: string, d = 1) => n.toLocaleString(lang === "ar" ? "ar-u-nu-latn" : lang, { maximumFractionDigits: d, minimumFractionDigits: 0 });

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  testId?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (!Number.isFinite(v)) return setText(String(value));
    const c = Math.min(max, Math.max(min, Math.round(v / step) * step));
    const r = Number(c.toFixed(4));
    setText(String(r));
    if (r !== value) onChange(r);
  };
  return (
    <label className="numfield">
      <span>{label}</span>
      <span className="numfield-input">
        <input
          className="input num"
          inputMode="decimal"
          value={text}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const v = Math.min(max, Math.max(min, value + (e.key === "ArrowUp" ? step : -step)));
              onChange(Number(v.toFixed(4)));
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

function updateObject(ed: Editor, id: string, fn: (o: DesignObject) => DesignObject) {
  ed.commit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? fn(o) : o)) }));
}

// ---------------------------------------------------------------- Objet

export function ObjectPanel({ ed, selection, expert, onDeleted }: { ed: Editor; selection: string | null; expert: boolean; onDeleted: () => void }) {
  const { t } = useI18n();
  const o = ed.design?.objects.find((x) => x.id === selection);
  const [scale, setScale] = useState(100);
  const [rot, setRot] = useState(0);
  if (!ed.design || !o) return <p className="muted">{t("obj.none")}</p>;
  const types = stitchTypesFor(o);
  const set = (fn: (o: DesignObject) => DesignObject) => updateObject(ed, o.id, fn);
  const isFill = o.type === "fill" || o.type === "applique";
  const isSatin = o.type === "satin" || o.type === "satinBorder" || o.type === "zigzag";
  const isRun = o.type === "running" || o.type === "triple" || o.type === "bean";
  const transform = () => {
    const c = objectCenter(o);
    const k = scale / 100;
    const a = (rot * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    set((obj) => mapObjectPoints(obj, (p: Point) => {
      const x = (p.x - c.x) * k;
      const y = (p.y - c.y) * k;
      return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
    }));
    setScale(100);
    setRot(0);
  };
  return (
    <div className="panel-body" data-testid="object-panel">
      <label className="field">
        <span>{t("obj.name")}</span>
        <input className="input" defaultValue={o.name} key={o.id + o.name} maxLength={80} onBlur={(e) => e.target.value.trim() && e.target.value !== o.name && set((x) => ({ ...x, name: e.target.value.trim() }))} />
      </label>
      <label className="field">
        <span>{t("obj.type")}</span>
        <select className="input" value={o.type} data-testid="stitch-type" onChange={(e) => set((x) => ({ ...x, type: e.target.value as StitchType }))}>
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {t("type." + ty)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("obj.color")}</span>
        <select className="input" value={o.color} onChange={(e) => set((x) => ({ ...x, color: Number(e.target.value) }))}>
          {ed.design.threads.map((th, i) => (
            <option key={i} value={i}>
              {i + 1}. {th.name} {th.code ? `(${th.code})` : ""}
            </option>
          ))}
        </select>
      </label>
      {isFill && (
        <>
          <NumberField label={t("obj.spacing")} unit="mm" value={o.fill.spacing} min={0.25} max={1.5} step={0.05} testId="fill-spacing" onChange={(v) => set((x) => ({ ...x, fill: { ...x.fill, spacing: v } }))} />
          <NumberField label={t("obj.angle")} unit="°" value={o.fill.angle} min={0} max={179} step={1} onChange={(v) => set((x) => ({ ...x, fill: { ...x.fill, angle: v } }))} />
          {expert && (
            <>
              <NumberField label={t("obj.stitchLength")} unit="mm" value={o.fill.stitchLength} min={1} max={7} step={0.1} onChange={(v) => set((x) => ({ ...x, fill: { ...x.fill, stitchLength: v } }))} />
              <NumberField label={t("obj.pullComp")} unit="mm" value={o.fill.pullComp} min={0} max={1} step={0.05} onChange={(v) => set((x) => ({ ...x, fill: { ...x.fill, pullComp: v } }))} />
              <label className="field">
                <span>{t("obj.underlay")}</span>
                <select className="input" value={o.fill.underlay} onChange={(e) => set((x) => ({ ...x, fill: { ...x.fill, underlay: e.target.value } }))}>
                  {["none", "edge", "tatami", "edge+tatami"].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
      {isSatin && (
        <>
          <NumberField label={t("obj.spacing")} unit="mm" value={o.satin.spacing} min={0.2} max={1.2} step={0.05} testId="satin-spacing" onChange={(v) => set((x) => ({ ...x, satin: { ...x.satin, spacing: v } }))} />
          {o.path && <NumberField label={t("obj.width")} unit="mm" value={o.satin.width} min={0.8} max={10} step={0.1} onChange={(v) => set((x) => ({ ...x, satin: { ...x.satin, width: v } }))} />}
          {expert && (
            <>
              <label className="check">
                <input type="checkbox" checked={o.satin.angle == null} onChange={(e) => set((x) => ({ ...x, satin: { ...x.satin, angle: e.target.checked ? null : 45 } }))} />
                <span>{t("obj.angleAuto")}</span>
              </label>
              {o.satin.angle != null && <NumberField label={t("obj.angle")} unit="°" value={o.satin.angle} min={0} max={179} step={1} onChange={(v) => set((x) => ({ ...x, satin: { ...x.satin, angle: v } }))} />}
              <NumberField label={t("obj.pullComp")} unit="mm" value={o.satin.pullComp} min={0} max={1} step={0.05} onChange={(v) => set((x) => ({ ...x, satin: { ...x.satin, pullComp: v } }))} />
              <label className="field">
                <span>{t("obj.underlay")}</span>
                <select className="input" value={o.satin.underlay} onChange={(e) => set((x) => ({ ...x, satin: { ...x.satin, underlay: e.target.value } }))}>
                  {["none", "center", "edge", "zigzag"].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
      {isRun && (
        <>
          <NumberField label={t("obj.stitchLength")} unit="mm" value={o.run.stitchLength} min={1} max={6} step={0.1} onChange={(v) => set((x) => ({ ...x, run: { ...x.run, stitchLength: v } }))} />
          {expert && <NumberField label={t("obj.repeats")} value={o.run.repeats} min={1} max={5} step={1} onChange={(v) => set((x) => ({ ...x, run: { ...x.run, repeats: v } }))} />}
        </>
      )}
      <p className="muted small">{t("obj.handlesHint")}</p>
      <div className="row2">
        <NumberField label={t("obj.scale")} value={scale} min={10} max={400} step={1} onChange={setScale} />
        <NumberField label={t("obj.rotate")} value={rot} min={-180} max={180} step={1} onChange={setRot} />
      </div>
      <button className="btn sm" disabled={scale === 100 && rot === 0} onClick={transform}>
        {t("obj.apply")}
      </button>
      <hr />
      <button
        className="btn danger sm"
        data-testid="delete-object"
        onClick={() => {
          ed.commit((d) => ({ ...d, objects: d.objects.filter((x) => x.id !== o.id) }));
          onDeleted();
        }}
      >
        {t("obj.delete")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Calques (ordre de broderie)

export function LayersPanel({ ed, selection, onSelect }: { ed: Editor; selection: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const d = ed.design;
  if (!d || !d.objects.length) return <p className="muted">{t("layers.empty")}</p>;
  const move = (i: number, dir: -1 | 1) =>
    ed.commit((des) => {
      const objs = des.objects.slice();
      const j = i + dir;
      if (j < 0 || j >= objs.length) return des;
      [objs[i], objs[j]] = [objs[j], objs[i]];
      return { ...des, objects: objs };
    });
  return (
    <div className="layers" data-testid="layers">
      <div className="layers-head">
        <span className="small muted">{t("layers.order")}</span>
        <button className="btn sm" onClick={() => ed.commit((des) => ({ ...des, objects: des.objects.slice().sort((a, b) => a.color - b.color) }))}>
          {t("layers.group")}
        </button>
      </div>
      <ol>
        {d.objects.map((o, i) => (
          <li key={o.id} className={o.id === selection ? "active" : ""}>
            <button className="layer-main" onClick={() => onSelect(o.id)} aria-current={o.id === selection}>
              <span className="num idx">{i + 1}</span>
              <span className="sw" style={{ background: d.threads[o.color]?.rgb ?? "#000" }} />
              <span className="layer-name">
                {o.name}
                <small className="muted">{t("type." + o.type)}</small>
              </span>
            </button>
            <span className="layer-actions">
              <button className="icon-btn sm" title={t("obj.up")} aria-label={t("obj.up")} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn sm" title={t("obj.down")} aria-label={t("obj.down")} disabled={i === d.objects.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <label className="icon-btn sm" title={t("obj.visible")}>
                <input type="checkbox" checked={o.visible} aria-label={t("obj.visible") + " " + o.name} onChange={(e) => updateObject(ed, o.id, (x) => ({ ...x, visible: e.target.checked }))} />
              </label>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- Fils

export function ThreadsPanel({ ed, dimColor, setDimColor }: { ed: Editor; dimColor: number | null; setDimColor: (i: number | null) => void }) {
  const { t } = useI18n();
  const d = ed.design;
  const plan = ed.analysis?.plan;
  const usage = useMemo(() => {
    if (!d || !plan) return [] as number[];
    const idx = stitchThreadIndex(plan);
    const counts = d.threads.map(() => 0);
    plan.stitches.forEach((s, i) => {
      if (s.c === STITCH) counts[idx[i]] = (counts[idx[i]] ?? 0) + 1;
    });
    return counts;
  }, [d, plan]);
  if (!d) return null;
  const setThread = (i: number, th: Partial<Thread>) => ed.commit((des) => ({ ...des, threads: des.threads.map((x, k) => (k === i ? { ...x, ...th } : x)) }));
  return (
    <div className="panel-body" data-testid="threads-panel">
      {d.threads.map((th, i) => {
        const pec = nearestPecThread(th.rgb);
        return (
          <div key={i} className={"thread-row" + (dimColor === i ? " focus" : "")}>
            <input type="color" value={th.rgb} aria-label={`${t("obj.color")} ${i + 1}`} onChange={(e) => setThread(i, { rgb: e.target.value })} />
            <div className="thread-fields">
              <input className="input" value={th.name} aria-label={t("obj.name")} onChange={(e) => setThread(i, { name: e.target.value.slice(0, 120) })} />
              <div className="row2">
                <input className="input" placeholder={t("th.brand")} aria-label={t("th.brand")} value={th.brand} onChange={(e) => setThread(i, { brand: e.target.value.slice(0, 120) })} />
                <input className="input" placeholder={t("th.code")} aria-label={t("th.code")} value={th.code} onChange={(e) => setThread(i, { code: e.target.value.slice(0, 60) })} />
              </div>
              <div className="small muted">
                {t("th.points", { n: usage[i] ?? 0 })} ·{" "}
                {pec.rgb.toLowerCase() !== th.rgb.toLowerCase() ? (
                  <>
                    <span className="sw" style={{ background: pec.rgb }} /> {t("th.nearest", { name: pec.name })}{" "}
                    <button className="link" onClick={() => setThread(i, { rgb: pec.rgb, name: pec.name, brand: pec.brand, code: pec.code })}>
                      {t("th.usePec")}
                    </button>
                  </>
                ) : (
                  "PEC " + pec.code
                )}
              </div>
            </div>
            <button className="icon-btn sm" aria-pressed={dimColor === i} title={t("th.isolate")} aria-label={`${t("th.isolate")} : ${th.name}`} onClick={() => setDimColor(dimColor === i ? null : i)}>
              ◐
            </button>
          </div>
        );
      })}
      <button className="btn sm" onClick={() => ed.commit((des) => ({ ...des, threads: [...des.threads, { rgb: "#5a3a28", name: `${t("obj.color")} ${des.threads.length + 1}`, brand: "", code: "" }] }))}>
        {t("th.add")}
      </button>
      <p className="small muted" style={{ marginTop: 12 }}>
        {t("th.chartNote")}
      </p>
      <ChartsSection ed={ed} />
    </div>
  );
}

interface UserChart {
  id: string;
  brand: string;
  product: string;
  status: string;
  source: string;
  sourceUrl: string | null;
  entries: { code: string; name: string; rgb: string }[];
}

function ChartsSection({ ed }: { ed: Editor }) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [charts, setCharts] = useState<UserChart[]>([]);
  const [selected, setSelected] = useState("pec");
  const [error, setError] = useState("");
  const load = () => get<{ charts: UserChart[] }>("/api/thread-charts").then((r) => setCharts(r.charts), () => {});
  useEffect(() => {
    load();
  }, []);
  const chart = selected === "pec" ? (PEC_CHART as any) : charts.find((c) => c.id === selected);
  const d = ed.design;
  if (!d) return null;
  return (
    <div className="chart-box" data-testid="charts">
      <h3>{t("ch.title")}</h3>
      <label className="field">
        <span>{t("ch.choose")}</span>
        <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)} data-testid="chart-select">
          <option value="pec">{PEC_CHART.brand} — {PEC_CHART.product}</option>
          {charts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.brand} — {c.product} ({c.status})
            </option>
          ))}
        </select>
      </label>
      {chart && (
        <p className="small muted">
          {chart.source}
          {chart.sourceUrl && (
            <>
              {" · "}
              <a href={chart.sourceUrl} target="_blank" rel="noreferrer noopener">
                {new URL(chart.sourceUrl).hostname}
              </a>
            </>
          )}
        </p>
      )}
      {chart &&
        d.threads.map((th, i) => {
          const m = matchChartEntries(th.rgb, { ...chart, entries: chart.entries } as any, 1)[0];
          if (!m) return null;
          return (
            <div key={i} className="chart-match">
              <span className="sw" style={{ background: th.rgb }} /> {th.name} →<span className="sw" style={{ background: m.entry.rgb }} />
              <strong>{m.entry.code}</strong> {m.entry.name} <span className="muted">({t("ch.delta", { d: m.delta.toFixed(0) })})</span>
              <button
                className="link"
                onClick={() => ed.commit((des) => ({ ...des, threads: des.threads.map((x, k) => (k === i ? { rgb: m.entry.rgb, name: m.entry.name || m.entry.code, brand: chart.brand, code: m.entry.code } : x)) }))}
              >
                {t("th.usePec")}
              </button>
            </div>
          );
        })}
      {selected !== "pec" && (
        <button
          className="btn sm danger"
          style={{ marginTop: 8 }}
          onClick={async () => {
            await del(`/api/thread-charts/${selected}`);
            setSelected("pec");
            load();
          }}
        >
          {t("ch.delete")}
        </button>
      )}
      <details style={{ marginTop: 10 }}>
        <summary>{t("ch.import")}</summary>
        {error && <div className="alert error">{error}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const file = f.get("csv") as File;
            setError("");
            try {
              const r = await post<{ chart: UserChart }>("/api/thread-charts", {
                brand: f.get("brand"),
                product: f.get("product"),
                status: f.get("status"),
                source: f.get("source"),
                sourceUrl: f.get("sourceUrl") || "",
                csv: file && file.size ? await file.text() : "",
              });
              toast(t("ch.imported", { n: r.chart.entries.length }));
              await load();
              setSelected(r.chart.id);
              (e.target as HTMLFormElement).reset();
            } catch (err) {
              setError(errText(err));
            }
          }}
        >
          <label className="field"><span>{t("ch.brand")}</span><input className="input" name="brand" maxLength={120} required /></label>
          <label className="field"><span>{t("ch.product")}</span><input className="input" name="product" maxLength={160} required /></label>
          <label className="field">
            <span>{t("ch.status")}</span>
            <select className="input" name="status" defaultValue="approximatif">
              <option value="officiel">{t("ch.official")}</option>
              <option value="approximatif">{t("ch.approx")}</option>
              <option value="utilisateur">{t("ch.user")}</option>
            </select>
          </label>
          <label className="field"><span>{t("ch.source")}</span><input className="input" name="source" maxLength={500} required /></label>
          <label className="field"><span>{t("ch.url")}</span><input className="input" name="sourceUrl" type="url" maxLength={500} /></label>
          <label className="field"><span>{t("ch.file")}</span><input name="csv" type="file" accept=".csv,text/csv" required data-testid="chart-file" /></label>
          <button className="btn sm">{t("ch.import")}</button>
        </form>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- Machine

export function MachinePanel({ ed }: { ed: Editor }) {
  const { t, lang } = useI18n();
  const m = findMachine(ed.machineId);
  const hoop = m.hoops.find((h) => h.id === ed.hoopId) ?? m.hoops[0];
  const reg = summarizeRegistry(registry);
  return (
    <div className="panel-body" data-testid="machine-panel">
      <label className="field">
        <span>{t("m.machine")}</span>
        <select className="input" value={m.id} onChange={(e) => ed.updateSettings({ machineId: e.target.value, hoopId: findMachine(e.target.value).hoops[0]?.id })}>
          {MACHINES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.brand} {x.model}
            </option>
          ))}
        </select>
      </label>
      {m.hoops.length > 0 && (
        <label className="field">
          <span>{t("m.hoop")}</span>
          <select className="input" value={hoop?.id} onChange={(e) => ed.updateSettings({ hoopId: e.target.value })}>
            {m.hoops.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={"alert " + (m.status === "vérifié" ? "info" : "warn")}>{m.status === "vérifié" ? t("m.sourced") : t("m.incomplete")}</div>
      <dl className="kv">
        <dt>{t("m.formats")}</dt>
        <dd>{m.formats.join(", ") || "—"}</dd>
        <dt>{t("m.field")}</dt>
        <dd className="num">{m.maxFieldMm ? `${fmt(m.maxFieldMm.w, lang)} × ${fmt(m.maxFieldMm.h, lang)} mm` : "—"}</dd>
        {hoop && (
          <>
            <dt>{t("m.hoop")}</dt>
            <dd className="num">
              {fmt(hoop.widthMm, lang)} × {fmt(hoop.heightMm, lang)} mm {!hoop.confirmed && <span className="badge warn">{t("m.unconfirmed")}</span>}
            </dd>
          </>
        )}
      </dl>
      {m.sources.map((s) => (
        <p key={s} className="small">
          <a href={s} target="_blank" rel="noreferrer noopener">
            {new URL(s).hostname}
          </a>
        </p>
      ))}
      <h3 style={{ marginTop: 16 }}>{t("m.trials")}</h3>
      <p className="small">{t("m.trialStatus", { tested: reg.tested, total: reg.total, status: reg.overall === "untested" ? t("m.untested") : reg.overall })}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Analyse

export function AnalysisPanel({ ed, expert, onRun, busy }: { ed: Editor; expert: boolean; onRun: (opts: Record<string, unknown>) => void; busy: boolean }) {
  const { t, lang } = useI18n();
  const o = { colors: 6, targetWidthMm: 100, removeBackground: "auto", satinMaxWidthMm: 6, minDetailMm2: 2, ...(ed.settings.traceOptions ?? {}) } as any;
  const set = (k: string, v: unknown) => ed.updateSettings({ traceOptions: { ...o, [k]: v } });
  const hasSource = !!(ed.settings.sourceFileId || ed.settings.demoMotif);
  return (
    <div className="panel-body" data-testid="analysis-panel">
      <NumberField label={t("an.colors")} value={o.colors} min={1} max={12} step={1} onChange={(v) => set("colors", v)} testId="trace-colors" />
      <NumberField label={t("an.width")} unit="mm" value={o.targetWidthMm} min={10} max={360} step={1} onChange={(v) => set("targetWidthMm", v)} />
      <label className="field">
        <span>{t("an.background")}</span>
        <select className="input" value={o.removeBackground} onChange={(e) => set("removeBackground", e.target.value)}>
          <option value="auto">{t("an.bgAuto")}</option>
          <option value="none">{t("an.bgNone")}</option>
        </select>
      </label>
      {expert && (
        <>
          <NumberField label={t("an.satinMax")} unit="mm" value={o.satinMaxWidthMm} min={2} max={10} step={0.5} onChange={(v) => set("satinMaxWidthMm", v)} />
          <NumberField label={t("an.minDetail")} unit="mm²" value={o.minDetailMm2} min={0.5} max={20} step={0.5} onChange={(v) => set("minDetailMm2", v)} />
        </>
      )}
      {hasSource ? (
        <>
          <p className="small muted">{t("an.replaceWarn")}</p>
          <button className="btn primary block" disabled={busy} onClick={() => onRun(o)} data-testid="run-analysis">
            {busy ? t("new.analysing") : t("an.run")}
          </button>
        </>
      ) : (
        <p className="small muted">{t("an.noSource")}</p>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        {t("an.deterministic")}
      </p>
      {ed.report && (
        <>
          <h3>{t("an.strategy")}</h3>
          <ul className="strategy">
            {ed.report.objects.slice(0, 60).map((s) => (
              <li key={s.id}>
                <span className="sw" style={{ background: ed.report!.palette[s.color] }} /> {translateStrategy(lang as Lang, s).text}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Contrôle qualité

export function QualityPanel({ ed, onLocate }: { ed: Editor; onLocate: (issue: QualityIssue) => void }) {
  const { t, lang } = useI18n();
  const qc = ed.analysis?.qc;
  if (!qc) return <p className="muted">{t("layers.empty")}</p>;
  const m = findMachine(ed.machineId);
  const hoop = m.hoops.find((h) => h.id === ed.hoopId);
  const count = (l: string) => qc.issues.filter((i) => i.level === l).length;
  const order = { error: 0, warning: 1, info: 2 } as const;
  return (
    <div className="panel-body" data-testid="quality-panel">
      <div className={"alert " + (qc.blocking ? "error" : "ok")} role="status">
        {qc.blocking ? t("q.blocking") : t("q.ok")}
      </div>
      <p className="small muted">{t("q.counts", { e: count("error"), w: count("warning"), i: count("info") })}</p>
      <ul className="issues">
        {qc.issues
          .slice()
          .sort((a, b) => order[a.level] - order[b.level])
          .map((iss, k) => (
            <li key={k}>
              <button className={"issue " + iss.level} onClick={() => onLocate(iss)} disabled={!iss.objectId && !iss.at?.length}>
                <span className={"badge " + (iss.level === "warning" ? "warn" : iss.level)}>{t("q." + iss.level)}</span>{" "}
                <strong>{qcLabel(lang as Lang, iss.code)}</strong>
                <span className="small">{translateIssue(lang as Lang, iss, { hoop: hoop?.name, model: m.model }).text}</span>
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Export

export function ExportPanel({ ed }: { ed: Editor }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [format, setFormat] = useState<ExportFormat>("pes");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<ExportDTO[]>([]);
  const a = ed.analysis;
  const load = () => get<{ exports: ExportDTO[] }>(`/api/projects/${ed.id}/exports`).then((r) => setList(r.exports), () => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.id]);
  const run = async () => {
    setBusy(true);
    try {
      await ed.saveNow();
      const r = await post<{ export: ExportDTO }>(`/api/projects/${ed.id}/exports`, { format });
      await downloadUrl(r.export.downloadUrl, r.export.filename);
      toast(t("ex.done", { name: r.export.filename }));
      load();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const s = a?.stats;
  return (
    <div className="panel-body" data-testid="export-panel">
      <fieldset className="formats">
        <legend>{t("ex.format")}</legend>
        {(["pes", "pes6", "dst"] as const).map((f) => (
          <label key={f} className="check">
            <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} />
            <span>{t("ex." + f)}</span>
          </label>
        ))}
      </fieldset>
      {s && (
        <>
          <h3>{t("ex.summary")}</h3>
          <dl className="kv num">
            <dt>{t("ex.size")}</dt>
            <dd>{t("st.size", { w: fmt(s.widthMm, lang), h: fmt(s.heightMm, lang) })}</dd>
          </dl>
          <p className="small">{t("st.summary", { s: s.stitches.toLocaleString(lang), c: ed.design?.threads.length ?? 0, ch: s.colorChanges, t: s.trims, m: Math.round(s.estMinutes) })}</p>
        </>
      )}
      {a?.qc.blocking && <div className="alert error">{t("ex.blocked")}</div>}
      <p className="small muted">{t("ex.physical")}</p>
      <button className="btn primary block" disabled={!a || a.qc.blocking || busy} onClick={run} data-testid="export-run">
        {busy ? t("ed.saving") : t("ex.go")}
      </button>
      <h3 style={{ marginTop: 16 }}>{t("prep.title")}</h3>
      <a className="btn sm" href={`${import.meta.env.BASE_URL}p/${ed.id}/fiche`} target="_blank" rel="noopener" data-testid="open-prep">
        {t("prep.open")}
      </a>
      <h3 style={{ marginTop: 16 }}>{t("ex.previews")}</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!a} onClick={() => a && saveBlob(new Blob([planToSvg(a.plan, ed.name)], { type: "image/svg+xml" }), ed.name + "-apercu.svg")}>
          {t("ex.svg")}
        </button>
        <button className="btn sm" disabled={!a} onClick={async () => a && saveBlob((await planToPngBlob(a.plan))!, ed.name + "-apercu.png")}>
          {t("ex.png")}
        </button>
      </div>
      <h3 style={{ marginTop: 16 }}>{t("ex.history")}</h3>
      {list.length === 0 ? (
        <p className="small muted">{t("ex.none")}</p>
      ) : (
        <ul className="exports" data-testid="export-history">
          {list.map((x) => (
            <li key={x.id}>
              <span>
                <strong>{x.filename}</strong>
                <br />
                <small className="muted">
                  {new Date(x.createdAt).toLocaleString(lang)} · {t("ex.rev", { rev: x.revision })} · <span className="num">{x.stats.stitches?.toLocaleString(lang)}</span>
                </small>
              </span>
              <button className="btn sm" onClick={() => downloadUrl(x.downloadUrl, x.filename).catch((e) => toast(errText(e), "error"))}>
                {t("ex.download")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Historique des versions

export function HistoryPanel({ ed }: { ed: Editor }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [versions, setVersions] = useState<ProjectVersionDTO[]>([]);
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<ProjectVersionDTO | null>(null);
  const load = () => get<{ versions: ProjectVersionDTO[] }>(`/api/projects/${ed.id}/versions`).then((r) => setVersions(r.versions), () => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.id, ed.saveState === "saved"]);
  return (
    <div className="panel-body" data-testid="history-panel">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await ed.saveNow({ snapshot: true, snapshotLabel: label.trim() || undefined });
            setLabel("");
            toast(t("ed.snapshotDone"));
            load();
          } catch (err) {
            toast(errText(err), "error");
          }
        }}
      >
        <label className="field">
          <span>{t("h.label")}</span>
          <input className="input" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button className="btn sm">{t("ed.snapshot")}</button>
      </form>
      <ul className="versions">
        {versions.length === 0 && <li className="muted">{t("h.empty")}</li>}
        {versions.map((v) => (
          <li key={v.id}>
            <span>
              <strong>{v.label ?? t("h.auto")}</strong>
              <br />
              <small className="muted">
                {t("ex.rev", { rev: v.revision })} · {new Date(v.createdAt).toLocaleString(lang)}
              </small>
            </span>
            <button className="btn sm" onClick={() => setConfirm(v)}>
              {t("h.restore")}
            </button>
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog
          title={t("h.restore")}
          message={t("h.restoreMsg", { rev: confirm.revision })}
          confirmLabel={t("h.restore")}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await ed.saveNow();
              const r = await post<{ project: ProjectDTO }>(`/api/projects/${ed.id}/versions/${confirm.id}/restore`);
              ed.reset(r.project);
              toast(t("h.restored"));
              load();
            } catch (e) {
              toast(errText(e), "error");
            }
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

export type { Design };
