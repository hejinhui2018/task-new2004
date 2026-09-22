import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../lib/types';
import {
  applyReviewItems,
  buildCandidate,
  findDangling,
  findOrphans,
  reviewDiff,
  resolveDateIndex,
} from '../lib/review';
import { createReviewCaseHypothesis } from '../lib/sample';
import { propagate } from '../lib/dates';
import { transitiveReduction } from '../lib/graph';
import { makeHypothesis } from './makeHypothesis';

function item(partial: Partial<ReviewItem> & Pick<ReviewItem, 'evidence' | 'refId'>): ReviewItem {
  return {
    id: `rv_${partial.refId}`,
    disposition: 'withdraw',
    note: '',
    createdAt: 0,
    ...partial,
  };
}

describe('复核案例（T2 探沟）', () => {
  it('初始存在一条年代冲突，最短链经等同走间接记录 r204', () => {
    const h = createReviewCaseHypothesis();
    const p = propagate(h);
    expect(p.dateConflicts).toHaveLength(1);
    const c = p.dateConflicts[0];
    expect(c.youngerEvidence.unitId).toBe('u204');
    expect(c.olderEvidence.unitId).toBe('u205');
    expect(c.steps.map((s) => s.kind)).toEqual(['equiv', 'above']);
    expect(c.steps.map((s) => s.refId)).toEqual(['e201', 'r204']);
    // r204 是被约简隐藏的间接记录
    expect(transitiveReduction(h).has('r204')).toBe(true);
  });

  it('撤回等同：类拆开、冲突仍在但冲突链改道，[201] 最晚年界放宽', () => {
    const h = createReviewCaseHypothesis();
    const items = [item({ evidence: 'equiv', refId: 'e201' })];
    const d = reviewDiff(h, items);

    // 等同类被拆开
    expect(d.split).toEqual([['u201', 'u204']]);
    expect(d.merged).toHaveLength(0);
    // 冲突数量不变（1→1），但证据集/链改变：旧链解除、新链出现
    expect(d.conflictsBefore).toHaveLength(1);
    expect(d.conflictsAfter).toHaveLength(1);
    expect(d.conflictsRemoved).toHaveLength(1);
    expect(d.conflictsAdded).toHaveLength(1);
    const removedChain = d.conflictsRemoved[0].chain!;
    const addedChain = d.conflictsAdded[0].chain!;
    expect(removedChain.steps.map((s) => s.refId)).toEqual(['e201', 'r204']);
    expect(addedChain.steps.map((s) => s.refId)).toEqual(['r202', 'r203']);
    // [201] 的最晚年上界由 600（来自 [204] 纪年砖）放宽为不限
    const latestChange = d.boundChanges.find((c) => c.unitId === 'u201' && c.kind === 'latest');
    expect(latestChange).toMatchObject({ before: 600, after: null });
    // 受影响单元：等同两端 + 冲突远端 [205]
    expect(d.affectedUnitIds.sort()).toEqual(['u201', 'u204', 'u205']);
    // 没有悬空或无法定位单元
    expect(d.dangling).toHaveLength(0);
    expect(d.orphans).toHaveLength(0);
  });

  it('保留等同：候选结果与当前解释完全一致', () => {
    const h = createReviewCaseHypothesis();
    const items = [item({ evidence: 'equiv', refId: 'e201', disposition: 'keep' })];
    const d = reviewDiff(h, items);
    expect(d.split).toHaveLength(0);
    expect(d.merged).toHaveLength(0);
    expect(d.boundChanges).toHaveLength(0);
    expect(d.conflictsAdded).toHaveLength(0);
    expect(d.conflictsRemoved).toHaveLength(0);
    expect(d.affectedUnitIds).toHaveLength(0);
  });

  it('暂不采用与保留同样不改变解释', () => {
    const h = createReviewCaseHypothesis();
    const d = reviewDiff(h, [item({ evidence: 'equiv', refId: 'e201', disposition: 'defer' })]);
    expect(d.affectedUnitIds).toHaveLength(0);
    expect(d.split).toHaveLength(0);
  });

  it('撤回纪年砖年代：冲突被解除，类内最晚年界放宽', () => {
    const h = createReviewCaseHypothesis();
    const d0 = h.units.u204.dates[0];
    const items = [
      item({
        evidence: 'date',
        refId: 'date:u204:0',
        unitId: 'u204',
        dateIndex: 0,
        dateSnapshot: { ...d0 },
      }),
    ];
    const d = reviewDiff(h, items);
    expect(d.conflictsBefore).toHaveLength(1);
    expect(d.conflictsAfter).toHaveLength(0);
    expect(d.conflictsRemoved).toHaveLength(1);
    expect(d.conflictsAdded).toHaveLength(0);
    // 候选快照中纪年砖已移除
    const cand = buildCandidate(h, items);
    expect(cand.units.u204.dates).toHaveLength(0);
    // 界值变化里包含最晚年 600 → 不限
    expect(
      d.boundChanges.some((c) => c.kind === 'latest' && c.before === 600 && c.after === null),
    ).toBe(true);
  });
});

