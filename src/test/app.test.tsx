// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { store } from '../lib/store';
import { REVIEW_CASE_ID } from '../lib/sample';

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  store.resetToSample();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('App 冒烟挂载', () => {
  it('渲染标题、示例单元与直接连线', () => {
    const text = container.textContent ?? '';
    expect(text).toContain('Harris 地层矩阵工作台');
    expect(text).toContain('[103]'); // 墙基
    expect(text).toContain('表土');
    // 画布中存在节点矩形与边
    expect(container.querySelectorAll('rect.node-rect').length).toBeGreaterThanOrEqual(9);
  });

  it('切到年代页可见传播结果且示例自洽', async () => {
    const btn = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('年代/分期'),
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const text = container.textContent ?? '';
    expect(text).toContain('传播后的可行年代');
    expect(text).toContain('年代与分期自洽');
    // 影青瓷片的 1000~1080 与开元通宝 720~780 均展示
    expect(text).toContain('1000');
    expect(text).toContain('780');
  });

  it('拦截成环关系后显示待处理矛盾面板', async () => {
    // 直接通过 store 制造拦截（a 晚于 b、b 晚于 a）
    const h0 = store.getState().project.hypotheses[store.getState().project.currentId];
    act(() => {
      store.addAbove('u101', 'u102', ''); // u102 切割 u101，反向录入成环
    });
    await act(async () => {
      root.render(React.createElement(App));
    });
    const text = container.textContent ?? '';
    expect(text).toContain('修改被拦截');
    expect(text).toContain('完整矛盾链');
    // 有效矩阵关系数未增加
    const h1 = store.getState().project.hypotheses[h0.id];
    expect(h1.above.length).toBe(h0.above.length);
  });

  it('证据复核全流程：撤回等同 → 查看拆分/界值/冲突链差异 → 采用 → 撤销恢复', async () => {
    // 切到内置复核案例
    act(() => store.switchHypothesis(REVIEW_CASE_ID));
    // 建立一条等同送审
    act(() => store.addReviewItem({ evidence: 'equiv', refId: 'e201' }));
    await act(async () => {
      root.render(React.createElement(App));
    });

    // 打开证据复核页
    const reviewTabBtn = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('证据复核'),
    )!;
    await act(async () => reviewTabBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    let text = container.textContent ?? '';
    expect(text).toContain('候选变更');
    // 默认“保留”：采用按钮禁用
    const adoptBtn = (): HTMLButtonElement =>
      [...container.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes('采用候选'),
      ) as HTMLButtonElement;
    expect(adoptBtn().disabled).toBe(true);

    // 标记为撤回
    const withdrawBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '撤回',
    )!;
    await act(async () => withdrawBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    text = container.textContent ?? '';
    // 差异：影响单元、拆分类、年代界前后值、冲突增减
    expect(text).toContain('影响单元');
    expect(text).toContain('拆分类');
    expect(text).toContain('[201]');
    expect(text).toContain('公元 600');
    expect(text).toContain('冲突解除');
    expect(text).toContain('新增冲突');
    expect(adoptBtn().disabled).toBe(false);
    // 候选仍未污染当前矩阵
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(1);

    // 采用：单条事务
    await act(async () => adoptBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(0);
    text = container.textContent ?? '';
    expect(text).toContain('候选已采用');

    // 撤销整体恢复
    act(() => store.undo());
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].equivs).toHaveLength(1);
  });

  it('取消候选不改动矩阵', async () => {
    act(() => store.switchHypothesis(REVIEW_CASE_ID));
    act(() => {
      const id = store.addReviewItem({ evidence: 'above', refId: 'r202' });
      store.setReviewDisposition(id, 'withdraw');
    });
    await act(async () => {
      root.render(React.createElement(App));
    });
    const reviewTabBtn = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('证据复核'),
    )!;
    await act(async () => reviewTabBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const cancelBtn = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('取消候选'),
    )!;
    // confirm 走 jsdom 默认 confirm（返回 undefined/false）——stub 为 true
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(store.getReviewItems()).toHaveLength(0);
    expect(store.getState().project.hypotheses[REVIEW_CASE_ID].above.some((r) => r.id === 'r202')).toBe(true);
    vi.restoreAllMocks();
  });
});
