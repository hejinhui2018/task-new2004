import { describe, expect, it } from 'vitest';
import { transitiveReduction, reducedEdges, explainPath } from '../lib/graph';
import { makeHypothesis } from './makeHypothesis';

describe('传递约简', () => {
  it('链上的直达边被隐藏，直接边保留', () => {
    // a 晚于 b 晚于 c，另录 a 晚于 c：后者由前两条推出
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c'], ['a', 'c']] });
    const hidden = transitiveReduction(h);
    expect([...hidden]).toEqual(['rel3']);
    const visible = reducedEdges(h).map((r) => r.id).sort();
    expect(visible).toEqual(['rel1', 'rel2']);
  });

  it('菱形分支的边都不是冗余', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']],
    });
    expect(transitiveReduction(h).size).toBe(0);
  });

  it('菱形补上直达边后仅该边被隐藏', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['a', 'd']],
    });
    expect([...transitiveReduction(h)]).toEqual(['rel5']);
  });

  it('等同类之间的平行边互不掩盖', () => {
    // a≡b 为晚类，c≡d 为早类；两条不同成员的直达边都需要保留
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd'],
      edges: [['a', 'c'], ['b', 'd']],
      equivs: [['a', 'b'], ['c', 'd']],
    });
    expect(transitiveReduction(h).size).toBe(0);
  });

  it('跨等同的长链仍会约简冗余边', () => {
    // a≡b 晚于 c 晚于 d≡e；录入 b 晚于 e 属冗余
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd', 'e'],
      edges: [['a', 'c'], ['c', 'd'], ['b', 'e']],
      equivs: [['a', 'b'], ['d', 'e']],
    });
    expect([...transitiveReduction(h)]).toEqual(['rel3']);
  });

  it('explainPath 用直接连线解释被隐藏的传递关系（含等同跨越）', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd', 'e'],
      edges: [['a', 'c'], ['c', 'd'], ['b', 'e']],
      equivs: [['a', 'b'], ['d', 'e']],
    });
    // 被隐藏的是 b 晚于 e：解释链应从 b 经等同到 a，走两条早晚，再等同到 e
    const steps = explainPath(h, 'b', 'e')!;
    expect(steps).not.toBeNull();
    expect(steps.map((s) => [s.kind, s.from, s.to])).toEqual([
      ['equiv', 'b', 'a'],
      ['above', 'a', 'c'],
      ['above', 'c', 'd'],
      ['equiv', 'd', 'e'],
    ]);
  });

  it('explainPath 对不可达的两个单元返回 null', () => {
    const h = makeHypothesis({ ids: ['a', 'b'] });
    expect(explainPath(h, 'a', 'b')).toBeNull();
  });
});
