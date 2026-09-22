// 证据复核：候选隔离、传播差异、悬空引用、事务历史、持久化
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Hypothesis, ReviewItem, ReviewTarget } from '../lib/types';
import { buildCandidate, describeTarget, targetKey } from '../lib/review';
import { propagate } from '../lib/dates';
import { quotient, transitiveReduction, findAnyCycle } from '../lib/graph';
import { makeHypothesis } from './makeHypothesis';
import { store } from '../lib/store';
import { createSampleHypothesis, REVIEW_DEMO_ID } from '../lib/sample';

let seq = 0;
function item(target: ReviewTarget, action: ReviewItem['action'] = 'retract'): ReviewItem {
  seq += 1;
  return { id: `ri_${seq}`, target, action, note: '', label: '', createdAt: 0 };
}

function currentHypothesis(): Hypothesis {
  const p = store.getState().project;
  return p.hypotheses[p.currentId];
}

beforeEach(() => {
  store.resetToSample();
});

describe('候选隔离', () => {
  it('buildCandidate 不改动输入假设，候选为隔离副本', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'b'], ['c', 'd']],
      equivs: [['b', 'c']],
    });
    const before = JSON.stringify(h);
    const res = buildCandidate(h, [item({ kind: 'equiv', equivId: 'eq1' })]);
    // 输入未被污染
    expect(JSON.stringify(h)).toBe(before);
    expect(h.equivs).toHaveLength(1);
    // 候选中等同被撤回、类被拆开
    expect(res.hypothesis.equivs).toHaveLength(0);
    expect(quotient(res.hypothesis).classes.roots).toHaveLength(4);
    expect(quotient(h).classes.roots).toHaveLength(3);
    expect(findAnyCycle(res.hypothesis)).toBeNull();
  });

  it('暂存候选不改动当前矩阵，也不产生撤销历史', () => {
    const projectBefore = store.getState().project;
    const histState = store.getHistory().state;
    store.startReview();
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
    store.addReviewItem({ kind: 'above', relId: 'r5' }, 'keep');
    const st = store.getState();
    expect(st.project).toBe(projectBefore); // 项目数据引用未变
    expect(store.getHistory().state).toBe(histState); // 历史未推进
    expect(currentHypothesis().equivs).toHaveLength(1);
    expect(st.session.review?.items).toHaveLength(2);
  });

  it('同一目标重复加入只更新意向，不产生重复项', () => {
    store.startReview();
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'keep');
    const items = store.getState().session.review!.items;
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('keep');
    expect(targetKey(items[0].target)).toBe('equiv:e1');
  });
});