describe('候选隔离', () => {
  it('reviewDiff/buildCandidate 不修改当前假设', () => {
    const h = createReviewCaseHypothesis();
    const before = JSON.stringify(h);
    const items = [
      item({ evidence: 'equiv', refId: 'e201' }),
      item({ evidence: 'above', refId: 'r202' }),
    ];
    const cand = buildCandidate(h, items);
    reviewDiff(h, items);
    expect(JSON.stringify(h)).toBe(before);
    // 仅副本变化
    expect(cand.equivs).toHaveLength(0);
    expect(h.equivs).toHaveLength(1);
    expect(cand.above).toHaveLength(h.above.length - 1);
  });

  it('applyReviewItems 返回无法落实的撤回条目（悬空）', () => {
    const h = createReviewCaseHypothesis();
    const cand = structuredClone(h);
    const unresolved = applyReviewItems(cand, [
      item({ evidence: 'above', refId: 'r-not-exist' }),
      item({ evidence: 'equiv', refId: 'e201' }),
    ]);
    expect(unresolved).toHaveLength(1);
    expect(cand.equivs).toHaveLength(0);
  });
});

describe('悬空引用', () => {
  it('引用已删除的早晚/等同关系报 missing', () => {
    const h = createReviewCaseHypothesis();
    const d = findDangling(h, [
      item({ evidence: 'above', refId: 'rx' }),
      item({ evidence: 'equiv', refId: 'ex' }),
    ]);
    expect(d.map((x) => x.status)).toEqual(['missing', 'missing']);
  });

  it('引用已删除或已被直接编辑的出土物年代分别报 missing/stale', () => {
    const h = createReviewCaseHypothesis();
    const stale = item({
      evidence: 'date',
      refId: 'date:u204:0',
      unitId: 'u204',
      dateIndex: 0,
      dateSnapshot: { early: 400, late: 450, label: '旧实验室数值' },
    });
    const missing = item({
      evidence: 'date',
      refId: 'date:u203:2',
      unitId: 'u203',
      dateIndex: 2,
    });
    const d = findDangling(h, [stale, missing]);
    expect(d.find((x) => x.itemId === stale.id)?.status).toBe('stale');
    expect(d.find((x) => x.itemId === missing.id)?.status).toBe('missing');
  });

  it('年代按下标漂移后仍可按内容快照定位', () => {
    const h = createReviewCaseHypothesis();
    // 模拟在前面插入了一条新年代表：原纪年砖现在位于下标 1
    h.units.u204.dates.unshift({ early: 1, late: 2, label: '后补记录' });
    const idx = resolveDateIndex(h, 'u204', 0, { early: 500, late: 600, label: '纪年砖（沟内堆积）' });
    expect(idx).toBe(1);
  });

  it('内容已被直接编辑（stale）时采用不会误删下标处的另一条证据', () => {
    const h = createReviewCaseHypothesis();
    const cand = structuredClone(h);
    const unresolved = applyReviewItems(cand, [
      item({
        evidence: 'date',
        refId: 'date:u204:0',
        unitId: 'u204',
        dateIndex: 0,
        dateSnapshot: { early: 400, late: 450, label: '已被实验室复核改掉的旧值' },
      }),
    ]);
    expect(unresolved).toHaveLength(1);
    expect(cand.units.u204.dates).toHaveLength(1); // 当前纪年砖保留
  });

  it('撤回已删除单元的人工分期报 missing', () => {
    const h = createReviewCaseHypothesis();
    const d = findDangling(h, [item({ evidence: 'phase', refId: 'phase:u999', unitId: 'u999' })]);
    expect(d[0].status).toBe('missing');
  });
});

