import { describe, expect, it } from 'vitest';
import { quotient, layering } from '../lib/graph';
import { makeHypothesis } from './makeHypothesis';

describe('分层方向', () => {
  it('最早单元在 0 层（底部），越晚层号越大（顶部）', () => {
    // c 最早，b 居中，a 最晚
    const h = makeHypothesis({ ids: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c']] });
    const lv = layering(quotient(h));
    expect(lv.get(quotient(h).classes.rootOf.get('c')!)).toBe(0);
    expect(lv.get(quotient(h).classes.rootOf.get('b')!)).toBe(1);
    expect(lv.get(quotient(h).classes.rootOf.get('a')!)).toBe(2);
  });

  it('最长路径分层：分支取最长链', () => {
    // a > b > d，a > c > e > d：d 的层为 0，a 为最高
    const h = makeHypothesis({
      ids: ['a', 'b', 'c', 'd', 'e'],
      edges: [['a', 'b'], ['b', 'd'], ['a', 'c'], ['c', 'e'], ['e', 'd']],
    });
    const q = quotient(h);
    const lv = layering(q);
    expect(lv.get(q.classes.rootOf.get('d')!)).toBe(0);
    expect(lv.get(q.classes.rootOf.get('a')!)).toBe(3);
  });
});
