// 全局状态：useSyncExternalStore + 快照历史 + localStorage 持久化
// 历史只包裹项目数据（假设集合）；选择/待处理矛盾等会话状态不进撤销栈。
import { useSyncExternalStore } from 'react';
import type {
  AboveRelation,
  DateRange,
  Equivalence,
  Hypothesis,
  PendingChange,
  Phase,
  ProjectState,
  Selection,
  Unit,
  UnitKind,
} from './types';
import { validateAbove, validateEquiv } from './graph';
import { History } from './history';
import { createSampleHypothesis } from './sample';
import { uid } from './uid';

const STORAGE_KEY = 'harris-workbench-v1';

interface ProjectData {
  hypotheses: Record<string, Hypothesis>;
  hypothesisOrder: string[];
  currentId: string;
}

interface SessionState {
  selection: Selection;
  pending: PendingChange | null;
  explainFrom: string | null;
  explainTo: string | null;
}

export interface StoreState {
  project: ProjectData;
  session: SessionState;
}

function initialProject(): ProjectData {
  const main = createSampleHypothesis();
  return { hypotheses: { [main.id]: main }, hypothesisOrder: [main.id], currentId: main.id };
}

function loadProject(): ProjectData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialProject();
    const data = JSON.parse(raw) as ProjectData;
    if (!data.hypotheses || !data.hypotheses[data.currentId]) return initialProject();
    // 兼容旧数据：补齐 positions
    for (const h of Object.values(data.hypotheses)) {
      if (!h.positions) h.positions = {};
    }
    return data;
  } catch {
    return initialProject();
  }
}

function cloneHypothesis(h: Hypothesis, newId: string, newName: string): Hypothesis {
  const phaseMap = new Map<string, string>();
  const phases: Phase[] = h.phases.map((p) => {
    const id = uid('p');
    phaseMap.set(p.id, id);
    return { ...p, id };
  });
  const units: Record<string, Unit> = {};
  for (const id of h.unitIds) {
    const u = h.units[id];
    // 单元 id 保持不变：跨假设按稳定身份对应
    units[id] = {
      ...u,
      dates: u.dates.map((d) => ({ ...d })),
      phaseId: u.phaseId ? phaseMap.get(u.phaseId) ?? null : null,
    };
  }
  return {
    id: newId,
    name: newName,
    unitIds: [...h.unitIds],
    units,
    phases,
    above: h.above.map((r) => ({ ...r, id: uid('r') })),
    equivs: h.equivs.map((e) => ({ ...e, id: uid('e') })),
    positions: { ...h.positions },
  };
}

// ---- 单一历史实例（模块级，随项目加载） ----
let project: ProjectData;
try {
  project = loadProject();
} catch {
  project = initialProject();
}
const history = new History<ProjectData>(project);

let session: SessionState = {
  selection: { type: 'none' },
  pending: null,
  explainFrom: null,
  explainTo: null,
};

const listeners = new Set<() => void>();

/** 快照对象：仅在 project/session 变化时替换，引用保持稳定 */
let storeState: StoreState = { project, session };

function emit(): void {
  storeState = { project, session };
  for (const l of listeners) l();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* 存储不可用时静默忽略 */
    }
  }, 250);
}

function commit(next: ProjectData): void {
  project = next;
  history.push(next);
  persist();
  emit();
}

function current(): Hypothesis {
  return project.hypotheses[project.currentId];
}

function updateCurrent(fn: (h: Hypothesis) => Hypothesis): void {
  const h = current();
  const next = fn(h);
  commit({
    ...project,
    hypotheses: { ...project.hypotheses, [h.id]: next },
  });
}

/** 重新校验待处理修改在当前数据下是否已可接受 */
function revalidate(p: PendingChange, h: Hypothesis) {
  return p.type === 'above'
    ? validateAbove(h, p.younger, p.older, '（待处理新增关系）')
    : validateEquiv(h, p.a, p.b, '（待处理新增等同）');
}

