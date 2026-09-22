// 证据复核页：候选变更栏 + 候选与当前解释的差异（影响单元、年代界前后值、冲突增减）
import { useMemo, useState } from 'react';
import type { Hypothesis, ReviewAction, ReviewItem, ReviewSession, ReviewTarget } from '../lib/types';
import { REVIEW_ACTION_LABEL } from '../lib/types';
import { store } from '../lib/store';
import { describeTarget, type CandidateResult } from '../lib/review';
import { formatYear } from '../lib/dates';
import { CodeChip } from './ui';

interface Props {
  h: Hypothesis;
  review: ReviewSession | null;
  /** 候选计算结果；复核属于另一假设时为 null */
  result: CandidateResult | null;
  /** 复核所属假设的名称（复核不在当前假设时提示用） */
  reviewHypothesisName: string | null;
}

const KIND_LABEL: Record<ReviewTarget['kind'], string> = {
  above: '早晚关系',
  equiv: '等同关系',
  date: '出土物年代',
  phase: '人工分期',
};

const ACTIONS: ReviewAction[] = ['keep', 'retract', 'defer'];

export default function ReviewTab({ h, review, result, reviewHypothesisName }: Props) {
  if (review && review.hypothesisId !== h.id) {
    return (
      <div className="section">
        <h3>证据复核</h3>
        <div className="callout warning-callout">
          <p className="small" style={{ margin: 0 }}>
            有一套针对假设「{reviewHypothesisName ?? review.hypothesisId}」的复核会话
            （{review.items.length} 项候选变更）。复核与假设一一对应，切换后可继续；刷新页面也会保留。
          </p>
          <div className="inline-row" style={{ marginTop: 6 }}>
            <button onClick={() => store.switchHypothesis(review.hypothesisId)}>切换到该假设</button>
            <button className="ghost danger" onClick={() => store.cancelReview()}>取消该复核</button>
          </div>
        </div>
      </div>
    );
  }

  if (!review || !result) {
    return (
      <div className="section">
        <h3>证据复核</h3>
        <p className="small muted">
          对出土物年代、人工分期、早晚关系和等同关系建立待审变更（保留 / 撤回 / 暂不采用）。
          系统在隔离的候选快照中重算等同类、传递约简、年代/分期传播与冲突证据，
          并展示与当前解释的差异；候选不会改动当前矩阵，只有明确“采用”才作为一条可撤销事务写入。
        </p>
        <div className="inline-row">
          <button className="primary" onClick={() => store.startReview()}>开启证据复核</button>
          <button
            onClick={() => store.loadReviewDemo()}
            title="内置案例：两条年代证据、等同关系与传递早晚链；撤回等同会拆分类并解除冲突链"
          >
            载入复核演示案例
          </button>
        </div>
      </div>
    );
  }

  const retractCount = review.items.filter((i) => i.action === 'retract').length;
  const deferCount = review.items.filter((i) => i.action === 'defer').length;

  return (
    <div>
      <div className="section">
        <h3>
          候选变更栏（{review.items.length} 项 · 撤回 {retractCount} · 暂不采用 {deferCount}）
        </h3>
        {review.items.length === 0 && (
          <p className="small muted">尚无候选变更。在下方选择一条证据加入；标记“撤回”才会改变候选快照。</p>
        )}
        <div className="entity-list">
          {review.items.map((item) => (
            <ReviewItemRow key={item.id} h={h} item={item} />
          ))}
        </div>
        <AddReviewItem h={h} />
      </div>

      <DiffSummary h={h} result={result} />

      <div className="section">
        <div className="inline-row">
          <button className="primary" onClick={() => store.adoptReview()}>
            采用候选（写入 {retractCount} 条撤回）
          </button>
          <button className="ghost danger" onClick={() => store.cancelReview()}>取消复核</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          采用把全部“撤回”作为一条可撤销事务写入当前假设（↶ 撤销可回退）；
          “保留 / 暂不采用”项不改动当前矩阵。取消复核则丢弃全部候选变更。
        </p>
      </div>
    </div>
  );
}

