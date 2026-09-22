// 核心领域模型：地层单元、关系、分期与项目状态

/** 单元类型：堆积 / 切割 / 构筑 */
export type UnitKind = 'deposit' | 'cut' | 'construction';

export const UNIT_KIND_LABEL: Record<UnitKind, string> = {
  deposit: '堆积',
  cut: '切割',
  construction: '构筑',
};

/** 出土物给出的年代范围（公元纪年整数，公元前用负数；数值越大越晚） */
export interface DateRange {
  /** 最早可能年（区间下界） */
  early: number;
  /** 最晚可能年（区间上界） */
  late: number;
  /** 证据说明，如“陶片” */
  label: string;
}

export interface Unit {
  /** 跨假设稳定身份 */
  id: string;
  /** 现场编号，如 [201] */
  code: string;
  /** 描述 */
  note: string;
  kind: UnitKind;
  dates: DateRange[];
  phaseId: string | null;
}

/** 直接早晚关系：younger 晚于（压着）older */
export interface AboveRelation {
  id: string;
  younger: string;
  older: string;
  note: string;
}

/** 等同关系：两个单元同期、互为同一地层事件 */
export interface Equivalence {
  id: string;
  a: string;
  b: string;
}

export interface Phase {
  id: string;
  name: string;
  /** 分期次序，越大越晚 */
  rank: number;
}

export interface Hypothesis {
  id: string;
  name: string;
  unitIds: string[];
  units: Record<string, Unit>;
  above: AboveRelation[];
  equivs: Equivalence[];
  phases: Phase[];
  /** 等同类 root -> 用户手调坐标 */
  positions: Record<string, { x: number; y: number }>;
}

/** 矛盾链中的一步 */
export interface ChainStep {
  kind: 'above' | 'equiv';
  refId: string;
  from: string;
  to: string;
}

export interface ConflictChain {
  /** 人类可读说明 */
  message: string;
  /** 闭合的矛盾链（边序列，沿晚→早/等同方向） */
  steps: ChainStep[];
  /** 链上涉及的单元 id */
  unitIds: string[];
  /** 链上涉及的关系/等同 id */
  edgeIds: string[];
}

/** 被拦截、保留待处理的修改意图；conflict 为 null 表示随其它证据删除矛盾已解除，可应用 */
export type PendingChange =
  | { id: string; type: 'above'; younger: string; older: string; note: string; conflict: ConflictChain | null; createdAt: number }
  | { id: string; type: 'equiv'; a: string; b: string; conflict: ConflictChain | null; createdAt: number };

export type Selection =
  | { type: 'unit'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'none' };

// ---------- 证据复核 ----------

/** 复核处理意向：保留（维持证据）/ 撤回（候选中移除）/ 暂不采用（待定，不改动） */
export type ReviewAction = 'keep' | 'retract' | 'defer';

export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  keep: '保留',
  retract: '撤回',
  defer: '暂不采用',
};

/**
 * 复核对象：一条待审证据。
 * 年代/分期携带创建时的值快照，目标被编辑后仍能按内容定位或辨认。
 */
export type ReviewTarget =
  | { kind: 'date'; unitId: string; index: number; snapshot: DateRange }
  | { kind: 'phase'; unitId: string; snapshot: string | null }
  | { kind: 'above'; relId: string }
  | { kind: 'equiv'; equivId: string };

/** 一条待审变更（候选变更栏中的一行） */
export interface ReviewItem {
  id: string;
  target: ReviewTarget;
  action: ReviewAction;
  note: string;
  /** 创建时的目标描述快照（目标被删后仍可辨认） */
  label: string;
  createdAt: number;
}

/** 针对某一套假设的复核会话；候选快照由当前假设 + items 实时重算，不落库 */
export interface ReviewSession {
  id: string;
  /** 复核针对的假设 */
  hypothesisId: string;
  items: ReviewItem[];
  createdAt: number;
}

export interface ProjectState {
  hypotheses: Record<string, Hypothesis>;
  hypothesisOrder: string[];
  currentId: string;
  selection: Selection;
  pending: PendingChange | null;
  /** 解释模式：选中的两个单元（晚起点 → 早终点） */
  explain: { from: string | null; to: string | null };
  /** 进行中的证据复核会话（若有） */
  review: ReviewSession | null;
}
