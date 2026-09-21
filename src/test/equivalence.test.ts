import { describe, expect, it } from 'vitest';
import { validateAbove, validateEquiv, quotient } from '../lib/graph';
import { buildClasses } from '../lib/equivalence';
import { makeHypothesis } from './makeHypothesis';

describe('等同合并', () => {
  it('并查集把传递等同合并为同一类', () => {
    const h = makeHypothesis({ ids: ['a', 'b', 'c', 'd'], equivs: [['a', 'b'], ['b', 'c']] });
    const cls = buildClasses(h);
    expect(cls.roots).toHaveLength(2); // {a,b,c} 与 {d}
    const ra = cls.rootOf.get('a')!;
    expect(cls.rootOf.get('b')).toBe(ra);
    expect(cls.rootOf.get('c')).toBe(ra);
    expect(cls.rootOf.get('d')).not.toBe(ra);
    expect(cls.members.get(ra)!).toEqual(['a', 'b', 'c']);
  });

  it('等同类之间的平行早晚边在商图中保留', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'c'], ['b', 'd']],
      equivs: [['a', 'b'], ['c', 'd']],
    });
    const q = quotient(h);
    expect(q.edges).toHaveLength(2);
  });

  it('同一等同类内部新增早晚关系被拒绝，矛盾链含等同回程', () => {
    const h = makeHypothesis({ ids: ['a', 'b'], equivs: [['a', 'b']] });
    const conflict = validateAbove(h, 'a', 'b', 'new')!;
    expect(conflict).toBeTruthy();
    expect(conflict.steps[0]).toMatchObject({ kind: 'above', refId: 'new', from: 'a', to: 'b' });
    expect(conflict.steps.slice(1).every((s) => s.kind === 'equiv')).toBe(true);
    expect(conflict.steps.at(-1)!.to).toBe('a');
  });

  it('对已有明确先后的两类标记等同被拒绝，并给出贯穿的矛盾链', () => {
    // a 晚于 b 晚于 c；拟将 a、c 标记同期
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c']] });
    const conflict = validateEquiv(h, 'a', 'c', 'newEq')!;
    expect(conflict).toBeTruthy();
    expect(conflict.steps.at(-1)!.kind).toBe('equiv');
    expect(conflict.steps.at(-1)!.refId).toBe('newEq');
    // 链从 a 出发经早晚关系到 c，再以新等同回到 a
    expect(conflict.steps[0].from).toBe('a');
    const aboveSteps = conflict.steps.filter((s) => s.kind === 'above');
    expect(aboveSteps.map((s) => s.refId)).toEqual(['rel1', 'rel2']);
  });

  it('等同路径跨越中间类：x≡a 晚于 c≡y，标记 x、y 同期被拒', () => {
    const h = makeHypothesis({
      ids: ['x', 'a', 'b', 'c', 'y'],
      edges: [['a', 'b'], ['b', 'c']],
      equivs: [['x', 'a'], ['c', 'y']],
    });
    const conflict = validateEquiv(h, 'x', 'y', 'newEq')!;
    expect(conflict).toBeTruthy();
    // 链应完整提升为单元级：含等同 x→a、两条早晚、等同 c→y、新等同 y→x
    const kinds = conflict.steps.map((s) => s.kind);
    expect(kinds.filter((k) => k === 'equiv')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'above')).toHaveLength(2);
    expect(conflict.steps.at(-1)!.to).toBe('x');
  });

  it('已在同一类的重复等同、以及不可比的两类等同均通过', () => {
    const h = makeHypothesis({ ids: ['a', 'b', 'c', 'd'], equivs: [['a', 'b']] });
    expect(validateEquiv(h, 'a', 'b', 'x')).toBeNull();
    expect(validateEquiv(h, 'c', 'd', 'x')).toBeNull();
  });
});