const store = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getState(): StoreState {
    return storeState;
  },
  getHistory(): History<ProjectData> {
    return history;
  },

  // ---------- 撤销 / 重做 ----------
  undo(): void {
    if (!history.canUndo) return;
    project = history.undo();
    persist();
    emit();
  },
  redo(): void {
    if (!history.canRedo) return;
    project = history.redo();
    persist();
    emit();
  },

  // ---------- 选择 / 解释模式 ----------
  select(selection: Selection): void {
    session = { ...session, selection };
    emit();
  },
  setExplain(from: string | null, to: string | null): void {
    session = { ...session, explainFrom: from, explainTo: to };
    emit();
  },

  // ---------- 单元 ----------
  addUnit(code: string, kind: UnitKind, note: string): string {
    const id = uid('u');
    updateCurrent((h) => ({
      ...h,
      unitIds: [...h.unitIds, id],
      units: {
        ...h.units,
        [id]: { id, code: code || `新 ${h.unitIds.length + 1}`, note, kind, dates: [], phaseId: null },
      },
    }));
    session = { ...session, selection: { type: 'unit', id } };
    emit();
    return id;
  },
  updateUnit(id: string, patch: Partial<Pick<Unit, 'code' | 'note' | 'kind'>>): void {
    updateCurrent((h) => ({
      ...h,
      units: { ...h.units, [id]: { ...h.units[id], ...patch } },
    }));
  },
  deleteUnit(id: string): void {
    updateCurrent((h) => {
      const units = { ...h.units };
      delete units[id];
      return {
        ...h,
        unitIds: h.unitIds.filter((x) => x !== id),
        units,
        above: h.above.filter((r) => r.younger !== id && r.older !== id),
        equivs: h.equivs.filter((e) => e.a !== id && e.b !== id),
      };
    });
    session = { ...session, selection: { type: 'none' } };
    emit();
  },

  // ---------- 年代 ----------
  addDate(unitId: string, d: Omit<DateRange, 'label'> & { label?: string }): void {
    updateCurrent((h) => ({
      ...h,
      units: {
        ...h.units,
        [unitId]: {
          ...h.units[unitId],
          dates: [...h.units[unitId].dates, { early: d.early, late: d.late, label: d.label || '出土物' }],
        },
      },
    }));
  },
  updateDate(unitId: string, index: number, patch: Partial<DateRange>): void {
    updateCurrent((h) => {
      const dates = h.units[unitId].dates.map((d, i) => (i === index ? { ...d, ...patch } : d));
      return { ...h, units: { ...h.units, [unitId]: { ...h.units[unitId], dates } } };
    });
  },
  deleteDate(unitId: string, index: number): void {
    updateCurrent((h) => {
      const dates = h.units[unitId].dates.filter((_, i) => i !== index);
      return { ...h, units: { ...h.units, [unitId]: { ...h.units[unitId], dates } } };
    });
  },

  // ---------- 分期 ----------
  addPhase(name: string): string {
    const id = uid('p');
    updateCurrent((h) => ({
      ...h,
      phases: [...h.phases, { id, name, rank: h.phases.length }],
    }));
    return id;
  },
  renamePhase(id: string, name: string): void {
    updateCurrent((h) => ({
      ...h,
      phases: h.phases.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },
  setPhaseRank(id: string, rank: number): void {
    updateCurrent((h) => ({
      ...h,
      phases: h.phases.map((p) => (p.id === id ? { ...p, rank } : p)),
    }));
  },
  deletePhase(id: string): void {
    updateCurrent((h) => ({
      ...h,
      phases: h.phases.filter((p) => p.id !== id),
      units: Object.fromEntries(
        h.unitIds.map((uid2) => [
          uid2,
          h.units[uid2].phaseId === id ? { ...h.units[uid2], phaseId: null } : h.units[uid2],
        ]),
      ),
    }));
  },
  setUnitPhase(unitId: string, phaseId: string | null): void {
    updateCurrent((h) => ({
      ...h,
      units: { ...h.units, [unitId]: { ...h.units[unitId], phaseId } },
    }));
  },

  // ---------- 早晚关系：校验失败则保留待处理，不改动有效矩阵 ----------
  addAbove(younger: string, older: string, note: string): boolean {
    const h = current();
    const conflict = validateAbove(h, younger, older, '（待处理新增关系）');
    if (conflict) {
      session = {
        ...session,
        pending: { id: uid('pend'), type: 'above', younger, older, note, conflict, createdAt: Date.now() },
      };
      emit();
      return false;
    }
    const rel: AboveRelation = { id: uid('r'), younger, older, note };
    updateCurrent((hh) => ({ ...hh, above: [...hh.above, rel] }));
    session = { ...session, selection: { type: 'edge', id: rel.id }, pending: null };
    emit();
    return true;
  },
  deleteAbove(id: string): void {
    updateCurrent((h) => ({ ...h, above: h.above.filter((r) => r.id !== id) }));
    // 删除证据后若待处理矛盾已解除，不自动应用，仅刷新其矛盾链
    if (session.pending) {
      const still = revalidate(session.pending, current());
      session = { ...session, pending: { ...session.pending, conflict: still } };
    }
    emit();
  },
  updateAboveNote(id: string, note: string): void {
    updateCurrent((h) => ({
      ...h,
      above: h.above.map((r) => (r.id === id ? { ...r, note } : r)),
    }));
  },

  // ---------- 等同关系 ----------
  addEquiv(a: string, b: string): boolean {
    const h = current();
    const conflict = validateEquiv(h, a, b, '（待处理新增等同）');
    if (conflict) {
      session = {
        ...session,
        pending: { id: uid('pend'), type: 'equiv', a, b, conflict, createdAt: Date.now() },
      };
      emit();
      return false;
    }
    const eq: Equivalence = { id: uid('e'), a, b };
    updateCurrent((hh) => ({ ...hh, equivs: [...hh.equivs, eq] }));
    session = { ...session, pending: null };
    emit();
    return true;
  },
  deleteEquiv(id: string): void {
    updateCurrent((h) => ({ ...h, equivs: h.equivs.filter((e) => e.id !== id) }));
    if (session.pending) {
      const still = revalidate(session.pending, current());
      session = { ...session, pending: { ...session.pending, conflict: still } };
    }
    emit();
  },

  // ---------- 待处理修改 ----------
  discardPending(): void {
    session = { ...session, pending: null };
    emit();
  },
  /** 矛盾链已被用户拆到可接受时，正式应用该修改 */
  applyPending(): boolean {
    const p = session.pending;
    if (!p) return false;
    const ok = p.type === 'above'
      ? this.addAbove(p.younger, p.older, p.note)
      : this.addEquiv(p.a, p.b);
    if (ok) session = { ...session, pending: null };
    emit();
    return ok;
  },

  // ---------- 节点位置 ----------
  setClassPosition(root: string, pos: { x: number; y: number }): void {
    updateCurrent((h) => ({ ...h, positions: { ...h.positions, [root]: pos } }));
  },
  resetLayout(): void {
    updateCurrent((h) => ({ ...h, positions: {} }));
  },

  // ---------- 假设 ----------
  switchHypothesis(id: string): void {
    if (!project.hypotheses[id]) return;
    commit({ ...project, currentId: id });
    session = { ...session, selection: { type: 'none' }, pending: null, explainFrom: null, explainTo: null };
    emit();
  },
  duplicateHypothesis(name?: string): string {
    const src = current();
    const id = uid('h');
    const copy = cloneHypothesis(src, id, name ?? `${src.name}（副本）`);
    commit({
      ...project,
      hypotheses: { ...project.hypotheses, [id]: copy },
      hypothesisOrder: [...project.hypothesisOrder, id],
      currentId: id,
    });
    return id;
  },
  createBlankHypothesis(name: string): string {
    const id = uid('h');
    const h: Hypothesis = {
      id,
      name,
      unitIds: [],
      units: {},
      above: [],
      equivs: [],
      phases: current().phases.map((p) => ({ ...p, id: uid('p') })),
      positions: {},
    };
    commit({
      ...project,
      hypotheses: { ...project.hypotheses, [id]: h },
      hypothesisOrder: [...project.hypothesisOrder, id],
      currentId: id,
    });
    return id;
  },
  renameHypothesis(id: string, name: string): void {
    commit({
      ...project,
      hypotheses: { ...project.hypotheses, [id]: { ...project.hypotheses[id], name } },
    });
  },
  deleteHypothesis(id: string): void {
    if (project.hypothesisOrder.length <= 1) return;
    const hypotheses = { ...project.hypotheses };
    delete hypotheses[id];
    const order = project.hypothesisOrder.filter((x) => x !== id);
    commit({
      ...project,
      hypotheses,
      hypothesisOrder: order,
      currentId: project.currentId === id ? order[0] : project.currentId,
    });
  },

  resetToSample(): void {
    commit(initialProject());
    session = { selection: { type: 'none' }, pending: null, explainFrom: null, explainTo: null };
    emit();
  },
};

export function useStore(): StoreState {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
}

export { store };
export type { ProjectState };
