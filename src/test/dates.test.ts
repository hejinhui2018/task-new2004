import { describe, expect, it } from 'vitest';
import { propagate } from '../lib/dates';
import { makeHypothesis } from './makeHypothesis';

describe('年代与分期传播', () => {
  it('最早年向晚端抬升、最晚年向早端压低，并记录收紧证据', () => {
    const h = makeHypothesis({
      ids: ['a', 'b', 'c'], // a 最晚，c 最早
      edges: [['a', 'b'], ['b', 'c']],
      dates: {
        a: [{ early: 1000, late: 1100, label: '晚证据' }],
        c: [{ early: 800, late: 900, label: '早证据' }],
      },
    });
    const p = propagate(h);
    const ra = p.q.classes.rootOf.get('a')!;
    const rb = p.q.classes.rootOf.get('b')!;
    const rc = p.q.classes.rootOf.get('c')!;

    expect(p.earliest.get(rc)?.value).toBe(800);
    expect(p.earliest.get(rb)?.value).toBe(800);
    expect(p.earliest.get(rb)?.unitId).toBe('c'); // 由 c 收紧
    expect(p.earliest.get(ra)?.value).toBe(1000); // 自身 1000 强于传播来的 800
    expect(p.earliest.get(ra)?.unitId).toBe('a');

    expect(p.latest.get(ra)?.value).toBe(1100);
    expect(p.latest.get(rb)?.value).toBe(1100);
    expect(p.latest.get(rb)?.unitId).toBe('a'); // 由 a 收紧
    expect(p.latest.get(rc)?.value).toBe(900); // 自身 900 强于传播来的 1100
    expect(p.latest.get(rc)?.unitId).toBe('c');

    expect(p.dateConflicts).toHaveLength(0);
  });

  it('区间相容时无解为零：晚证据下限高于早证据上限也允许（区间不相交但有先后）', () => {
    // a 的遗物 1000~1100，c 的遗物 1050~1200：c 可能晚于自身区间沉积？
    // 沿 a>c 传播：a 最早≥1050；c 最晚≤1100；1050<=1100，仍有交集
    const h = makeHypothesis({
      ids: ['a', 'c'],
      edges: [['a', 'c']],
      dates: {
        a: [{ early: 1000, late: 1100, label: 'x' }],
        c: [{ early: 1050, late: 1200, label: 'y' }],
      },
    });
    expect(propagate(h).dateConflicts).toHaveLength(0);
  });

  it('定位年代无解的最小冲突证据集：两端出土物 + 最短关系链', () => {
    // a 晚于 b 晚于 c；a 的遗物最晚 800，c 的遗物最早 1000 → 无解
    const h = makeHypothesis({
      ids: ['a', 'b', 'c'],
      edges: [['a', 'b'], ['b', 'c']],
      dates: {
        a: [{ early: 700, late: 800, label: '晚墓遗物' }],
        c: [{ early: 1000, late: 1100, label: '早坑碳样' }],
      },
    });
    const p = propagate(h);
    expect(p.dateConflicts).toHaveLength(1);
    const c0 = p.dateConflicts[0];
    expect(c0.youngerEvidence.unitId).toBe('a');
    expect(c0.olderEvidence.unitId).toBe('c');
    expect(c0.evidenceIds).toEqual(['a', 'c', 'rel1', 'rel2']);
    // 最短链只有两条关系，不含任何多余边
    expect(c0.steps.map((s) => s.refId)).toEqual(['rel1', 'rel2']);
  });

  it('长链上的年代冲突给出经过最少中间关系的链', () => {
    // 菱形：a > b,b' > d，另有 a > x > y > d 更长路径
    const h = makeHypothesis({
      ids: ['a', 'b', 'bp', 'x', 'y', 'd'],
      edges: [['a', 'b'], ['a', 'x'], ['b', 'bp'], ['bp', 'd'], ['x', 'y'], ['y', 'd']],
      dates: {
        a: [{ early: 1, late: 500, label: '晚' }],
        d: [{ early: 900, late: 1200, label: '早' }],
      },
    });
    const p = propagate(h);
    expect(p.dateConflicts.length).toBeGreaterThan(0);
    const shortest = p.dateConflicts[0];
    // BFS 最短：a-b-bp-d（3 边）而非 4 边长链
    expect(shortest.steps.map((s) => s.refId)).toEqual(['rel1', 'rel3', 'rel4']);
  });

  it('同一等同类内年代相反也报无解，证据链含等同', () => {
    const h = makeHypothesis({
      ids: ['a', 'b'],
      equivs: [['a', 'b']],
      dates: {
        a: [{ early: 1, late: 800, label: '晚' }],
        b: [{ early: 900, late: 1200, label: '早' }],
      },
    });
    const p = propagate(h);
    expect(p.dateConflicts).toHaveLength(1);
    expect(p.dateConflicts[0].steps.map((s) => s.kind)).toEqual(['equiv']);
    expect(p.dateConflicts[0].evidenceIds).toEqual(['a', 'b', 'eq1']);
  });

  it('人工分期次序相反时报分期冲突；一致时通过', () => {
    const phases = [
      { id: 'p1', name: '早期', rank: 1 },
      { id: 'p2', name: '晚期', rank: 2 },
    ];
    const bad = makeHypothesis({
      ids: ['a', 'b'],
      edges: [['a', 'b']],
      phases,
      unitPhase: { a: 'p1', b: 'p2' }, // 晚的反而属早期
    });
    const pb = propagate(bad);
    expect(pb.phaseConflicts).toHaveLength(1);
    expect(pb.phaseConflicts[0].youngerUnit).toBe('a');
    expect(pb.phaseConflicts[0].olderUnit).toBe('b');

    const good = makeHypothesis({
      ids: ['a', 'b'],
      edges: [['a', 'b']],
      phases,
      unitPhase: { a: 'p2', b: 'p1' },
    });
    expect(propagate(good).phaseConflicts).toHaveLength(0);
  });

  it('分期秩沿关系传播形成可行区间', () => {
    const phases = [
      { id: 'p1', name: '一', rank: 1 },
      { id: 'p3', name: '三', rank: 3 },
    ];
    // a 晚于 b 晚于 c；a 属三期、c 属一期；b 的可行区间应为 1~3
    const h = makeHypothesis({
      ids: ['a', 'b', 'c'],
      edges: [['a', 'b'], ['b', 'c']],
      phases,
      unitPhase: { a: 'p3', c: 'p1' },
    });
    const p = propagate(h);
    const rb = p.q.classes.rootOf.get('b')!;
    expect(p.phaseLo.get(rb)?.value).toBe(1);
    expect(p.phaseHi.get(rb)?.value).toBe(3);
  });
});
