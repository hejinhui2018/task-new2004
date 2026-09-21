import type { Hypothesis, PendingChange } from '../lib/types';
import { store } from '../lib/store';
import ChainView from './ChainView';
import { CodeChip } from './ui';

interface Props {
  h: Hypothesis;
  pending: PendingChange;
}

/** 被拦截的待处理修改：展示完整矛盾链，允许放弃或在矛盾解除后应用 */
export default function PendingCallout({ h, pending }: Props) {
  const targetIds =
    pending.type === 'above'
      ? [pending.younger, pending.older]
      : [pending.a, pending.b];
  const c = pending.conflict;

  return (
    <div className="callout">
      <div className="inline-row" style={{ justifyContent: 'space-between' }}>
        <span className="badge critical">● 修改被拦截</span>
        <button className="ghost danger small" onClick={() => store.discardPending()}>
          放弃该修改
        </button>
      </div>
      <p className="small" style={{ margin: '6px 0' }}>
        {c ? c.message : '原矛盾已随证据删除而解除，现在可以应用此修改。'}
      </p>
      <div className="inline-row small" style={{ marginBottom: 4 }}>
        {targetIds.map((id, i) => (
          <span key={id} className="inline-row">
            {i === 1 && <span className="muted">{pending.type === 'equiv' ? '＝' : '晚于'}</span>}
            <CodeChip code={h.units[id]?.code ?? '?'} kind={h.units[id]?.kind} />
            <span className="muted">{h.units[id]?.note}</span>
          </span>
        ))}
      </div>
      {c && (
        <>
          <div className="small muted">完整矛盾链（虚线/红边也在图上标出）：</div>
          <ChainView
            steps={c.steps}
            h={h}
            provisionalId={
              pending.type === 'above' ? c.steps[0]?.refId : c.steps.at(-1)?.refId
            }
            onSelectUnit={(id) => store.select({ type: 'unit', id })}
            onSelectEdge={(id) => store.select({ type: 'edge', id })}
          />
          <p className="small muted">
            提示：当前有效矩阵未被破坏。删除链上任意一条标红关系或等同后，再点“应用修改”；
            也可以直接放弃。
          </p>
        </>
      )}
      <div className="inline-row" style={{ marginTop: 6 }}>
        <button
          className="primary"
          disabled={c !== null}
          onClick={() => store.applyPending()}
        >
          应用修改
        </button>
        <span className="small muted">{c === null ? '矛盾已解除' : '仍存在矛盾，无法应用'}</span>
      </div>
    </div>
  );
}
