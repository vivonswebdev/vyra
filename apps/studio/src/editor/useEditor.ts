// État de l'éditeur : document, historique Annuler/Rétablir (80 pas, une étape par modification,
// comme la v0.2), réglages du projet et enregistrement automatique vers l'API.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { analyze, type Design, type TraceReport } from "@vyra/engine";
import { ApiError, patch, post } from "@vyra/ui";
import type { ProjectDTO, ProjectSettings } from "@vyra/shared";

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
const HISTORY = 80;
const AUTOSAVE_MS = 1200;

// Les documents sont traités comme immuables : chaque modification produit de nouveaux objets,
// l'historique peut donc conserver des références sans copie.
type History = { design: Design | null; past: Design[]; future: Design[] };
type Action =
  | { type: "commit"; next: Design | null | ((d: Design) => Design) }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; design: Design | null };

function historyReducer(s: History, a: Action): History {
  switch (a.type) {
    case "commit": {
      const v = typeof a.next === "function" ? (s.design ? a.next(s.design) : s.design) : a.next;
      if (v === s.design) return s;
      return { design: v, past: s.design ? [...s.past.slice(-(HISTORY - 1)), s.design] : s.past, future: [] };
    }
    case "undo":
      if (!s.past.length) return s;
      return { design: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: s.design ? [s.design, ...s.future].slice(0, HISTORY) : s.future };
    case "redo":
      if (!s.future.length) return s;
      return { design: s.future[0], past: s.design ? [...s.past.slice(-(HISTORY - 1)), s.design] : s.past, future: s.future.slice(1) };
    case "reset":
      return { design: a.design, past: [], future: [] };
  }
}

export function useEditor(initial: ProjectDTO) {
  const [hist, dispatch] = useReducer(historyReducer, { design: (initial.design as Design) ?? null, past: [], future: [] });
  const { design, past, future } = hist;
  const [settings, setSettings] = useState<ProjectSettings>(initial.settings ?? {});
  const [name, setName] = useState(initial.name);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [report, setReport] = useState<TraceReport | null>(((initial.settings as any)?.lastReport as TraceReport) ?? null);

  const revision = useRef(initial.revision);
  const latest = useRef({ design, settings, name });
  latest.current = { design, settings, name };
  const dirty = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | null>(null);

  const machineId = settings.machineId ?? "brother-xe1";
  const hoopId = settings.hoopId ?? "sa439s";
  const analysis = useMemo(() => (design && design.objects.length ? analyze(design, machineId, hoopId) : null), [design, machineId, hoopId]);

  // ------------------------------------------------------------ Enregistrement

  const saveNow = useCallback(async (opts: { snapshot?: boolean; snapshotLabel?: string } = {}): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current.catch(() => {});
    if (!dirty.current && !opts.snapshot) return;
    const { design: d, settings: s, name: n } = latest.current;
    dirty.current = false;
    setSaveState("saving");
    const run = (async () => {
      try {
        const r = await patch<{ project: ProjectDTO }>(`/api/projects/${initial.id}`, {
          baseRevision: revision.current,
          name: n,
          design: d,
          settings: s,
          ...opts,
        });
        revision.current = r.project.revision;
        setSaveState(dirty.current ? "dirty" : "saved");
      } catch (e) {
        dirty.current = true;
        if (e instanceof ApiError && e.status === 409) {
          setSaveState("conflict");
          return;
        }
        setSaveState("error");
        throw e;
      }
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  }, [initial.id]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveNow().catch(() => {
        // nouvelle tentative automatique après une erreur réseau
        timer.current = window.setTimeout(() => saveNow().catch(() => {}), 5000);
      });
    }, AUTOSAVE_MS);
  }, [saveNow]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ------------------------------------------------------------ Modifications

  /** Une modification = une étape d'historique. */
  const commit = useCallback(
    (next: Design | null | ((d: Design) => Design)) => {
      dispatch({ type: "commit", next });
      schedule();
    },
    [schedule],
  );

  const undo = useCallback(() => {
    dispatch({ type: "undo" });
    schedule();
  }, [schedule]);

  const redo = useCallback(() => {
    dispatch({ type: "redo" });
    schedule();
  }, [schedule]);

  const updateSettings = useCallback(
    (patchS: Partial<ProjectSettings>) => {
      setSettings((s) => ({ ...s, ...patchS }));
      schedule();
    },
    [schedule],
  );

  const rename = useCallback(
    (n: string) => {
      const v = n.trim().slice(0, 120);
      if (!v) return;
      setName(v);
      schedule();
    },
    [schedule],
  );

  /** Remplace tout l'état (restauration d'une version, rechargement) sans étape d'historique. */
  const reset = useCallback((p: ProjectDTO) => {
    revision.current = p.revision;
    dirty.current = false;
    dispatch({ type: "reset", design: (p.design as Design) ?? null });
    setSettings(p.settings ?? {});
    setName(p.name);
    setSaveState("saved");
  }, []);

  const saveAsCopy = useCallback(async () => {
    const { design: d, settings: s, name: n } = latest.current;
    const r = await post<{ project: ProjectDTO }>("/api/projects", { name: (n + " (copie)").slice(0, 120), design: d, settings: s });
    dirty.current = false;
    return r.project;
  }, []);

  return {
    id: initial.id,
    design,
    settings,
    name,
    report,
    setReport,
    machineId,
    hoopId,
    analysis,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    historyDepth: past.length,
    saveState,
    revision,
    commit,
    undo,
    redo,
    updateSettings,
    rename,
    reset,
    saveNow,
    saveAsCopy,
  };
}

export type Editor = ReturnType<typeof useEditor>;