function ReviewItemRow({ h, item }: { h: Hypothesis; item: ReviewItem }) {
  const label = describeTarget(h, item.target);
  return (
    <div className="entity-item review-item">
      <div className="inline-row" style={{ width: '100%' }}>
        <span className="tag">{KIND_LABEL[item.target.kind]}</span>
        <span
          className="small"
          style={{ flex: 1, color: label === null ? 'var(--critical)' : undefined }}
        >
          {label ?? `${item.label}（目标已不存在，无法定位）`}
        </span>
        <button
          className="ghost danger small"
          title="移出候选"
          onClick={() => store.removeReviewItem(item.id)}
        >
          ×
        </button>
      </div>
      <div className="inline-row" style={{ width: '100%' }}>
        <div className="seg">
          {ACTIONS.map((a) => (
            <button
              key={a}
              className={`${a}${item.action === a ? ' active' : ''}`}
              onClick={() => store.setReviewAction(item.id, a)}
            >
              {REVIEW_ACTION_LABEL[a]}
            </button>
          ))}
        </div>
        <input
          className="small"
          style={{ flex: 1 }}
          placeholder="备注（复核理由，可选）"
          value={item.note}
          onChange={(e) => store.setReviewNote(item.id, e.target.value)}
        />
      </div>
    </div>
  );
}

interface TargetOption {
  key: string;
  label: string;
  target: ReviewTarget;
}

function buildTargetOptions(h: Hypothesis, kind: ReviewTarget['kind']): TargetOption[] {
  if (kind === 'above') {
    return h.above.map((r) => ({
      key: r.id,
      label: `${h.units[r.younger]?.code ?? '?'} 晚于 ${h.units[r.older]?.code ?? '?'}${r.note ? `（${r.note}）` : ''}`,
      target: { kind: 'above', relId: r.id },
    }));
  }
  if (kind === 'equiv') {
    return h.equivs.map((e) => ({
      key: e.id,
      label: `${h.units[e.a]?.code ?? '?'} ＝ ${h.units[e.b]?.code ?? '?'}`,
      target: { kind: 'equiv', equivId: e.id },
    }));
  }
  if (kind === 'date') {
    return h.unitIds.flatMap((id) =>
      h.units[id].dates.map((d, index) => ({
        key: `date:${id}:${index}`,
        label: `${h.units[id].code}「${d.label}」${d.early}~${d.late}`,
        target: { kind: 'date', unitId: id, index, snapshot: { ...d } },
      })),
    );
  }
  return h.unitIds
    .filter((id) => h.units[id].phaseId !== null)
    .map((id) => {
      const ph = h.phases.find((p) => p.id === h.units[id].phaseId);
      return {
        key: `phase:${id}`,
        label: `${h.units[id].code}「${ph?.name ?? '?'}」`,
        target: { kind: 'phase', unitId: id, snapshot: h.units[id].phaseId },
      };
    });
}

function AddReviewItem({ h }: { h: Hypothesis }) {
  const [kind, setKind] = useState<ReviewTarget['kind']>('above');
  const [sel, setSel] = useState('');
  const [action, setAction] = useState<ReviewAction>('retract');
  const options = useMemo(() => buildTargetOptions(h, kind), [h, kind]);
  const chosen = options.find((o) => o.key === sel);

  return (
    <div style={{ marginTop: 8 }}>
      <div className="field-row">
        <div className="field">
          <label>证据类型</label>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ReviewTarget['kind']);
              setSel('');
            }}
          >
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>处理意向</label>
          <select value={action} onChange={(e) => setAction(e.target.value as ReviewAction)}>
            <option value="retract">撤回</option>
            <option value="keep">保留</option>
            <option value="defer">暂不采用</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>目标证据</label>
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">选择…</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>
      <button
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return;
          store.addReviewItem(chosen.target, action);
          setSel('');
        }}
      >
        加入候选变更
      </button>
      {options.length === 0 && <p className="small muted">当前假设没有该类证据。</p>}
    </div>
  );
}

