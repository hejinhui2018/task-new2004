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

/** 复核处置：保留＝继续采信；撤回＝不再采信（候选中移除）；暂不采用＝本轮搁置（解释中保留） */
export type ReviewDisposition = 'keep' | 'withdraw' | 'defer';

/** 可送审的证据类型：出土物年代 / 人工分期 / 早晚关系 / 等同关系 */
export type EvidenceType = 'date' | 'phase' | 'above' | 'equiv';

/** 一条待审证据变更（在候选快照被采用前不影响当前矩阵） */
export interface ReviewItem {
  id: string;
  evidence: EvidenceType;
  /** above/equiv：关系 id；date：`date:<unitId>:<index>`；phase：`phase:<unitId>` */
  refId: string;
  /** date/phase 证据所在单元 */
  unitId?: string;
  /** date 专用：创建时的下标 */
  dateIndex?: number;
  /** date 专用：创建时的内容快照，用于发现“矩阵已被直接编辑”的过期情况 */
  dateSnapshot?: DateRange;
  disposition: ReviewDisposition;
  note: string;
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
}