describe('传播差异与冲突增减', () => {
  // 传递链 a>b≡c>d；a 的遗物要求不晚于 780，d 的要求不早于 1000 → 沿链无解
  const build = (): Hypothesis =>
    makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'b'], ['c', 'd']],
      equivs: [['b', 'c']],
      dates: {
        a: [{ early: 700, late: 780, label: '晚证据' }],
        d: [{ early: 1000, late: 1080, label: '早证据' }],
      },
    });

  it('撤回等同：类拆分、冲突解除、年代界前后值改变，影响单元齐全', () => {
    const h = build();
    expect(propagate(h).dateConflicts).toHaveLength(1);
    const res = buildCandidate(h, [item({ kind: 'equiv', equivId: 'eq1' })]);
    const { diff } = res;
    expect(diff.splitPairs).toEqual([['b', 'c']]);
    expect(diff.conflictsBefore).toBe(1);
    expect(diff.conflictsAfter).toBe(0);
    expect(diff.resolvedConflicts).toHaveLength(1);
    expect(diff.newConflicts).toHaveLength(0);
    // 年代界前后值：a 的最早年不再被 d 抬升；d 的最晚年不再被 a 压低
    const bcA = diff.boundChanges.find((b) => b.members.includes('a'))!;
    expect(bcA.before.early).toBe(1000);
    expect(bcA.after.early).toBe(700);
    const bcD = diff.boundChanges.find((b) => b.members.includes('d'))!;
    expect(bcD.before.late).toBe(780);
    expect(bcD.after.late).toBe(1080);
  });

  it('影响单元按编号排序且覆盖全部四个单元', () => {
    const h = build();
    const res = buildCandidate(h, [item({ kind: 'equiv', equivId: 'eq1' })]);
    expect([...res.diff.affectedUnits].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('保留 / 暂不采用不改变候选结果', () => {
    const h = build();
    for (const action of ['keep', 'defer'] as const) {
      const res = buildCandidate(h, [item({ kind: 'equiv', equivId: 'eq1' }, action)]);
      expect(res.applied).toHaveLength(0);
      expect(res.hypothesis.equivs).toHaveLength(1);
      expect(res.diff.affectedUnits).toHaveLength(0);
      expect(res.diff.conflictsAfter).toBe(res.diff.conflictsBefore);
      expect(res.diff.boundChanges).toHaveLength(0);
    }
  });

  it('撤回关系使被约简隐藏的连线重新成为直接连线', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c'],
      edges: [['a', 'b'], ['b', 'c'], ['a', 'c']], // rel3 被 rel1+rel2 传递覆盖
    });
    expect(transitiveReduction(h).has('rel3')).toBe(true);
    const res = buildCandidate(h, [item({ kind: 'above', relId: 'rel2' })]);
    expect(res.diff.removedEdgeIds).toEqual(['rel2']);
    expect(res.diff.unhiddenEdgeIds).toEqual(['rel3']);
    expect(transitiveReduction(res.hypothesis).size).toBe(0);
  });

  it('撤回出土物年代解除年代冲突；下标漂移时按内容定位', () => {
    const h = makeHypothesis({
      ids: ['a', 'b'],
      edges: [['a', 'b']],
      dates: {
        a: [{ early: 100, late: 200, label: '晚' }],
        b: [{ early: 900, late: 1000, label: '早' }],
      },
    });
    expect(propagate(h).dateConflicts).toHaveLength(1);
    const res = buildCandidate(h, [
      item({ kind: 'date', unitId: 'b', index: 0, snapshot: { early: 900, late: 1000, label: '早' } }),
    ]);
    expect(res.hypothesis.units.b.dates).toHaveLength(0);
    expect(res.diff.conflictsAfter).toBe(0);

    // 下标漂移：目标年代前被插入新条目，仍按值快照撤回正确的一条
    const h2 = makeHypothesis({
      ids: ['a', 'b'],
      edges: [['a', 'b']],
      dates: {
        a: [{ early: 100, late: 200, label: '晚' }],
        b: [
          { early: 500, late: 600, label: '新插入' },
          { early: 900, late: 1000, label: '早' },
        ],
      },
    });
    const res2 = buildCandidate(h2, [
      item({ kind: 'date', unitId: 'b', index: 0, snapshot: { early: 900, late: 1000, label: '早' } }),
    ]);
    expect(res2.hypothesis.units.b.dates).toEqual([{ early: 500, late: 600, label: '新插入' }]);
  });

  it('撤回人工分期后分期界重新计算', () => {
    const phases = [
      { id: 'p1', name: '早期', rank: 1 },
      { id: 'p2', name: '晚期', rank: 2 },
    ];
    const h = makeHypothesis({
      ids: ['a', 'b'],
      edges: [['a', 'b']],
      phases,
      unitPhase: { a: 'p2', b: 'p1' },
    });
    const res = buildCandidate(h, [item({ kind: 'phase', unitId: 'a', snapshot: 'p2' })]);
    expect(res.hypothesis.units.a.phaseId).toBeNull();
    const bcA = res.diff.boundChanges.find((b) => b.members.includes('a'))!;
    expect(bcA.before.phaseHi).toBe(2);
    expect(bcA.after.phaseHi).toBeNull();
  });
});

