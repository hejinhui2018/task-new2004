// 全局状态：useSyncExternalStore + 快照历史 + localStorage 持久化
// 历史只包裹项目数据（假设集合）；选择/待处理矛盾等会话状态不进撤销栈。
// 证据复核候选（reviews）持久化但不进撤销栈：撤销/重做矩阵事务时候选保持不动，
// “采用候选”本身是一条历史事务，一次撤销即可回到采用前的矩阵。
import { useSyncExternalStore } from 'react';
import type {
  AboveRelation,
  DateRange,
  Equivalence,
  Hypothesis,
  PendingChange,
  Phase,
  ProjectState,
  ReviewItem,
  Selection,
  Unit,
  UnitKind,
} from './types';
import { validateAbove, validateEquiv } from './graph';
import { History } from './history';
import { createSampleHypothesis, createReviewCaseHypothesis, REVIEW_CASE_ID } from './sample';
import { applyReviewItems, reviewDiff, type OrphanUnit, type ReviewDiff } from './review';
import { uid } from './uid';

const STORAGE_KEY = 'harris-workbench-v1';

/** 一条候选会话：待审变更清单（采用或取消前不影响当前矩阵） */
export interface ReviewSession {
  items: ReviewItem[];
}

interface ProjectData {
  hypotheses: Record<string, Hypothesis>;
  hypothesisOrder: string[];
  currentId: string;
}

/** 采用候选后的结果提示（仅本次会话，不持久化） */
export interface AdoptionNotice {
  kind: 'review-adoption';
  hypothesisId: string;
  withdrawnCount: number;
  affectedCount: number;
  orphans: OrphanUnit[];
  danglingCount: number;
}

interface SessionState {
  selection: Selection;
  pending: PendingChange | null;
  explainFrom: string | null;
  explainTo: string | null;
  notice: AdoptionNotice | null;
}

export interface StoreState {
  project: ProjectData;
  /** 每个假设一份独立的复核候选；持久化但不进撤销栈 */
  reviews: Record<string, ReviewSession>;
  session: SessionState;
}

function initialProject(): ProjectData {
  const main = createSampleHypothesis();
  const reviewCase = createReviewCaseHypothesis();
  return {
    hypotheses: { [main.id]: main, [reviewCase.id]: reviewCase },
    hypothesisOrder: [main.id, reviewCase.id],
    currentId: main.id,
  };
}

/** 读盘：项目数据 + 候选会话；旧版存档（无 reviews/无复核案例）可直接打开 */
function loadProject(): { project: ProjectData; reviews: Record<string, ReviewSession> } {
  const fallback = (): { project: ProjectData; reviews: Record<string, ReviewSession> } => ({
    project: initialProject(),
    reviews: {},
  });
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback();
    const data = JSON.parse(raw) as Partial<ProjectData> & {
      reviews?: Record<string, ReviewSession>;
    };
    if (!data.hypotheses || !data.hypotheses[data.currentId ?? '']) return fallback();
    // 兼容旧数据：补齐 positions
    for (const h of Object.values(data.hypotheses)) {
      if (!h.positions) h.positions = {};
    }
    const project: ProjectData = {
      hypotheses: data.hypotheses as ProjectData['hypotheses'],
      hypothesisOrder: data.hypothesisOrder ?? Object.keys(data.hypotheses),
      currentId: data.currentId as string,
    };
    // 候选会话：仅保留结构合法、假设仍存在的条目
    const reviews: Record<string, ReviewSession> = {};
    if (data.reviews && typeof data.reviews === 'object') {
      for (const [hId, sess] of Object.entries(data.reviews)) {
        if (!project.hypotheses[hId] || !sess || !Array.isArray(sess.items)) continue;
        const items = sess.items.filter(
          (it) =>
            it &&
            typeof it.id === 'string' &&
            ['date', 'phase', 'above', 'equiv'].includes(it.evidence) &&
            ['keep', 'withdraw', 'defer'].includes(it.disposition),
        );
        if (items.length) reviews[hId] = { items };
      }
    }
    // 旧版（含原始 T1 种子 h_main）存档补上内置复核案例；用户已删 h_main 的存档不强行注入
    if (!project.hypotheses[REVIEW_CASE_ID] && project.hypotheses['h_main']) {
      const rc = createReviewCaseHypothesis();
      project.hypotheses[REVIEW_CASE_ID] = rc;
      project.hypothesisOrder = [...project.hypothesisOrder, REVIEW_CASE_ID];
    }
    return { project, reviews };
  } catch {
    return fallback();
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

// ---- 模块级状态 ----
const loaded = loadProject();
let project: ProjectData = loaded.project;
let reviewsState: Record<string, ReviewSession> = loaded.reviews;
const history = new History<ProjectData>(project);

let session: SessionState = {
  selection: { type: 'none' },
  pending: null,
  explainFrom: null,
  explainTo: null,
  notice: null,
};

const listeners = new Set<() => void>();

/** 快照对象：仅在 project/reviews/session 变化时替换，引用保持稳定 */
let storeState: StoreState = { project, reviews: reviewsState, session };

function emit(): void {
  storeState = { project, reviews: reviewsState, session };
  for (const l of listeners) l();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      // 项目数据与候选会话一并写入；旧版读取方忽略 reviews 字段
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, reviews: reviewsState }));
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

