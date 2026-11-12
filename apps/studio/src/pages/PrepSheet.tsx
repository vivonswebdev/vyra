// Fiche de préparation imprimable (reprise de la v0.2) : ordre des bobines, points et fil estimé
// par bloc de couleur, arrêts sur même couleur, machine et cadre, aperçu fidèle du plan.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { analyze, findMachine, planBounds, stitchThreadIndex, STITCH, type Design } from "@vyra/engine";
import { renderPlan } from "@vyra/engine/browser";
import { Brand, get, Spinner, useI18n } from "@vyra/ui";
import type { ProjectDTO } from "@vyra/shared";

export default function PrepSheet() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    get<{ project: ProjectDTO }>(`/api/projects/${id}`).then((r) => setProject(r.project), (e) => setError(e.message));
  }, [id]);
  const data = useMemo(() => {
    if (!project?.design) return null;
    const s = project.settings ?? {};
    const a = analyze(project.design as Design, s.machineId, s.hoopId);
    const idx = stitchThreadIndex(a.plan);
    const rows = a.plan.threads.map((th, g) => {
      let n = 0;
      let len = 0;
      a.plan.stitches.forEach((st, k) => {
        if (idx[k] !== g || st.c !== STITCH) return;
        n++;
        const prev = a.plan.stitches[k - 1];
        if (prev && prev.c === STITCH) len += Math.hypot(st.x - prev.x, st.y - prev.y);
      });
      return { th, n, m: (len * 1.1) / 1000, stop: g > 0 && a.plan.threads[g - 1].rgb === th.rgb };
    });
    const machine = findMachine(s.machineId);
    const hoop = machine.hoops.find((h) => h.id === s.hoopId) ?? machine.hoops[0];
    return { a, rows, machine, hoop };
  }, [project]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data) return;
    const b = planBounds(data.a.plan);
    const w = b.maxX - b.minX + 6;
    const h = b.maxY - b.minY + 6;
    const k = Math.min(520 / w, 520 / h);
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f4efe6";
    ctx.fillRect(0, 0, c.width, c.height);
    renderPlan(ctx, data.a.plan, { scale: k, ox: (3 - b.minX) * k, oy: (3 - b.minY) * k }, { realistic: true, showJumps: false });
  }, [data]);

  if (error) return <p className="page">{error}</p>;
  if (!project) return <div className="auth-shell"><Spinner /></div>;
  if (!data) return <p className="page">{t("ed.empty")}</p>;
  const s = data.a.stats;
  return (
    <main className="page prep-sheet" data-testid="prep-sheet">
      <div className="prep-actions no-print">
        <Link className="btn" to={`/p/${project.id}`}>{t("common.back")}</Link>
        <button className="btn primary" onClick={() => window.print()}>{t("prep.print")}</button>
      </div>
      <header className="prep-head">
        <Brand />
        <div>
          <h1>{t("prep.title")} — {project.name}</h1>
          <p className="muted">
            {data.machine.brand} {data.machine.model} · {data.hoop?.name ?? "—"} · <span className="num">{s.widthMm.toFixed(1)} × {s.heightMm.toFixed(1)} mm</span>
          </p>
          <p>{t("st.summary", { s: s.stitches.toLocaleString(lang), c: data.rows.length, ch: s.colorChanges, t: s.trims, m: Math.ceil(s.estMinutes) })}</p>
        </div>
      </header>
      <div className="prep-grid">
        <canvas ref={canvas} aria-label={project.name} />
        <table className="prep-table">
          <thead>
            <tr>
              <th>{t("prep.order")}</th>
              <th>{t("prep.color")}</th>
              <th>{t("obj.name")}</th>
              <th>{t("th.brand")}</th>
              <th>{t("th.code")}</th>
              <th>{t("prep.stitches")}</th>
              <th>{t("prep.length")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                <td><span className="sw" style={{ background: r.th.rgb }} /> <span className="num">{r.th.rgb}</span></td>
                <td>{r.th.name}{r.stop ? ` (${t("prep.stop")})` : ""}</td>
                <td>{r.th.brand || "—"}</td>
                <td>{r.th.code || "—"}</td>
                <td className="num">{r.n.toLocaleString(lang)}</td>
                <td className="num">{r.m.toFixed(1)} m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">{t("prep.note")}</p>
      <p className="small muted">{t("ex.physical")}</p>
    </main>
  );
}
