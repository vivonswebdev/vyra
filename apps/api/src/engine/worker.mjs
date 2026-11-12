// Worker de calcul : exécute le moteur figé hors du fil principal de l'API.
// JavaScript pur (pas de chargeur TypeScript) : il importe directement le moteur extrait.
import { parentPort } from "node:worker_threads";
import * as E from "../../../../packages/engine/src/generated/engine.js";

const findMachine = (id) => E.MACHINES.find((m) => m.id === id) ?? E.MACHINES[0];
const findHoop = (m, id) => m.hoops.find((h) => h.id === id) ?? m.hoops[0] ?? null;

function analyze(design, machineId, hoopId) {
  const plan = E.buildPlan(design);
  const machine = findMachine(machineId);
  return { plan, stats: E.computeStats(plan), qc: E.runQualityChecks(design, plan, machine, findHoop(machine, hoopId)) };
}

const tasks = {
  export({ design, format, label, machineId, hoopId }) {
    const { plan, stats, qc } = analyze(design, machineId, hoopId);
    if (qc.blocking) return { blocked: true, issues: qc.issues.filter((i) => i.level === "error"), stats, qc };
    const writer = { pes: E.writePES1, pes6: E.writePES6, dst: E.writeDST }[format];
    if (!writer) throw new Error("format inconnu");
    return { blocked: false, bytes: writer(plan, label), stats, qc };
  },
  thumbnail({ design, name }) {
    return { svg: E.planToSvg(E.buildPlan(design), name).replace("aperçu StitchStudio AI", "aperçu VYRA") };
  },
  // Utilisé par les tests : calcul volontairement interminable.
  spin({ ms }) {
    const end = Date.now() + ms;
    while (Date.now() < end);
    return { done: true };
  },
};

parentPort.on("message", ({ id, task, input }) => {
  try {
    const result = tasks[task](input);
    const transfer = result?.bytes ? [result.bytes.buffer] : [];
    parentPort.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
});
