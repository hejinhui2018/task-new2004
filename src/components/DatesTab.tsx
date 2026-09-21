import { useState } from 'react';
import type { Hypothesis } from '../lib/types';
import type { PropagationResult } from '../lib/dates';
import { formatYear } from '../lib/dates';
import { store } from '../lib/store';
import ChainView from './ChainView';
import { CodeChip } from './ui';

interface Props {
  h: Hypothesis;
  prop: PropagationResult;
}

export default function DatesTab({ h, prop }: Props) {
  return (
    <div>
      <Conflicts h={h} prop={prop} />
      <PropagationTable h={h} prop={prop} />
      <PhaseManager h={h} />
    </div>
  );
}

function Conflicts({ h, prop }: Props) {
  if (prop.dateConflicts.length === 0 && prop.phaseConflicts.length === 0) {
    return (
      <div className="callout" style={{ borderColor: 'color-mix(in srgb, var(--good) 40%, transparent)', background: 'color-mix(in srgb, var(--good) 7%, var(--panel))' }}>
        <span className="badge good">✓ 年代与分期自洽</span>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          所有单元的出土物年代与人工分期，沿早晚关系传播后均无矛盾。
        </p>
      </div>
    );
  }
  return (
    <>
      {prop.dateConflicts.map((c, i) => (
        <div className="callout" key={`d${i}`}>
          <span className="badge critical">● 年代无解 · 最小冲突证据集</span>
          <p className="small" style={{ margin: '6px 0' }}>{c.message}</p>
          <div className="small muted">收紧两端的证据与关系链：</div>
          <ChainView
            steps={c.steps}
            h={h}
            onSelectUnit={(id) => store.select({ type: 'unit', id })}
            onSelectEdge={(id) => store.select({ type: 'edge', id })}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            最小冲突证据集：{c.evidenceIds.length} 条——两端出土物年代 +{' '}
            {Math.max(0, c.evidenceIds.length - 2)} 条关系。删除或修改其中任意一条即可解除。
          </p>
        </div>
      ))}
      {prop.phaseConflicts.map((c, i) => (
        <div className="callout" key={`p${i}`}>
          <span className="badge critical">● 分期冲突</span>
          <p className="small" style={{ margin: '6px 0' }}>{c.message}</p>
          {c.steps.length > 0 && (
            <ChainView
              steps={c.steps}
              h={h}
              onSelectUnit={(id) => store.select({ type: 'unit', id })}
              onSelectEdge={(id) => store.select({ type: 'edge', id })}
            />
          )}
          <div className="inline-row">
            <button onClick={() => store.select({ type: 'unit', id: c.olderUnit })}>
              查看 {h.units[c.olderUnit]?.code}
            </button>
            <button onClick={() => store.select({ type: 'unit', id: c.youngerUnit })}>
              查看 {h.units[c.youngerUnit]?.code}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function PropagationTable({ h, prop }: Props) {
  const phaseName = (rank: number | null | undefined): string => {
    if (rank === null || rank === undefined) return '不限';
    return h.phases.find((p) => p.rank === rank)?.name ?? `序 ${rank}`;
  };
  // 按等同类展示，取代表单元
  const rows = [...prop.q.classes.roots].map((root) => {
    const members = prop.q.classes.members.get(root)!;
    const earliest = prop.earliest.get(root) ?? null;
    const latest = prop.latest.get(root) ?? null;
    const lo = prop.phaseLo.get(root) ?? null;
    const hi = prop.phaseHi.get(root) ?? null;
    return { root, members, earliest, latest, lo, hi };
  });
  return (
    <div className="section">
      <h3>传播后的可行年代 / 分期范围</h3>
      <p className="small muted">
        年代沿“晚→早”关系传播：较早单元的最早年会抬高较晚单元的最早年；较晚单元的最晚年压低较早单元的最晚年。
      </p>
      <div className="entity-list">
        {rows.map(({ root, members, earliest, latest, lo, hi }) => {
          const noDateSolution = earliest && latest && earliest.value > latest.value;
          const noPhaseSolution = lo && hi && lo.value > hi.value;
          return (
            <div key={root} className="entity-item" style={{ alignItems: 'flex-start', flexDirection: 'column' }}
              onClick={() => store.select({ type: 'unit', id: members[0] })}>
              <div className="inline-row">
                {members.map((m) => (
                  <CodeChip key={m} code={h.units[m].code} kind={h.units[m].kind} />
                ))}
                {members.length > 1 && <span className="tag">同期</span>}
              </div>
              <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td className="muted" style={{ width: 64 }}>年代</td>
                    <td style={{ color: noDateSolution ? 'var(--critical)' : undefined }}>
                      {formatYear(earliest?.value)} ~ {formatYear(latest?.value)}
                      {noDateSolution && ' ✗ 无解'}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">收紧证据</td>
                    <td>
                      {earliest ? `最早≥${earliest.value}（${h.units[earliest.unitId]?.code} ${earliest.label}）` : '最早不限'}
                      {'；'}
                      {latest ? `最晚≤${latest.value}（${h.units[latest.unitId]?.code} ${latest.label}）` : '最晚不限'}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">分期</td>
                    <td style={{ color: noPhaseSolution ? 'var(--critical)' : undefined }}>
                      {lo?.value === hi?.value && lo
                        ? phaseName(lo.value)
                        : `${phaseName(lo?.value)} ~ ${phaseName(hi?.value)}`}
                      {noPhaseSolution && ' ✗ 次序相反'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseManager({ h }: { h: Hypothesis }) {
  const [name, setName] = useState('');
  const sorted = [...h.phases].sort((a, b) => a.rank - b.rank);
  return (
    <div className="section">
      <h3>人工分期</h3>
      <div className="entity-list">
        {sorted.map((p) => (
          <div key={p.id} className="entity-item">
            <input
              className="small"
              style={{ flex: 1 }}
              value={p.name}
              onChange={(e) => store.renamePhase(p.id, e.target.value)}
            />
            <span className="muted small">序（越大越晚）</span>
            <input
              type="number"
              className="small"
              style={{ width: 64 }}
              value={p.rank}
              onChange={(e) => store.setPhaseRank(p.id, Number(e.target.value))}
            />
            <button className="ghost danger small" onClick={() => store.deletePhase(p.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="inline-row" style={{ marginTop: 6 }}>
        <input placeholder="新分期名称" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          onClick={() => {
            if (!name) return;
            store.addPhase(name);
            setName('');
          }}
        >
          新分期
        </button>
      </div>
    </div>
  );
}
