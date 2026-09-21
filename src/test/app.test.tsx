// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { store } from '../lib/store';

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
});