describe('无法定位的单元', () => {
  it('撤回唯一联系后单元成为孤儿，但不被删除', () => {
    const base = makeHypothesis({ ids: ['a', 'b'], edges: [['a', 'b']] });
    const cand = structuredClone(base);
    applyReviewItems(cand, [item({ evidence: 'above', refId: 'rel1' })]);
    const orphans = findOrphans(base, cand);
    expect(orphans.map((o) => o.unitId).sort()).toEqual(['a', 'b']);
    // 单元仍保留在候选中
    expect(cand.unitIds).toHaveLength(2);
  });

  it('仍有其他联系的单元不算孤儿', () => {
    const base = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['a', 'c']] });
    const cand = structuredClone(base);
    applyReviewItems(cand, [item({ evidence: 'above', refId: 'rel1' })]);
    // a 仍经 rel2 连 c；b 失去联系成为孤儿
    const orphans = findOrphans(base, cand);
    expect(orphans.map((o) => o.unitId)).toEqual(['b']);
  });
});

describe('传播差异与传递约简', () => {
  it('撤回链中关系使被隐藏的直接边重新出现', () => {
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c'], ['a', 'c']] });
    expect(transitiveReduction(h).has('rel3')).toBe(true);
    const d = reviewDiff(h, [item({ evidence: 'above', refId: 'rel2' })]);
    expect(d.reducedRemoved).toContain('rel3');
  });

  it('撤回人工分期后分期界变化', () => {
    const h = makeHypothesis({
      ids: ['a'],
      phases: [{ id: 'p1', name: '一期', rank: 1 }],
      unitPhase: { a: 'p1' },
    });
    const items = [item({ evidence: 'phase', refId: 'phase:a', unitId: 'a' })];
    const d = reviewDiff(h, items);
    expect(d.boundChanges.filter((c) => c.kind.startsWith('phase')).map((c) => [c.kind, c.before, c.after]))
      .toEqual([['phaseLo', 1, null], ['phaseHi', 1, null]]);
    expect(buildCandidate(h, items).units.a.phaseId).toBeNull();
  });

  it('撤回年代下界后传播链上的最早界同步下降', () => {
    const h = makeHypothesis({
      ids: ['a', 'c'],
      edges: [['a', 'c']],
      dates: {
        a: [{ early: 1000, late: 1100, label: '晚' }],
        c: [{ early: 800, late: 900, label: '早' }],
      },
    });
    const d = reviewDiff(h, [
      item({
        evidence: 'date',
        refId: 'date:c:0',
        unitId: 'c',
        dateIndex: 0,
        dateSnapshot: { early: 800, late: 900, label: '早' },
      }),
    ]);
    // c 自身证据撤回后：最早界放开；最晚年仍由较晚的 a 传播为 1100（来源从 c 变为 a）
    const cEarliest = d.boundChanges.find((x) => x.unitId === 'c' && x.kind === 'earliest');
    const cLatest = d.boundChanges.find((x) => x.unitId === 'c' && x.kind === 'latest');
    expect(cEarliest).toMatchObject({ before: 800, after: null });
    expect(cLatest).toMatchObject({ before: 900, after: 1100 });
    expect(cLatest?.afterSource?.unitId).toBe('a');
  });
});
