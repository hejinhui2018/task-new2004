import { useMemo, useState } from 'react';
import type { EvidenceType, Hypothesis, ReviewItem } from '../lib/types';
import { store } from '../lib/store';
import { dateRefId, phaseRefId, resolveDateIndex, type ReviewDiff } from '../lib/review';
import { formatYear } from '../lib/dates';
import ChainView from './ChainView';
import { CodeChip } from './ui';

interface Props {
  h: Hypothesis;
  items: ReviewItem[];
}

const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  date: '出土物年代',
  phase: '人工分期',
  above: '早晚关系',
  equiv: '等同关系',
};

const DISPOSITION_LABEL: Record<ReviewItem['disposition'], string> = {
  keep: '保留',
  withdraw: '撤回',
  defer: '暂不采用',
};

export default function ReviewTab({ h, items }: Props) {
  const diff = useMemo<ReviewDiff | null>(
    () => (items.length ? store.getReviewDiff() : null),
    [h, items],
  );

  return (
    <div>
      <div className="section">
        <h3>证据复核</h3>
        <p className="small muted">
          把出土物年代、人工分期、早晚或等同关系送审，标记为<b>保留 / 撤回 / 暂不采用</b>。
          系统在隔离的候选快照中重算等同类、传递约简与年代/分期传播；候选不会改动当前矩阵，
          只有明确「采用」才作为一条可撤销事务写入。
        </p>
      </div>

      <AddEvidenceForm key={h.id} h={h} />

      {items.length > 0 && (
        <div className="section">
          <h3>候选变更（{items.length}）</h3>
          <div className="entity-list">
            {items.map((it) => (
              <ReviewItemRow key={it.id} h={h} item={it} />
            ))}
          </div>
          {diff && <DiffPanel h={h} diff={diff} items={items} />}
        </div>
      )}

      {items.length === 0 && (
        <div className="callout">
          <span className="badge">候选为空</span>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            从上方选择证据建立待审变更；也可以在「录入与校核」中直接点证据旁的「送审」。
          </p>
        </div>
      )}
    </div>
  );
}

/** 一条待审证据的描述（按当前矩阵实时解析；已失效会提示） */
export function describeEvidence(h: Hypothesis, item: ReviewItem): React.ReactNode {
  if (item.evidence === 'above') {
    const r = h.above.find((x) => x.id === item.refId);
    if (!r) return <span className="missing-ref">早晚关系已不存在（{item.refId}）</span>;
    return (
      <span className="inline-row">
        <CodeChip code={h.units[r.younger]?.code ?? '?'} kind={h.units[r.younger]?.kind} />
        <span className="muted">晚于</span>
        <CodeChip code={h.units[r.older]?.code ?? '?'} kind={h.units[r.older]?.kind} />
      </span>
    );
  }
  if (item.evidence === 'equiv') {
    const e = h.equivs.find((x) => x.id === item.refId);
    if (!e) return <span className="missing-ref">等同关系已被拆组（{item.refId}）</span>;
    return (
      <span className="inline-row">
        <CodeChip code={h.units[e.a]?.code ?? '?'} kind={h.units[e.a]?.kind} />
        <span className="muted">＝</span>
        <CodeChip code={h.units[e.b]?.code ?? '?'} kind={h.units[e.b]?.kind} />
      </span>
    );
  }
  const u = item.unitId ? h.units[item.unitId] : undefined;
  if (!u) return <span className="missing-ref">单元已删除（{item.unitId}）</span>;
  if (item.evidence === 'phase') {
    const ph = u.phaseId ? h.phases.find((p) => p.id === u.phaseId) : undefined;
    return (
      <span className="inline-row">
        <CodeChip code={u.code} kind={u.kind} />
        <span className="muted">人工分期：</span>
        <b>{ph ? ph.name : '（已取消分期）'}</b>
      </span>
    );
  }
  const idx = item.unitId ? resolveDateIndex(h, item.unitId, item.dateIndex ?? -1, item.dateSnapshot) : null;
  const d = (idx !== null && idx >= 0 ? u?.dates[idx] : undefined) ?? item.dateSnapshot;
  const stale =
    idx !== null &&
    item.dateSnapshot &&
    u?.dates[idx] &&
    (u.dates[idx].early !== item.dateSnapshot.early ||
      u.dates[idx].late !== item.dateSnapshot.late ||
      u.dates[idx].label !== item.dateSnapshot.label);
  if (!d) return <span className="missing-ref">出土物年代已删除</span>;
  return (
    <span className="inline-row">
      <CodeChip code={u.code} kind={u.kind} />
      <span className="muted">出土物：</span>
      <b>{formatYear(d.early)} ~ {formatYear(d.late)}</b>
      <span className="small muted">{d.label}</span>
      {stale && <span className="tag" title="送审后该证据被直接编辑过">内容已变更</span>}
    </span>
  );
}

