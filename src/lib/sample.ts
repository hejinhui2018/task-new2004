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