describe('悬空引用与无法定位', () => {
  it('复核目标已不存在：给出无法定位警告，候选不应用该项', () => {
    const h = makeHypothesis({ ids: ['a', 'b'], edges: [['a', 'b']] });
    const res = buildCandidate(h, [item({ kind: 'above', relId: 'relX' })]);
    expect(res.warnings.some((w) => w.type === 'missing-target')).toBe(true);
    expect(res.applied).toHaveLength(0);
    expect(res.hypothesis.above).toHaveLength(1);
  });

  it('撤回后单元失去全部关联：悬空提示而非静默删除', () => {
    const h = makeHypothesis({ ids: ['a', 'b'], equivs: [['a', 'b']] });
    const res = buildCandidate(h, [item({ kind: 'equiv', equivId: 'eq1' })]);
    const isolated = res.warnings
      .filter((w) => w.type === 'isolated-unit')
      .map((w) => w.unitId)
      .sort();
    expect(isolated).toEqual(['a', 'b']);
    expect(res.hypothesis.unitIds).toEqual(['a', 'b']); // 单元保留
  });

  it('候选中手动布局失去对应等同类：悬空布局警告', () => {
    const h = makeHypothesis({ ids: ['a', 'b'], equivs: [['a', 'b']] });
    h.positions = { ghost_root: { x: 10, y: 20 } };
    const res = buildCandidate(h, []);
    expect(res.warnings.some((w) => w.type === 'dangling-position')).toBe(true);
  });

  it('暂存后目标被直接删除：复核项变为无法定位，采用时跳过', () => {
    store.startReview();
    store.addReviewItem({ kind: 'above', relId: 'r5' }, 'retract');
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
    store.deleteAbove('r5'); // 复核外直接删除目标
    const n = currentHypothesis().above.length;
    const res = buildCandidate(currentHypothesis(), store.getState().session.review!.items);
    expect(res.warnings.some((w) => w.type === 'missing-target')).toBe(true);
    expect(store.adoptReview()).toBe(true);
    expect(currentHypothesis().above).toHaveLength(n); // r5 已不在，不重复删
    expect(currentHypothesis().equivs).toHaveLength(0); // 等同仍被撤回
  });
});

describe('采用事务与撤销重做', () => {
  it('采用作为一条可撤销事务写入；撤销恢复、重做再应用', () => {
    store.startReview();
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
    expect(currentHypothesis().equivs).toHaveLength(1);
    expect(store.adoptReview()).toBe(true);
    expect(currentHypothesis().equivs).toHaveLength(0);
    expect(store.getState().session.review).toBeNull();
    store.undo();
    expect(currentHypothesis().equivs).toHaveLength(1);
    store.redo();
    expect(currentHypothesis().equivs).toHaveLength(0);
  });

  it('仅保留/暂不采用时采用不产生空历史事务', () => {
    const histState = store.getHistory().state;
    store.startReview();
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'keep');
    store.addReviewItem({ kind: 'above', relId: 'r5' }, 'defer');
    expect(store.adoptReview()).toBe(true);
    expect(store.getHistory().state).toBe(histState);
    expect(currentHypothesis().equivs).toHaveLength(1);
    expect(store.getState().session.review).toBeNull();
  });

  it('取消复核丢弃候选且矩阵不变', () => {
    const histState = store.getHistory().state;
    store.startReview();
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
    store.cancelReview();
    expect(store.getState().session.review).toBeNull();
    expect(store.getHistory().state).toBe(histState);
    expect(currentHypothesis().equivs).toHaveLength(1);
  });

  it('复核会话与假设绑定：属于其它假设时不允许采用', () => {
    store.startReview();
    store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
    store.duplicateHypothesis('另一解释'); // 切换走，复核留在原假设
    expect(store.adoptReview()).toBe(false);
    expect(store.getState().session.review).not.toBeNull(); // 会话保留
  });
});

