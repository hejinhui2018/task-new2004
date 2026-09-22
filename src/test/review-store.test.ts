// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../lib/store';
import { createSampleHypothesis, createReviewCaseHypothesis, REVIEW_CASE_ID } from '../lib/sample';
import { propagate } from '../lib/dates';

const STORAGE_KEY = 'harris-workbench-v1';

/** 等待持久化防抖（250ms）落盘 */
const settlePersist = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 320));
};

beforeEach(async () => {
  localStorage.clear();
  store.resetToSample();
  // 等待 resetToSample 的持久化防抖落盘后再清空，避免跨用例定时器覆写
  await new Promise((r) => setTimeout(r, 300));
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('候选隔离', () => {
  it('建立候选与切换处置都不改动当前矩阵，也不进撤销栈', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    const h0 = store.getState().project.hypotheses[REVIEW_CASE_ID];
    const equivCount = h0.equivs.length;

    const id = store.addReviewItem({ evidence: 'equiv', refId: 'e201' });
    store.setReviewDisposition(id, 'withdraw');

    const h1 = store.getState().project.hypotheses[REVIEW_CASE_ID];
    expect(h1.equivs).toHaveLength(equivCount); // 当前矩阵未变
    // 候选编辑不进历史：history.state 引用保持不变
    const histState = store.getHistory().state;
    store.setReviewDisposition(id, 'defer');
    store.setReviewDisposition(id, 'withdraw');
    store.updateReviewNote(id, '复核备注');
    expect(store.getHistory().state).toBe(histState);
    // 候选差异可算出且标记为撤回
    const diff = store.getReviewDiff()!;
    expect(diff.split).toEqual([['u201', 'u204']]);
  });

  it('取消候选丢弃全部待审变更，矩阵不变', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    const before = JSON.stringify(store.getState().project.hypotheses[REVIEW_CASE_ID]);
    const id = store.addReviewItem({ evidence: 'equiv', refId: 'e201' });
    store.setReviewDisposition(id, 'withdraw');
    store.cancelReview();
    expect(store.getReviewItems()).toHaveLength(0);
    expect(JSON.stringify(store.getState().project.hypotheses[REVIEW_CASE_ID])).toBe(before);
  });

  it('候选按假设隔离：切换假设看不到另一假设的候选', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    store.addReviewItem({ evidence: 'equiv', refId: 'e201' });
    expect(store.getReviewItems()).toHaveLength(1);
    store.switchHypothesis('h_main');
    expect(store.getReviewItems()).toHaveLength(0);
    store.switchHypothesis(REVIEW_CASE_ID);
    expect(store.getReviewItems()).toHaveLength(1);
  });
});

describe('采用候选：单条可撤销事务', () => {
  it('采用后撤回写入矩阵，一次撤销整体恢复，重做再次生效', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    const id = store.addReviewItem({ evidence: 'equiv', refId: 'e201' });
    store.setReviewDisposition(id, 'withdraw');
    const before = store.getState().project.hypotheses[REVIEW_CASE_ID];
    expect(before.equivs).toHaveLength(1);

    expect(store.adoptReview()).toBe(true);
    const adopted = store.getState().project.hypotheses[REVIEW_CASE_ID];
    expect(adopted.equivs).toHaveLength(0);
    expect(store.getReviewItems()).toHaveLength(0); // 候选已消费
    // 等同类已拆开
    const p = propagate(adopted);
    expect(p.q.classes.roots).toContain('u201');
    expect(p.q.classes.roots).toContain('u204');

    // 单条事务：一次撤销回到采用前
    store.undo();
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(1);
    // 重做再次生效
    store.redo();
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(0);
  });

  it('没有撤回项时不能采用', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    store.addReviewItem({ evidence: 'equiv', refId: 'e201' }); // 默认保留
    expect(store.adoptReview()).toBe(false);
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(1);
  });

  it('采用结果提示记录影响单元数', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    const id = store.addReviewItem({ evidence: 'equiv', refId: 'e201' });
    store.setReviewDisposition(id, 'withdraw');
    store.adoptReview();
    const notice = store.getState().session.notice!;
    expect(notice.withdrawnCount).toBe(1);
    expect(notice.affectedCount).toBeGreaterThan(0);
    expect(notice.orphans).toHaveLength(0);
    store.dismissNotice();
    expect(store.getState().session.notice).toBeNull();
  });
});

