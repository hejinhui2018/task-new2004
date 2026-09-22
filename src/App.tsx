import { useEffect, useMemo, useState } from 'react';
import { store, useStore, type AdoptionNotice as AdoptionNoticeData } from './lib/store';
import { quotient, transitiveReduction, explainPath } from './lib/graph';
import { propagate } from './lib/dates';
import { layoutMatrix } from './lib/layout';
import Canvas from './components/Canvas';
import RecordTab from './components/RecordTab';
import DatesTab from './components/DatesTab';
import ReviewTab from './components/ReviewTab';
import { CompareModal, HypothesesTab } from './components/HypothesesTab';
import ChainView from './components/ChainView';
import { CodeChip } from './components/ui';

type Tab = 'record' | 'dates' | 'review' | 'hypotheses';

export default function App() {
  const state = useStore();
  const { project, session, reviews } = state;
  const h = project.hypotheses[project.currentId];
  const reviewItems = reviews[project.currentId]?.items ?? [];
  const reviewDiff = useMemo(() => (reviewItems.length ? store.getReviewDiff() : null), [h, reviewItems]);
  const [tab, setTab] = useState<Tab>('record');
  const [explainMode, setExplainMode] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('harris-theme') as 'light' | 'dark') || 'light',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('harris-theme', theme);
  }, [theme]);

  const q = useMemo(() => quotient(h), [h]);
  const prop = useMemo(() => propagate(h), [h]);
  const lay = useMemo(() => layoutMatrix(h, h.positions), [h]);
  const hiddenIds = useMemo(() => transitiveReduction(h), [h]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key === 'Escape') {
        setExplainMode(false);
        store.setExplain(null, null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const conflict = session.pending?.conflict ?? null;
  const pendingEdge =
    session.pending?.type === 'above'
      ? { younger: session.pending.younger, older: session.pending.older }
      : null;

  const explainSteps =
    explainMode && session.explainFrom && session.explainTo
      ? explainPath(h, session.explainFrom, session.explainTo)
      : null;

  const onExplainPick = (unitId: string): void => {
    if (!session.explainFrom) {
      store.setExplain(unitId, null);
    } else if (!session.explainTo) {
      store.setExplain(session.explainFrom, unitId);
    } else {
      store.setExplain(unitId, null);
    }
  };

  const hist = store.getHistory();

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">Harris 地层矩阵工作台</span>
        <div className="group">
          <select
            title="切换假设"
            value={project.currentId}
            onChange={(e) => store.switchHypothesis(e.target.value)}
          >
            {project.hypothesisOrder.map((id) => (
              <option key={id} value={id}>{project.hypotheses[id].name}</option>
            ))}
          </select>
          <button title="复制当前矩阵为新假设" onClick={() => store.duplicateHypothesis()}>复制假设</button>
          <button title="比较两套假设" onClick={() => setTab('hypotheses')}>比较…</button>
        </div>
        <div className="group">
          <button disabled={!hist.canUndo} onClick={() => store.undo()} title="撤销 (Ctrl+Z)">↶ 撤销</button>
          <button disabled={!hist.canRedo} onClick={() => store.redo()} title="重做 (Ctrl+Shift+Z)">↷ 重做</button>
        </div>
        <div className="group">
          <button
            className={explainMode ? 'active' : ''}
            onClick={() => {
              setExplainMode((v) => !v);
              store.setExplain(null, null);
            }}
            title="选择两个单元解释其间的传递关系"
          >
            路径解释
          </button>
          <span className="hint-text">
            {prop.dateConflicts.length + prop.phaseConflicts.length > 0 ? (
              <span className="badge critical" style={{ marginLeft: 4 }}>
                ● {prop.dateConflicts.length + prop.phaseConflicts.length} 处年代/分期冲突
              </span>
            ) : (
              <span className="badge good">✓ 年代自洽</span>
            )}
          </span>
          {reviewItems.length > 0 && reviewDiff && (
            <button
              className="review-pill"
              title="查看候选变更的影响差异"
              onClick={() => setTab('review')}
            >
              候选 {reviewItems.length} · 影响 {reviewDiff.affectedUnitIds.length} ·
              冲突 {reviewDiff.conflictsBefore.length}→{reviewDiff.conflictsAfter.length}
            </button>
          )}
        </div>
        <div className="spacer" />
        <div className="group">
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? '🌙 暗色' : '☀ 亮色'}
          </button>
          <button
            className="ghost"
            title="清空并恢复内置示例"
            onClick={() => {
              if (confirm('将清空本地全部数据并恢复内置 T1 示例，确定吗？')) store.resetToSample();
            }}
          >
            重置示例
          </button>
        </div>
      </div>

      <div className="main">
        <Canvas
          h={h}
          q={q}
          lay={lay}
          prop={prop}
          hiddenIds={hiddenIds}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
          selection={session.selection}
          onSelect={(s) => store.select(s)}
          explainMode={explainMode}
          explainFrom={session.explainFrom}
          explainTo={session.explainTo}
          explainSteps={explainSteps}
          onExplainPick={onExplainPick}
          conflict={conflict}
          pendingEdge={pendingEdge}
          onCommitNodePosition={(root, pos) => store.setClassPosition(root, pos)}
          onResetPositions={() => store.resetLayout()}
        />

        {explainMode && session.explainFrom && session.explainTo &&
          h.units[session.explainFrom] && h.units[session.explainTo] && (
          <div
            className="callout explain-callout"
            style={{ position: 'absolute', right: 396, top: 60, width: 340, zIndex: 20, margin: 0 }}
          >
            <div className="inline-row" style={{ justifyContent: 'space-between' }}>
              <strong>路径解释</strong>
              <button className="ghost small" onClick={() => store.setExplain(null, null)}>清除</button>
            </div>
            {explainSteps === null ? (
              <p className="small" style={{ color: 'var(--critical)', margin: '6px 0' }}>
                二者之间不存在早晚/同期路径：{h.units[session.explainFrom].code} 并不晚于{' '}
                {h.units[session.explainTo].code}。
              </p>
            ) : explainSteps.length === 0 ? (
              <p className="small muted" style={{ margin: '6px 0' }}>起点与终点是同一单元。</p>
            ) : (
              <>
                <p className="small" style={{ margin: '6px 0' }}>
                  <CodeChip code={h.units[session.explainFrom].code} kind={h.units[session.explainFrom].kind} />
                  {' '}晚于{' '}
                  <CodeChip code={h.units[session.explainTo].code} kind={h.units[session.explainTo].kind} />
                  ，由以下直接关系链推出：
                </p>
                <ChainView
                  steps={explainSteps}
                  h={h}
                  onSelectUnit={(id) => store.select({ type: 'unit', id })}
                  onSelectEdge={(id) => store.select({ type: 'edge', id })}
                />
              </>
            )}
          </div>
        )}

        <div className="sidebar">
          {session.notice && session.notice.hypothesisId === h.id && (
            <AdoptionNotice h={h} notice={session.notice} onDismiss={() => store.dismissNotice()} />
          )}
          <div className="tabs">
            <button className={tab === 'record' ? 'active' : ''} onClick={() => setTab('record')}>
              录入与校核{session.pending ? ' ●' : ''}
            </button>
            <button className={tab === 'dates' ? 'active' : ''} onClick={() => setTab('dates')}>
              年代/分期
              {prop.dateConflicts.length + prop.phaseConflicts.length > 0 ? ' ●' : ''}
            </button>
            <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
              证据复核{reviewItems.length ? `（${reviewItems.length}）` : ''}
            </button>
            <button className={tab === 'hypotheses' ? 'active' : ''} onClick={() => setTab('hypotheses')}>
              假设
            </button>
          </div>
          <div className="tab-body">
            {tab === 'record' && (
              <RecordTab h={h} selection={session.selection} pending={session.pending} />
            )}
            {tab === 'dates' && <DatesTab h={h} prop={prop} />}
            {tab === 'review' && <ReviewTab h={h} items={reviewItems} />}
            {tab === 'hypotheses' && (
              <HypothesesTab project={project} onCompare={(a, b) => setCompare({ a, b })} />
            )}
          </div>
        </div>
      </div>

      {compare && (
        <CompareModal
          project={project}
          aId={compare.a}
          bId={compare.b}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}

function AdoptionNotice({
  h,
  notice,
  onDismiss,
}: {
  h: ReturnType<typeof store.getState>['project']['hypotheses'][string];
  notice: AdoptionNoticeData;
  onDismiss(): void;
}) {
  return (
    <div className="callout adoption-callout">
      <div className="inline-row" style={{ justifyContent: 'space-between' }}>
        <span className="badge good">✓ 候选已采用（一条可撤销事务）</span>
        <button className="ghost small" onClick={onDismiss}>关闭</button>
      </div>
      <p className="small" style={{ margin: '4px 0' }}>
        撤回 {notice.withdrawnCount} 条证据，影响 {notice.affectedCount} 个单元；
        可随时 Ctrl+Z 整体撤销本次采用。
        {notice.danglingCount > 0 && ` ${notice.danglingCount} 条引用在采用前已失效，未重复删除。`}
      </p>
      {notice.orphans.length > 0 && (
        <div>
          <span className="badge warning">● {notice.orphans.length} 个单元无法在矩阵中定位</span>
          {notice.orphans.map((o) => (
            <p className="small" key={o.unitId} style={{ margin: '4px 0' }}>
              <CodeChip code={h.units[o.unitId]?.code ?? o.unitId} kind={h.units[o.unitId]?.kind} />
              {o.reason}
            </p>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>
            这些单元没有被删除：请补录早晚/等同关系，或撤销本次采用改判为「暂不采用」。
          </p>
        </div>
      )}
    </div>
  );
}