/** 只更新候选会话（不进撤销栈） */
function commitReviews(next: Record<string, ReviewSession>): void {
  reviewsState = next;
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

/** 新建待审条目的入参 */
export interface AddReviewInput {
  evidence: ReviewItem['evidence'];
  refId: string;
  unitId?: string;
  dateIndex?: number;
  dateSnapshot?: DateRange;
  note?: string;
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
    if (session.notice) session = { ...session, notice: null };
    persist();
    emit();
  },
  redo(): void {
    if (!history.canRedo) return;
    project = history.redo();
    if (session.notice) session = { ...session, notice: null };
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
  dismissNotice(): void {
    if (!session.notice) return;
    session = { ...session, notice: null };
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

  // ---------- 证据复核候选（隔离，不进撤销栈） ----------
  getReviewItems(): ReviewItem[] {
    return reviewsState[project.currentId]?.items ?? [];
  },
  /** 把一条证据送审；同一证据重复送审返回既有条目 */
  addReviewItem(input: AddReviewInput): string {
    const hId = project.currentId;
    const sess = reviewsState[hId] ?? { items: [] };
    const dup = sess.items.find(
      (it) =>
        it.evidence === input.evidence &&
        it.refId === input.refId &&
        it.unitId === input.unitId &&
        it.dateIndex === input.dateIndex,
    );
    if (dup) return dup.id;
    const item: ReviewItem = {
      id: uid('rev'),
      evidence: input.evidence,
      refId: input.refId,
      unitId: input.unitId,
      dateIndex: input.dateIndex,
      dateSnapshot: input.dateSnapshot ? { ...input.dateSnapshot } : undefined,
      disposition: 'keep',
      note: input.note ?? '',
      createdAt: Date.now(),
    };
    commitReviews({ ...reviewsState, [hId]: { items: [...sess.items, item] } });
    return item.id;
  },
  setReviewDisposition(itemId: string, disposition: ReviewItem['disposition']): void {
    const hId = project.currentId;
    const sess = reviewsState[hId];
    if (!sess) return;
    commitReviews({
      ...reviewsState,
      [hId]: {
        items: sess.items.map((it) => (it.id === itemId ? { ...it, disposition } : it)),
      },
    });
  },
  updateReviewNote(itemId: string, note: string): void {
    const hId = project.currentId;
    const sess = reviewsState[hId];
    if (!sess) return;
    commitReviews({
      ...reviewsState,
      [hId]: { items: sess.items.map((it) => (it.id === itemId ? { ...it, note } : it)) },
    });
  },
  removeReviewItem(itemId: string): void {
    const hId = project.currentId;
    const sess = reviewsState[hId];
    if (!sess) return;
    const items = sess.items.filter((it) => it.id !== itemId);
    const next = { ...reviewsState };
    if (items.length) next[hId] = { items };
    else delete next[hId];
    commitReviews(next);
  },
  /** 取消候选：丢弃全部待审变更，当前矩阵不变 */
  cancelReview(): void {
    const hId = project.currentId;
    if (!reviewsState[hId]) return;
    const next = { ...reviewsState };
    delete next[hId];
    commitReviews(next);
  },
  /** 在最新当前矩阵上重算候选差异（候选隔离的纯计算入口） */
  getReviewDiff(): ReviewDiff | null {
    const items = this.getReviewItems();
    if (!items.length) return null;
    return reviewDiff(current(), items);
  },
  /**
   * 采用候选：把全部“撤回”一次性写入当前假设，作为单条可撤销事务。
   * “保留/暂不采用”不改变结构。悬空（证据已被直接删除）计入提示但不阻断；
   * 产生的无法定位单元在 notice 中明确列出，单元本身绝不静默删除。
   * 返回是否采用成功。
   */
  adoptReview(): boolean {
    const h = current();
    const items = this.getReviewItems();
    if (!items.length || !items.some((i) => i.disposition === 'withdraw')) return false;
    const diff = reviewDiff(h, items);
    const withdrawn = items.filter((i) => i.disposition === 'withdraw');

    // 在隔离副本上落实撤回，再作为单条事务提交；悬空（证据已不存在）不会静默删除
    const candidate = structuredClone(h);
    const unresolvedIds = applyReviewItems(candidate, withdrawn);

    commit({
      ...project,
      hypotheses: { ...project.hypotheses, [h.id]: candidate },
    });

    // 候选消费完毕
    const nextReviews = { ...reviewsState };
    delete nextReviews[h.id];
    reviewsState = nextReviews;

    session = {
      ...session,
      selection: { type: 'none' },
      pending: null,
      notice: {
        kind: 'review-adoption',
        hypothesisId: h.id,
        withdrawnCount: withdrawn.length - unresolvedIds.length,
        affectedCount: diff.affectedUnitIds.length,
        orphans: diff.orphans,
        danglingCount: unresolvedIds.length,
      },
    };
    persist();
    emit();
    return true;
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
    const nextReviews = { ...reviewsState };
    delete nextReviews[id];
    reviewsState = nextReviews;
    commit({
      ...project,
      hypotheses,
      hypothesisOrder: order,
      currentId: project.currentId === id ? order[0] : project.currentId,
    });
  },

  resetToSample(): void {
    const p = initialProject();
    project = p;
    resetHistory(p);
    reviewsState = {};
    session = {
      selection: { type: 'none' },
      pending: null,
      explainFrom: null,
      explainTo: null,
      notice: null,
    };
    persist();
    emit();
  },
};

// resetToSample 需要清空撤销栈：就地重置 History 的私有栈字段
function resetHistory(p: ProjectData): void {
  const h = history as unknown as { past: ProjectData[]; present: ProjectData; future: ProjectData[] };
  h.past = [];
  h.future = [];
  h.present = p;
}

export function useStore(): StoreState {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );
}

export { store };
export type { ProjectState };
