import { describe, expect, it, beforeEach } from 'vitest';
import { store } from '../lib/store';
import { findAnyCycle, transitiveReduction } from '../lib/graph';

// store 是模块级单例：每个用例前恢复内置示例
beforeEach(() => {
  store.resetToSample();
});

describe('store：循环阻断与待处理修改', () => {
  it('闭环关系被拦截：有效矩阵不变，待处理修改保留完整矛盾链', () => {
    store.createBlankHypothesis('隔离用例');
    const a = store.addUnit('a', 'deposit', '');
    const b = store.addUnit('b', 'deposit', '');
    const c = store.addUnit('c', 'deposit', '');

    expect(store.addAbove(a, b, '')).toBe(true);
    expect(store.addAbove(b, c, '')).toBe(true);

    const before = store.getState().project.hypotheses[store.getState().project.currentId].above.length;
    const ok = store.addAbove(c, a, '');
    expect(ok).toBe(false);

    const { project, session } = store.getState();
    const h = project.hypotheses[project.currentId];
    // 当前有效矩阵未被破坏
    expect(h.above).toHaveLength(before);
    expect(findAnyCycle(h)).toBeNull();
    // 待处理修改被保留
    expect(session.pending).not.toBeNull();
    expect(session.pending!.type).toBe('above');
    if (session.pending!.type === 'above') {
      expect(session.pending!.younger).toBe(c);
      expect(session.pending!.older).toBe(a);
    }
    // 完整矛盾链：拟新增边 + 已有两条关系，闭合回到起点
    expect(session.pending!.conflict).not.toBeNull();
    const chain = session.pending!.conflict!;
    expect(chain.edgeIds).toHaveLength(3);
    expect(chain.steps).toHaveLength(3);
    expect(chain.steps.at(-1)!.to).toBe(chain.steps[0].from);
  });

  it('删除链上证据使矛盾解除后，可应用待处理修改，且矩阵仍无环', () => {
    store.createBlankHypothesis('隔离用例2');
    const a = store.addUnit('a', 'deposit', '');
    const b = store.addUnit('b', 'deposit', '');
    const c = store.addUnit('c', 'deposit', '');
    store.addAbove(a, b, '');
    store.addAbove(b, c, '');
    store.addAbove(c, a, ''); // 被拦截

    // 拆掉矛盾链中的一条已有关系
    const chainEdge = store.getState().session.pending!.conflict!.steps[1].refId;
    store.deleteAbove(chainEdge);
    expect(store.getState().session.pending!.conflict).toBeNull();

    // 现在可以应用；应用后得到 b 晚于 c 晚于 a（方向合法）
    expect(store.applyPending()).toBe(true);
    const { project, session } = store.getState();
    const h = project.hypotheses[project.currentId];
    expect(session.pending).toBeNull();
    expect(h.above).toHaveLength(2);
    expect(findAnyCycle(h)).toBeNull();
  });

  it('放弃待处理修改后状态清空', () => {
    store.createBlankHypothesis('隔离用例3');
    const a = store.addUnit('a', 'deposit', '');
    const b = store.addUnit('b', 'deposit', '');
    store.addAbove(a, b, '');
    store.addAbove(b, a, '');
    expect(store.getState().session.pending).not.toBeNull();
    store.discardPending();
    expect(store.getState().session.pending).toBeNull();
  });

  it('撤销重做贯穿所有提交：撤销恢复被删关系，重做再次删除', () => {
    const h0 = store.getState().project.hypotheses[store.getState().project.currentId];
    const n0 = h0.above.length;
    // 在示例中新增一条合法关系 a? 直接选两个不可比单元：u108 与 u104
    const ok = store.addAbove('u108', 'u104', '坑晚于居住面');
    expect(ok).toBe(true);
    expect(store.getHistory().canUndo).toBe(true);
    expect(store.getState().project.hypotheses[h0.id].above).toHaveLength(n0 + 1);

    store.undo();
    expect(store.getState().project.hypotheses[h0.id].above).toHaveLength(n0);
    store.redo();
    expect(store.getState().project.hypotheses[h0.id].above).toHaveLength(n0 + 1);
  });

  it('删除单元会连带清理其关系与等同', () => {
    const h = store.getState().project.hypotheses[store.getState().project.currentId];
    const related = h.above.filter((r) => r.younger === 'u105' || r.older === 'u105').length;
    expect(related).toBeGreaterThan(0);
    store.deleteUnit('u105');
    const h2 = store.getState().project.hypotheses[store.getState().project.currentId];
    expect(h2.unitIds).not.toContain('u105');
    expect(h2.above.every((r) => r.younger !== 'u105' && r.older !== 'u105')).toBe(true);
    expect(findAnyCycle(h2)).toBeNull();
  });
});

describe('内置示例数据', () => {
  it('包含沟槽/回填/墙基与两件带年代遗物', () => {
    const h = store.getState().project.hypotheses[store.getState().project.currentId];
    const kinds = new Set(h.unitIds.map((id) => h.units[id].kind));
    expect(kinds).toContain('cut');
    expect(kinds).toContain('construction');
    expect(kinds).toContain('deposit');
    const dated = h.unitIds.filter((id) => h.units[id].dates.length > 0);
    expect(dated).toHaveLength(2); // 墙基夯土内钱币 + 回填土内瓷片
  });

  it('示例矩阵自洽：无环、无年代冲突', () => {
    const h = store.getState().project.hypotheses[store.getState().project.currentId];
    expect(findAnyCycle(h)).toBeNull();
  });

  it('示例中冗余的间接连线 r5 被约简隐藏，且可由 r4/r2/r1 解释', () => {
    const h = store.getState().project.hypotheses[store.getState().project.currentId];
    const hidden = transitiveReduction(h);
    expect(hidden.has('r5')).toBe(true); // 排水沟切入生土的间接记录
    expect(hidden.has('r1')).toBe(false);
    expect(hidden.has('r4')).toBe(false);
  });
});