describe('悬空引用与无法定位单元', () => {
  it('送审后证据被直接删除：差异明确报告悬空，采用不重复删除且计数', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    store.addReviewItem({ evidence: 'above', refId: 'r202' });
    store.setReviewDisposition(store.getReviewItems()[0].id, 'withdraw');
    // 矩阵被直接编辑：该关系已删除
    store.deleteAbove('r202');
    const diff = store.getReviewDiff()!;
    expect(diff.dangling).toHaveLength(1);
    expect(diff.dangling[0].reason).toContain('已');

    expect(store.adoptReview()).toBe(true);
    const notice = store.getState().session.notice!;
    expect(notice.danglingCount).toBe(1);
    expect(notice.withdrawnCount).toBe(0); // 没有实际删除任何东西
  });

  it('撤回唯一联系后产生无法定位单元：明确提示且单元不被静默删除', () => {
    store.createBlankHypothesis('孤儿用例');
    const a = store.addUnit('a', 'deposit', '');
    const b = store.addUnit('b', 'deposit', '');
    store.addAbove(a, b, '');
    const relId = store.getState().project.hypotheses[store.getState().project.currentId].above[0].id;

    store.addReviewItem({ evidence: 'above', refId: relId });
    store.setReviewDisposition(store.getReviewItems()[0].id, 'withdraw');
    const diff = store.getReviewDiff()!;
    expect(diff.orphans.map((o) => o.unitId).sort()).toEqual([a, b]);

    store.adoptReview();
    const h = store.getState().project.hypotheses[store.getState().project.currentId];
    expect(h.above).toHaveLength(0);
    expect(h.unitIds).toHaveLength(2); // 单元仍在
    expect(store.getState().session.notice!.orphans).toHaveLength(2);
  });

  it('撤回出土物年代后采用，该年代从矩阵移除', () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    const d = createReviewCaseHypothesis().units.u204.dates[0];
    store.addReviewItem({
      evidence: 'date',
      refId: 'date:u204:0',
      unitId: 'u204',
      dateIndex: 0,
      dateSnapshot: { ...d },
    });
    store.setReviewDisposition(store.getReviewItems()[0].id, 'withdraw');
    expect(store.getReviewDiff()!.conflictsRemoved).toHaveLength(1);
    store.adoptReview();
    const h = store.getState().project.hypotheses[REVIEW_CASE_ID];
    expect(h.units.u204.dates).toHaveLength(0);
    expect(propagate(h).dateConflicts).toHaveLength(0);
  });
});

describe('持久化与旧版兼容', () => {
  it('候选写入 localStorage，刷新（重新装载模块）后恢复', async () => {
    store.switchHypothesis(REVIEW_CASE_ID);
    const id = store.addReviewItem({ evidence: 'equiv', refId: 'e201' });
    store.setReviewDisposition(id, 'withdraw');
    store.addReviewItem({ evidence: 'above', refId: 'r203' });
    await settlePersist();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.reviews[REVIEW_CASE_ID].items).toHaveLength(2);
    expect(raw.currentId).toBe(REVIEW_CASE_ID);

    vi.resetModules();
    const { store: store2 } = await import('../lib/store');
    expect(store2.getState().project.currentId).toBe(REVIEW_CASE_ID);
    const items = store2.getState().reviews[REVIEW_CASE_ID].items;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.refId === 'e201')?.disposition).toBe('withdraw');
    // 恢复后差异仍可计算：候选没有因刷新污染矩阵
    expect(store2.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(1);
    expect(store2.getReviewDiff()!.split).toEqual([['u201', 'u204']]);
  });

  it('旧版存档（无 reviews 字段、无复核案例）可直接打开', async () => {
    const main = createSampleHypothesis();
    const legacy = {
      hypotheses: { [main.id]: main },
      hypothesisOrder: [main.id],
      currentId: main.id,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    vi.resetModules();
    const { store: store2 } = await import('../lib/store');
    const s = store2.getState();
    expect(s.project.currentId).toBe('h_main');
    expect(s.project.hypotheses['h_main'].unitIds.length).toBeGreaterThan(0);
    expect(s.reviews).toEqual({});
    // 旧版种子存档自动补上内置复核案例
    expect(s.project.hypothesisOrder).toContain(REVIEW_CASE_ID);
    expect(propagate(s.project.hypotheses[REVIEW_CASE_ID]).dateConflicts).toHaveLength(1);
  });

  it('损坏的存档回退到初始项目', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    vi.resetModules();
    const { store: store2 } = await import('../lib/store');
    expect(store2.getState().project.hypotheses[store2.getState().project.currentId]).toBeTruthy();
  });
});