describe('复核会话持久化与刷新恢复', () => {
  it('复核会话写入 localStorage，刷新后恢复', async () => {
    vi.useFakeTimers();
    try {
      store.startReview();
      store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
      vi.advanceTimersByTime(400);
      const raw = localStorage.getItem('harris-workbench-review-v1');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).items).toHaveLength(1);
      const currentId = store.getState().project.currentId;

      vi.resetModules(); // 模拟刷新：重新加载 store 模块
      const fresh = await import('../lib/store');
      const rv = fresh.store.getState().session.review;
      expect(rv).not.toBeNull();
      expect(rv!.hypothesisId).toBe(currentId);
      expect(rv!.items).toHaveLength(1);
      expect(rv!.items[0].action).toBe('retract');
    } finally {
      vi.useRealTimers();
    }
  });

  it('取消复核后持久化键被清除', () => {
    vi.useFakeTimers();
    try {
      store.startReview();
      store.addReviewItem({ kind: 'equiv', equivId: 'e1' }, 'retract');
      vi.advanceTimersByTime(400);
      expect(localStorage.getItem('harris-workbench-review-v1')).toBeTruthy();
      store.cancelReview();
      vi.advanceTimersByTime(400);
      expect(localStorage.getItem('harris-workbench-review-v1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('旧版 localStorage（无复核键）照常打开，复核为空', async () => {
    // 等待上一个用例的防抖写入结束，避免覆盖种子数据
    await new Promise((r) => setTimeout(r, 300));
    const old = createSampleHypothesis('h_old', '旧版项目');
    localStorage.setItem(
      'harris-workbench-v1',
      JSON.stringify({ hypotheses: { h_old: old }, hypothesisOrder: ['h_old'], currentId: 'h_old' }),
    );
    localStorage.removeItem('harris-workbench-review-v1');
    vi.resetModules();
    const fresh = await import('../lib/store');
    const st = fresh.store.getState();
    expect(st.project.currentId).toBe('h_old');
    expect(st.project.hypotheses.h_old.unitIds.length).toBeGreaterThan(0);
    expect(st.session.review).toBeNull();
  });

  it('复核键损坏时忽略并正常打开', async () => {
    await new Promise((r) => setTimeout(r, 300));
    localStorage.setItem('harris-workbench-review-v1', '{oops');
    vi.resetModules();
    const fresh = await import('../lib/store');
    expect(fresh.store.getState().session.review).toBeNull();
  });
});

describe('内置复核演示案例', () => {
  it('撤回等同拆分类并解除冲突链；保留则无变化；载入幂等', () => {
    store.loadReviewDemo();
    const h = currentHypothesis();
    expect(h.id).toBe(REVIEW_DEMO_ID);
    expect(h.unitIds).toHaveLength(4);
    expect(h.equivs).toHaveLength(1);
    // 两条年代证据
    expect(h.unitIds.filter((id) => h.units[id].dates.length > 0)).toHaveLength(2);
    // 当前一处年代冲突，矛盾链穿过等同
    const prop = propagate(h);
    expect(prop.dateConflicts).toHaveLength(1);
    expect(prop.dateConflicts[0].steps.some((s) => s.kind === 'equiv')).toBe(true);

    // 预置的候选即“撤回等同”
    const review = store.getState().session.review!;
    expect(review.hypothesisId).toBe(REVIEW_DEMO_ID);
    expect(review.items).toHaveLength(1);
    expect(review.items[0].action).toBe('retract');
    const res = buildCandidate(h, review.items);
    expect(res.diff.conflictsBefore).toBe(1);
    expect(res.diff.conflictsAfter).toBe(0);
    expect(res.diff.splitPairs).toHaveLength(1);
    expect(res.diff.affectedUnits).toHaveLength(4);

    // 改标保留：结果不变
    store.setReviewAction(review.items[0].id, 'keep');
    const res2 = buildCandidate(h, store.getState().session.review!.items);
    expect(res2.diff.affectedUnits).toHaveLength(0);
    expect(res2.diff.conflictsAfter).toBe(1);

    // 再次载入不重复建假设
    const n = store.getState().project.hypothesisOrder.length;
    store.loadReviewDemo();
    expect(store.getState().project.hypothesisOrder).toHaveLength(n);
    expect(store.getState().project.currentId).toBe(REVIEW_DEMO_ID);
  });

  it('演示案例采用后可撤销', () => {
    store.loadReviewDemo();
    expect(store.adoptReview()).toBe(true);
    expect(currentHypothesis().equivs).toHaveLength(0);
    expect(propagate(currentHypothesis()).dateConflicts).toHaveLength(0);
    store.undo();
    expect(currentHypothesis().equivs).toHaveLength(1);
  });
});

describe('目标描述', () => {
  it('describeTarget 覆盖四类证据；目标缺失返回 null', () => {
    const h = createSampleHypothesis();
    expect(describeTarget(h, { kind: 'equiv', equivId: 'e1' })).toContain('[104]');
    expect(describeTarget(h, { kind: 'above', relId: 'r1' })).toContain('晚于');
    expect(
      describeTarget(h, {
        kind: 'date',
        unitId: 'u103',
        index: 0,
        snapshot: { early: 720, late: 780, label: '开元通宝（墙基夯土内）' },
      }),
    ).toContain('开元通宝');
    expect(describeTarget(h, { kind: 'phase', unitId: 'u104', snapshot: 'p2' })).toContain('居住期');
    expect(describeTarget(h, { kind: 'above', relId: 'nope' })).toBeNull();
    expect(describeTarget(h, { kind: 'phase', unitId: 'nope', snapshot: null })).toBeNull();
    expect(
      describeTarget(h, { kind: 'date', unitId: 'u103', index: 3, snapshot: { early: 1, late: 2, label: '不存在' } }),
    ).toBeNull();
  });
});