function ReviewItemRow({ h, item }: { h: Hypothesis; item: ReviewItem }) {
  return (
    <div className={`review-item disposition-${item.disposition}`}>
      <div className="inline-row" style={{ justifyContent: 'space-between' }}>
        <span className="tag">{EVIDENCE_LABEL[item.evidence]}</span>
        <button className="ghost danger small" title="移出候选（不改变矩阵）"
          onClick={() => store.removeReviewItem(item.id)}>
          ×
        </button>
      </div>
      <div style={{ margin: '4px 0' }}>{describeEvidence(h, item)}</div>
      <div className="inline-row disposition-row">
        {(['keep', 'withdraw', 'defer'] as const).map((d) => (
          <button
            key={d}
            className={`small${item.disposition === d ? ' active' : ''}${d === 'withdraw' ? ' danger' : ''}`}
            onClick={() => store.setReviewDisposition(item.id, d)}
          >
            {DISPOSITION_LABEL[d]}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddEvidenceForm({ h }: { h: Hypothesis }) {
  const [kind, setKind] = useState<EvidenceType>('above');
  const [unitId, setUnitId] = useState(h.unitIds[0] ?? '');
  const [dateIndex, setDateIndex] = useState(0);
  const [refId, setRefId] = useState('');

  const unit = h.units[unitId];
  const add = (): void => {
    if (kind === 'above' || kind === 'equiv') {
      if (!refId) return;
      store.addReviewItem({ evidence: kind, refId });
      setRefId('');
    } else if (kind === 'phase') {
      if (!unitId || !h.units[unitId]?.phaseId) return;
      store.addReviewItem({ evidence: 'phase', refId: phaseRefId(unitId), unitId });
    } else {
      if (!unit) return;
      const d = unit.dates[dateIndex];
      if (!d) return;
      store.addReviewItem({
        evidence: 'date',
        refId: dateRefId(unitId, dateIndex),
        unitId,
        dateIndex,
        dateSnapshot: { ...d },
      });
    }
  };

  return (
    <div className="section">
      <h3>建立待审变更</h3>
      <div className="field">
        <label>证据类型</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as EvidenceType)}>
          <option value="above">早晚关系</option>
          <option value="equiv">等同关系</option>
          <option value="date">出土物年代</option>
          <option value="phase">人工分期</option>
        </select>
      </div>

      {(kind === 'above' || kind === 'equiv') && (
        <div className="field">
          <label>{kind === 'above' ? '选择早晚关系' : '选择等同关系'}</label>
          <select value={refId} onChange={(e) => setRefId(e.target.value)}>
            <option value="">选择…</option>
            {kind === 'above'
              ? h.above.map((r) => (
                  <option key={r.id} value={r.id}>
                    {h.units[r.younger]?.code} 晚于 {h.units[r.older]?.code}（{r.note || '无依据'}）
                  </option>
                ))
              : h.equivs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {h.units[e.a]?.code} ＝ {h.units[e.b]?.code}
                  </option>
                ))}
          </select>
        </div>
      )}

      {(kind === 'date' || kind === 'phase') && (
        <div className="field">
          <label>单元</label>
          <select value={unitId} onChange={(e) => { setUnitId(e.target.value); setDateIndex(0); }}>
            {h.unitIds.map((id) => (
              <option key={id} value={id}>{h.units[id].code} {h.units[id].note.slice(0, 12)}</option>
            ))}
          </select>
        </div>
      )}

      {kind === 'date' && (
        <div className="field">
          <label>出土物</label>
          <select value={dateIndex} onChange={(e) => setDateIndex(Number(e.target.value))}>
            {(unit?.dates ?? []).map((d, i) => (
              <option key={i} value={i}>{formatYear(d.early)} ~ {formatYear(d.late)} {d.label}</option>
            ))}
          </select>
          {(unit?.dates.length ?? 0) === 0 && <p className="small muted">该单元暂无出土物年代</p>}
        </div>
      )}

      {kind === 'phase' && (!unit?.phaseId) && (
        <p className="small muted">该单元尚未指定人工分期</p>
      )}

      <button className="primary" onClick={add}>送审</button>
    </div>
  );
}

const BOUND_LABEL: Record<string, string> = {
  earliest: '最早年下界',
  latest: '最晚年上界',
  phaseLo: '分期下界',
  phaseHi: '分期上界',
};

function phaseNameOf(h: Hypothesis, rank: number | null): string {
  if (rank === null) return '不限';
  return h.phases.find((p) => p.rank === rank)?.name ?? `序 ${rank}`;
}

function DiffPanel({ h, diff, items }: { h: Hypothesis; diff: ReviewDiff; items: ReviewItem[] }) {
  const withdrawn = items.filter((i) => i.disposition === 'withdraw').length;
  const adoptDisabled = withdrawn === 0;

  return (
    <div className="review-diff">
      <div className="review-summary">
        <span className="badge">影响单元 <b>{diff.affectedUnitIds.length}</b></span>
        <span className={`badge ${diff.conflictsRemoved.length ? 'good' : ''}`}>
          冲突解除 <b>{diff.conflictsRemoved.length}</b>
        </span>
        <span className={`badge ${diff.conflictsAdded.length ? 'critical' : ''}`}>
          新增冲突 <b>{diff.conflictsAdded.length}</b>
        </span>
        <span className="badge">撤回证据 <b>{withdrawn}</b></span>
      </div>

      {diff.dangling.length > 0 && (
        <div className="callout warning-callout">
          <span className="badge warning">● 悬空/失效引用（{diff.dangling.length}）</span>
          {diff.dangling.map((d) => (
            <p className="small" key={d.itemId} style={{ margin: '4px 0' }}>
              {EVIDENCE_LABEL[d.evidence]}：{d.reason}
              {d.relatedUnitIds.length > 0 && (
                <>（{d.relatedUnitIds.map((id) => h.units[id]?.code ?? id).join('、')}）</>
              )}
              {d.status === 'stale' && '；请先在矩阵中核对，或移出候选后重新送审。'}
              <button className="ghost small" style={{ marginLeft: 8 }}
                onClick={() => store.removeReviewItem(d.itemId)}>
                移出候选
              </button>
            </p>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>
            这些证据不会被删除（它们在当前矩阵中已不存在），但说明候选建立后矩阵又被直接编辑过。
          </p>
        </div>
      )}

      {diff.orphans.length > 0 && (
        <div className="callout warning-callout">
          <span className="badge warning">● 无法定位的单元（{diff.orphans.length}）</span>
          {diff.orphans.map((o) => (
            <p className="small" key={o.unitId} style={{ margin: '4px 0' }}>
              <button className="step" onClick={() => store.select({ type: 'unit', id: o.unitId })}>
                {h.units[o.unitId]?.code ?? o.unitId}
              </button>
              {o.reason}
            </p>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>
            单元保留在数据中，未被静默删除；请在采用后补录关系，或改用「暂不采用」。
          </p>
        </div>
      )}

      {(diff.split.length > 0 || diff.merged.length > 0) && (
        <div className="section">
          <h3>等同类变化</h3>
          {diff.split.length > 0 && (
            <p className="small">
              <span className="badge warning">拆分类（{diff.split.length} 对）</span>{' '}
              {diff.split.map(([a, b], i) => (
                <span key={i}>
                  <CodeChip code={h.units[a]?.code ?? '?'} kind={h.units[a]?.kind} />
                  <span className="muted"> ≠ </span>
                  <CodeChip code={h.units[b]?.code ?? '?'} kind={h.units[b]?.kind} />{' '}
                </span>
              ))}
            </p>
          )}
          {diff.merged.length > 0 && (
            <p className="small">
              <span className="badge good">新合并（{diff.merged.length} 对）</span>{' '}
              {diff.merged.map(([a, b], i) => (
                <span key={i}>
                  <CodeChip code={h.units[a]?.code ?? '?'} kind={h.units[a]?.kind} />
                  <span className="muted"> ＝ </span>
                  <CodeChip code={h.units[b]?.code ?? '?'} kind={h.units[b]?.kind} />{' '}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {diff.boundChanges.length > 0 && (
        <div className="section">
          <h3>年代界 / 分期界前后值（{diff.boundChanges.length}）</h3>
          <div className="entity-list">
            {diff.boundChanges.map((c, i) => {
              const u = h.units[c.unitId];
              const isPhase = c.kind.startsWith('phase');
              const fmt = (v: number | null): string => (isPhase ? phaseNameOf(h, v) : formatYear(v));
              const src = (s: { label: string; unitId: string } | null): string =>
                s ? `（${h.units[s.unitId]?.code ?? s.unitId} ${s.label}）` : '';
              const loosened = !isPhase
                ? (c.kind === 'earliest' && (c.after ?? -Infinity) < (c.before ?? Infinity)) ||
                  (c.kind === 'latest' && (c.after ?? Infinity) > (c.before ?? -Infinity))
                : false;
              return (
                <div key={i} className="entity-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}
                  onClick={() => store.select({ type: 'unit', id: c.unitId })}>
                  <div className="inline-row">
                    <CodeChip code={u?.code ?? '?'} kind={u?.kind} />
                    <span className="small muted">{BOUND_LABEL[c.kind]}</span>
                    {loosened && <span className="tag">界值放宽</span>}
                  </div>
                  <div className="small bound-before-after">
                    <span className="muted">{fmt(c.before)}{src(c.beforeSource)}</span>
                    <span className="muted"> → </span>
                    <b>{fmt(c.after)}{src(c.afterSource)}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(diff.reducedAdded.length > 0 || diff.reducedRemoved.length > 0) && (
        <div className="section">
          <h3>传递约简变化</h3>
          {diff.reducedRemoved.length > 0 && (
            <p className="small">重新成为直接连线：{diff.reducedRemoved.join('、')}</p>
          )}
          {diff.reducedAdded.length > 0 && (
            <p className="small muted">新被约简隐藏：{diff.reducedAdded.join('、')}</p>
          )}
        </div>
      )}

      <div className="section">
        <h3>冲突变化</h3>
        {diff.conflictsRemoved.length === 0 && diff.conflictsAdded.length === 0 && (
          <p className="small muted">冲突数量与证据集不变。</p>
        )}
        {diff.conflictsRemoved.map((c, i) => (
          <div className="callout conflict-resolved" key={`rm${i}`}>
            <span className="badge good">✓ 冲突解除</span>
            <p className="small" style={{ margin: '4px 0' }}>{c.message}</p>
            {c.chain && c.chain.steps.length > 0 && (
              <ChainView steps={c.chain.steps} h={h}
                onSelectUnit={(id) => store.select({ type: 'unit', id })}
                onSelectEdge={(id) => store.select({ type: 'edge', id })} />
            )}
          </div>
        ))}
        {diff.conflictsAdded.map((c, i) => (
          <div className="callout" key={`add${i}`}>
            <span className="badge critical">● 新增冲突</span>
            <p className="small" style={{ margin: '4px 0' }}>{c.message}</p>
            {c.chain && c.chain.steps.length > 0 && (
              <ChainView steps={c.chain.steps} h={h}
                onSelectUnit={(id) => store.select({ type: 'unit', id })}
                onSelectEdge={(id) => store.select({ type: 'edge', id })} />
            )}
          </div>
        ))}
      </div>

      <div className="review-actions">
        <button className="primary" disabled={adoptDisabled}
          title={adoptDisabled ? '没有标记为「撤回」的证据' : '把撤回一次性写入当前矩阵（单条可撤销事务）'}
          onClick={() => {
            if (diff.orphans.length > 0 &&
              !confirm(`撤回后将有 ${diff.orphans.length} 个单元失去全部联系、无法在矩阵中定位（单元不会被删除）。仍要采用吗？`)) {
              return;
            }
            store.adoptReview();
          }}>
          采用候选
        </button>
        <button onClick={() => {
          if (confirm('取消候选将丢弃全部待审变更，当前矩阵不变。确定吗？')) store.cancelReview();
        }}>
          取消候选
        </button>
        <span className="small muted">
          {adoptDisabled ? '将证据标记为「撤回」后才能采用；保留/暂不采用不改变矩阵。' : '采用前当前矩阵保持不变。'}
        </span>
      </div>
    </div>
  );
}