function DiffSummary({ h, result }: { h: Hypothesis; result: CandidateResult }) {
  const { diff, warnings } = result;
  const code = (id: string): string => h.units[id]?.code ?? '?';
  const phaseName = (rank: number | null): string =>
    rank === null ? '不限' : h.phases.find((p) => p.rank === rank)?.name ?? `序 ${rank}`;
  const empty = diff.affectedUnits.length === 0 && warnings.length === 0;

  return (
    <div className="section">
      <h3>候选与当前解释的差异</h3>
      {empty ? (
        <p className="small muted">
          候选快照与当前解释一致：没有单元受影响，年代界与冲突均无变化。
        </p>
      ) : (
        <>
          <div className="inline-row" style={{ flexWrap: 'wrap' }}>
            <span className="badge warning">影响单元 {diff.affectedUnits.length}</span>
            <span
              className={`badge ${
                diff.conflictsAfter > diff.conflictsBefore
                  ? 'critical'
                  : diff.conflictsAfter < diff.conflictsBefore
                    ? 'good'
                    : ''
              }`}
            >
              冲突 {diff.conflictsBefore} → {diff.conflictsAfter}
            </span>
            {diff.splitPairs.length > 0 && <span className="tag">等同类拆分 {diff.splitPairs.length} 对</span>}
            {diff.mergedPairs.length > 0 && <span className="tag">等同类合并 {diff.mergedPairs.length} 对</span>}
            {diff.removedEdgeIds.length > 0 && <span className="tag">撤回连线 {diff.removedEdgeIds.length}</span>}
            {diff.unhiddenEdgeIds.length > 0 && <span className="tag">转直接 {diff.unhiddenEdgeIds.length}</span>}
            {diff.hiddenEdgeIds.length > 0 && <span className="tag">转隐藏 {diff.hiddenEdgeIds.length}</span>}
          </div>

          {warnings.length > 0 && (
            <div className="callout warning-callout" style={{ marginTop: 8 }}>
              <strong className="small">悬空 / 无法定位提示（不会静默删除）</strong>
              {warnings.map((w, i) => (
                <p className="small" key={i} style={{ margin: '4px 0 0' }}>⚠ {w.message}</p>
              ))}
            </div>
          )}

          {diff.affectedUnits.length > 0 && (
            <div className="inline-row small" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <span className="muted">受影响单元：</span>
              {diff.affectedUnits.map((id) => (
                <CodeChip key={id} code={code(id)} kind={h.units[id]?.kind} />
              ))}
            </div>
          )}

          {diff.splitPairs.length > 0 && (
            <p className="small" style={{ margin: '6px 0 0' }}>
              等同类拆分：{diff.splitPairs.map(([x, y]) => `${code(x)} ＝ ${code(y)}`).join('；')}
            </p>
          )}

          {diff.boundChanges.length > 0 && (
            <>
              <div className="small muted" style={{ marginTop: 8 }}>年代 / 分期界前后值（当前 → 候选）：</div>
              <table className="bound-table">
                <thead>
                  <tr><th>等同类</th><th>最早年</th><th>最晚年</th><th>分期</th></tr>
                </thead>
                <tbody>
                  {diff.boundChanges.map((b) => {
                    const earlyChanged = b.before.early !== b.after.early;
                    const lateChanged = b.before.late !== b.after.late;
                    const phaseChanged =
                      b.before.phaseLo !== b.after.phaseLo || b.before.phaseHi !== b.after.phaseHi;
                    return (
                      <tr key={b.members.join('|')}>
                        <td>{b.members.map((m) => code(m)).join('＝')}</td>
                        <td className={earlyChanged ? 'changed' : ''}>
                          {formatYear(b.before.early)} → {formatYear(b.after.early)}
                        </td>
                        <td className={lateChanged ? 'changed' : ''}>
                          {formatYear(b.before.late)} → {formatYear(b.after.late)}
                        </td>
                        <td className={phaseChanged ? 'changed' : ''}>
                          {phaseName(b.before.phaseLo)}~{phaseName(b.before.phaseHi)} →{' '}
                          {phaseName(b.after.phaseLo)}~{phaseName(b.after.phaseHi)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {diff.resolvedConflicts.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="small muted">候选中解除的冲突（{diff.resolvedConflicts.length}）：</div>
              {diff.resolvedConflicts.map((c) => (
                <div className="diff-entry added" key={c.key}>
                  <span className="small">{c.message}</span>
                </div>
              ))}
            </div>
          )}
          {diff.newConflicts.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="small muted">候选中新增的冲突（{diff.newConflicts.length}）：</div>
              {diff.newConflicts.map((c) => (
                <div className="diff-entry removed" key={c.key}>
                  <span className="small">{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
