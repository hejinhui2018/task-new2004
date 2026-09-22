// 内置示例：小型发掘区 T1
// 时序（早→晚）：生土 → 墙基沟槽 → 石砌墙基 → 居住面(北/南两块记录号，同期)
//   → 晚期排水沟沟槽 → 沟内回填 → 近代坑(切穿回填) → 坑填土 → 表土
import type { Hypothesis, Phase, Unit, AboveRelation, Equivalence } from './types';

const phases: Phase[] = [
  { id: 'p0', name: '建墙前', rank: 0 },
  { id: 'p1', name: '建墙期', rank: 1 },
  { id: 'p2', name: '居住期', rank: 2 },
  { id: 'p3', name: '废弃与排水沟', rank: 3 },
  { id: 'p4', name: '近现代', rank: 4 },
];

const units: Unit[] = [
  {
    id: 'u101', code: '[101]', kind: 'deposit', note: '自然生土，黄褐色黏土',
    dates: [], phaseId: 'p0',
  },
  {
    id: 'u102', code: '[102]', kind: 'cut', note: '墙基沟槽，斜壁平底，切穿 [101]',
    dates: [], phaseId: 'p1',
  },
  {
    id: 'u103', code: '[103]', kind: 'construction', note: '石砌墙基，砌筑于沟槽 [102] 内',
    dates: [{ early: 720, late: 780, label: '开元通宝（墙基夯土内）' }],
    phaseId: 'p1',
  },
  {
    id: 'u104', code: '[104]', kind: 'deposit', note: '居住面堆积（北区），含炭粒',
    dates: [], phaseId: 'p2',
  },
  {
    id: 'u114', code: '[114]', kind: 'deposit', note: '居住面堆积（南区），与 [104] 同一层面',
    dates: [], phaseId: 'p2',
  },
  {
    id: 'u105', code: '[105]', kind: 'cut', note: '晚期排水沟沟槽，切穿墙基 [103] 与生土 [101]',
    dates: [], phaseId: 'p3',
  },
  {
    id: 'u106', code: '[106]', kind: 'deposit', note: '排水沟回填土，灰褐淤土',
    dates: [{ early: 1000, late: 1080, label: '影青瓷片（回填土内）' }],
    phaseId: 'p3',
  },
  {
    id: 'u108', code: '[108]', kind: 'cut', note: '近代坑，切穿排水沟回填 [106]',
    dates: [], phaseId: 'p4',
  },
  {
    id: 'u109', code: '[109]', kind: 'deposit', note: '近代坑填土，含砖瓦碎块',
    dates: [], phaseId: 'p4',
  },
  {
    id: 'u107', code: '[107]', kind: 'deposit', note: '表土（耕土层），覆盖全区',
    dates: [], phaseId: 'p4',
  },
];

// younger 晚于 older
const above: AboveRelation[] = [
  { id: 'r1', younger: 'u102', older: 'u101', note: '沟槽 [102] 切割生土 [101]' },
  { id: 'r2', younger: 'u103', older: 'u102', note: '墙基 [103] 建于沟槽 [102] 内' },
  { id: 'r3', younger: 'u104', older: 'u103', note: '居住面 [104] 压墙基 [103]' },
  { id: 'r4', younger: 'u105', older: 'u103', note: '排水沟 [105] 切穿墙基 [103]' },
  // r5 与 r4+r2+r1 表达的传递关系重复，矩阵中自动隐藏，可点选解释
  { id: 'r5', younger: 'u105', older: 'u101', note: '排水沟 [105] 亦切入生土 [101]（间接）' },
  { id: 'r6', younger: 'u106', older: 'u105', note: '回填土 [106] 填充排水沟 [105]' },
  { id: 'r7', younger: 'u108', older: 'u106', note: '近代坑 [108] 切穿回填 [106]' },
  { id: 'r8', younger: 'u109', older: 'u108', note: '坑填土 [109] 填充近代坑 [108]' },
  { id: 'r9', younger: 'u107', older: 'u104', note: '表土 [107] 压居住面 [104]' },
  { id: 'r10', younger: 'u107', older: 'u109', note: '表土 [107] 压坑填土 [109]' },
];

const equivs: Equivalence[] = [
  { id: 'e1', a: 'u104', b: 'u114' },
];

export function createSampleHypothesis(id = 'h_main', name = '主解释（T1 发掘区）'): Hypothesis {
  return {
    id,
    name,
    unitIds: units.map((u) => u.id),
    units: Object.fromEntries(units.map((u) => [u.id, structuredClone(u)])),
    above: above.map((r) => ({ ...r })),
    equivs: equivs.map((e) => ({ ...e })),
    phases: phases.map((p) => ({ ...p })),
    positions: {},
  };
}

// ---------- 证据复核内置案例：T2 探沟 ----------
// 时序（早→晚）：早期垫土 [205] → 中部淤土 [203] → 晚期沟内堆积（北区 [201] / 南区 [204] 两条记录，等同）
// 撤回等同 e201 前：[204]「纪年砖」最晚 600 与 [205]「碳样」最早 900 的最短冲突链
// 经等同 [204]＝[201] 走间接记录 r204；撤回后类拆开，冲突仍在，但链改走 r202→r203，
// [201] 的最晚年界由 600（来自 [204]）放宽为“不限”。保留等同则一切结果不变。
// r204（[201] 直接晚于 [205]）由 r201+r203 传递表达，矩阵中隐藏。

export const REVIEW_CASE_ID = 'h_review_case';

const reviewUnits: Unit[] = [
  {
    id: 'u201', code: '[201]', kind: 'deposit', note: '晚期沟内堆积（北区记录），与 [204] 同一层位',
    dates: [], phaseId: null,
  },
  {
    id: 'u204', code: '[204]', kind: 'deposit', note: '晚期沟内堆积（南区记录），出纪年砖',
    dates: [{ early: 500, late: 600, label: '纪年砖（沟内堆积）' }],
    phaseId: null,
  },
  {
    id: 'u203', code: '[203]', kind: 'deposit', note: '中部淤土层',
    dates: [], phaseId: null,
  },
  {
    id: 'u205', code: '[205]', kind: 'deposit', note: '早期垫土，碳样取自此层',
    dates: [{ early: 900, late: 1000, label: '碳十四样（早期垫土）' }],
    phaseId: null,
  },
];

const reviewAbove: AboveRelation[] = [
  { id: 'r201', younger: 'u201', older: 'u203', note: '北区分层 [201] 压淤土 [203]' },
  { id: 'r202', younger: 'u204', older: 'u203', note: '南区分层 [204] 压淤土 [203]' },
  { id: 'r203', younger: 'u203', older: 'u205', note: '淤土 [203] 压早期垫土 [205]' },
  // r204 由 r201+r203 传递表达，矩阵中自动隐藏
  { id: 'r204', younger: 'u201', older: 'u205', note: '北区 [201] 整体晚于垫土 [205]（间接）' },
];

const reviewEquivs: Equivalence[] = [
  { id: 'e201', a: 'u201', b: 'u204' },
];

export function createReviewCaseHypothesis(
  id: string = REVIEW_CASE_ID,
  name: string = '复核案例（T2 探沟）',
): Hypothesis {
  return {
    id,
    name,
    unitIds: reviewUnits.map((u) => u.id),
    units: Object.fromEntries(reviewUnits.map((u) => [u.id, structuredClone(u)])),
    above: reviewAbove.map((r) => ({ ...r })),
    equivs: reviewEquivs.map((e) => ({ ...e })),
    phases: [],
    positions: {},
  };
}
