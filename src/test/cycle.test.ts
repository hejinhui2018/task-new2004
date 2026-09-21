import { describe, expect, it } from 'vitest';
import { validateAbove, transitiveReduction, reducedEdges, findAnyCycle, quotient } from '../lib/graph';
import { makeHypothesis } from './makeHypothesis';

describe('循环阻断', () => {
  it('无环图校验通过', () => {
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c']] });
    expect(validateAbove(h, 'a', 'c', 'new')).toBeNull(); // 传递边允许（会被约简）
    expect(validateAbove(h, 'c', 'a', 'new')).not.toBeNull(); // 反向闭合
  });

  it('返回完整矛盾链：新边 + 从 older 回到 younger 的整条路径', () => {
    // a 晚于 b 晚于 c；新增 c 晚于 a → c→a(新) + a→b + b→c 闭合
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c']] });
    const conflict = validateAbove(h, 'c', 'a', 'new-edge')!;
    expect(conflict).toBeTruthy();
    const ids = conflict.steps.map((s) => s.refId);
    expect(ids).toEqual(['new-edge', 'rel1', 'rel2']);
    expect(conflict.unitIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(conflict.edgeIds).toContain('new-edge');
    // 方向连续：每步 to === 下一步 from
    for (let i = 0; i < conflict.steps.length - 1; i++) {
      expect(conflict.steps[i].to).toBe(conflict.steps[i + 1].from);
    }
    // 末点回到起点形成闭合
    expect(conflict.steps.at(-1)!.to).toBe(conflict.steps[0].from);
  });

  it('较长环给出全部中间边（不只报相邻两个单元）', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd', 'e'],
      edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
    });
    const conflict = validateAbove(h, 'e', 'a', 'new')!;
    expect(conflict.steps.map((s) => s.refId)).toEqual(['new', 'rel1', 'rel2', 'rel3', 'rel4']);
  });

  it('自环被拒绝', () => {
    const h = makeHypothesis({ ids: ['a'] });
    const conflict = validateAbove(h, 'a', 'a', 'self')!;
    expect(conflict).toBeTruthy();
    expect(conflict.message).toContain('自身');
  });

  it('有效矩阵保持无环（findAnyCycle 为 null），拦截不修改数据', () => {
    const h = makeHypothesis({ ids: ['a', 'b'], edges: [['a', 'b']] });
    validateAbove(h, 'b', 'a', 'new');
    expect(h.above).toHaveLength(1); // 纯函数：数据不变
    expect(findAnyCycle(h)).toBeNull();
    // 约简结果仍正常
    expect(transitiveReduction(h).size).toBe(0);
    expect(reducedEdges(h)).toHaveLength(1);
  });

  it('商图上的环可被防御性检测', () => {
    // 手工构造不可能通过正常流程出现的环，quotient 仍能表达，findAnyCycle 兜底
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c']] });
    h.above.push({ id: 'bad', younger: 'c', older: 'a', note: '' });
    expect(findAnyCycle(h)).not.toBeNull();
    expect(quotient(h).edges).toHaveLength(3);
  });
});
