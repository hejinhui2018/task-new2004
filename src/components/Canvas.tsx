import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChainStep, ConflictChain, Hypothesis, Selection } from '../lib/types';
import type { PropagationResult } from '../lib/dates';
import type { Quotient } from '../lib/graph';
import type { LayoutResult } from '../lib/layout';
import { NODE_W, NODE_H } from '../lib/layout';

interface CanvasProps {
  h: Hypothesis;
  q: Quotient;
  lay: LayoutResult;
  prop: PropagationResult;
  hiddenIds: Set<string>;
  showHidden: boolean;
  onToggleHidden(): void;
  selection: Selection;
  onSelect(s: Selection): void;
  explainMode: boolean;
  explainFrom: string | null;
  explainTo: string | null;
  explainSteps: ChainStep[] | null;
  onExplainPick(unitId: string): void;
  conflict: ConflictChain | null;
  pendingEdge: { younger: string; older: string } | null;
  /** 复核候选中标记“撤回”的关系 id（橙色虚线提示，不影响当前矩阵） */
  reviewRetractEdgeIds: Set<string>;
  onCommitNodePosition(root: string, pos: { x: number; y: number }): void;
  onResetPositions(): void;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const KIND_COLOR: Record<string, string> = {
  deposit: 'var(--kind-deposit)',
  cut: 'var(--kind-cut)',
  construction: 'var(--kind-construction)',
};

function boundaryPoint(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2;
  const hh = h / 2;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export default function Canvas(props: CanvasProps) {
  const {
    h, q, lay, prop, hiddenIds, showHidden, onToggleHidden,
    selection, onSelect, explainMode, explainFrom, explainTo, explainSteps,
    onExplainPick, conflict, pendingEdge, reviewRetractEdgeIds,
    onCommitNodePosition, onResetPositions,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 24, y: 16, k: 1 });
  const [playOpen, setPlayOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playLimit, setPlayLimit] = useState(0);
  const maxLevel = lay.rows.length - 1;

  useEffect(() => {
    setPlayLimit((v) => Math.min(v, Math.max(0, maxLevel)));
  }, [maxLevel]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPlayLimit((v) => {
        if (v >= maxLevel) {
          setPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, maxLevel]);

  // 拖拽状态
  const drag = useRef<
    | { kind: 'pan'; startX: number; startY: number; orig: Transform }
    | { kind: 'node'; root: string; startX: number; startY: number; orig: { x: number; y: number }; moved: boolean }
    | null
  >(null);
  const [floating, setFloating] = useState<Record<string, { x: number; y: number }>>({});

  // 非被动滚轮缩放
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const k = Math.min(2.4, Math.max(0.3, t.k * factor));
        const wx = (mx - t.x) / t.k;
        const wy = (my - t.y) / t.k;
        return { k, x: mx - wx * k, y: my - wy * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number): void => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setTransform((t) => {
      const k = Math.min(2.4, Math.max(0.3, t.k * factor));
      const wx = (mx - t.x) / t.k;
      const wy = (my - t.y) / t.k;
      return { k, x: mx - wx * k, y: my - wy * k };
    });
  };

  const fitView = (): void => {
    const rect = svgRef.current!.getBoundingClientRect();
    const k = Math.min(
      1.4,
      Math.max(0.3, Math.min((rect.width - 48) / lay.width, (rect.height - 48) / lay.height)),
    );
    setTransform({
      k,
      x: (rect.width - lay.width * k) / 2,
      y: (rect.height - lay.height * k) / 2,
    });
  };

  const onPointerDownBg = (e: React.PointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, orig: transform };
    onSelect({ type: 'none' });
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setTransform({
        ...d.orig,
        x: d.orig.x + (e.clientX - d.startX),
        y: d.orig.y + (e.clientY - d.startY),
      });
    } else {
      const dx = (e.clientX - d.startX) / transform.k;
      const dy = (e.clientY - d.startY) / transform.k;
      if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
      setFloating((f) => ({ ...f, [d.root]: { x: d.orig.x + dx, y: d.orig.y + dy } }));
    }
  };

  const onPointerUp = (): void => {
    const d = drag.current;
    if (d?.kind === 'node' && d.moved) {
      const pos = floating[d.root];
      if (pos) onCommitNodePosition(d.root, pos);
    }
    drag.current = null;
    setFloating({});
  };

  // 高亮集合
  const explainEdgeIds = useMemo(() => {
    const s = new Set<string>();
    for (const st of explainSteps ?? []) if (st.kind === 'above') s.add(st.refId);
    return s;
  }, [explainSteps]);
  const explainUnitIds = useMemo(() => {
    const s = new Set<string>();
    for (const st of explainSteps ?? []) {
      s.add(st.from);
      s.add(st.to);
    }
    return s;
  }, [explainSteps]);
  const conflictEdgeIds = useMemo(() => new Set(conflict?.edgeIds ?? []), [conflict]);
  const conflictUnits = useMemo(() => new Set(conflict?.unitIds ?? []), [conflict]);

  const dateConflictClasses = useMemo(() => {
    const s = new Set<string>();
    for (const c of prop.dateConflicts) {
      s.add(q.classes.rootOf.get(c.olderEvidence.unitId)!);
    }
    return s;
  }, [prop, q]);

  const codeOf = (id: string): string => h.units[id]?.code ?? '?';
  const nodePos = (root: string) => floating[root] ?? lay.nodes.get(root)!;

  const handleNodeClick = (root: string): void => {
    const d = drag.current;
    if (d?.kind === 'node' && d.moved) return;
    if (explainMode) {
      onExplainPick(root);
      return;
    }
    onSelect({ type: 'unit', id: root });
  };

  // 绘制边
  const edgeViews: React.ReactNode[] = [];
  const drawEdge = (
    relId: string,
    younger: string,
    older: string,
    cls: string,
    provisional = false,
  ): void => {
    const yc = q.classes.rootOf.get(younger)!;
    const oc = q.classes.rootOf.get(older)!;
    const a = nodePos(yc);
    const b = nodePos(oc);
    const p1 = boundaryPoint(a.x, a.y, b.x, b.y, NODE_W, NODE_H);
    const p2 = boundaryPoint(b.x, b.y, a.x, a.y, NODE_W, NODE_H);
    const selected = selection.type === 'edge' && selection.id === relId;
    const inPlay = playOpen && (lay.nodes.get(yc)!.level > playLimit || lay.nodes.get(oc)!.level > playLimit);
    edgeViews.push(
      <g key={provisional ? `pending-${relId}` : relId} opacity={inPlay ? 0.15 : 1}>
        <path
          className={`edge-hit`}
          d={`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!provisional) onSelect({ type: 'edge', id: relId });
          }}
        />
        <line
          className={`edge-line ${cls}${selected ? ' selected' : ''}`}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          markerEnd={cls.includes('conflict') ? 'url(#arrow-red)' : cls.includes('highlight') ? 'url(#arrow-violet)' : 'url(#arrow)'}
        />
      </g>,
    );
  };

  for (const e of q.edges) {
    const hidden = hiddenIds.has(e.rel.id);
    if (hidden && !showHidden) continue;
    let cls = hidden ? 'hidden-edge' : '';
    if (explainEdgeIds.has(e.rel.id)) cls = 'highlight';
    if (conflictEdgeIds.has(e.rel.id)) cls = 'conflict';
    if (reviewRetractEdgeIds.has(e.rel.id)) cls = cls ? `${cls} review-retract` : 'review-retract';
    drawEdge(e.rel.id, e.rel.younger, e.rel.older, cls);
  }
  if (pendingEdge && conflict) {
    drawEdge('pending', pendingEdge.younger, pendingEdge.older, 'conflict', true);
  }

  const anyHighlight = explainSteps !== null || conflict !== null;
  const activeLevel = playOpen ? playLimit : Infinity;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-secondary)" />
          </marker>
          <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--critical)" />
          </marker>
          <marker id="arrow-violet" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--explain)" />
          </marker>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {edgeViews}
          {[...lay.nodes.values()].map((n) => {
            const pos = nodePos(n.id);
            const firstKind = h.units[n.members[0]]?.kind ?? 'deposit';
            const isSelected =
              (selection.type === 'unit' && n.members.includes(selection.id)) ||
              (selection.type === 'unit' && selection.id === n.id);
            const inExplain = n.members.some((m) => explainUnitIds.has(m));
            const inConflict = n.members.some((m) => conflictUnits.has(m));
            const isExplainEndpoint =
              n.members.includes(explainFrom ?? '') || n.members.includes(explainTo ?? '');
            const dimmed =
              (anyHighlight && !inExplain && !inConflict) ||
              (playOpen && n.level > activeLevel);
            const hasDateIssue = dateConflictClasses.has(n.id);
            const codes = n.members.map(codeOf).join('＝');
            return (
              <g
                key={n.id}
                className={`node${isSelected || isExplainEndpoint ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
                transform={`translate(${pos.x},${pos.y})`}
                style={{ cursor: explainMode ? 'crosshair' : 'grab' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  drag.current = {
                    kind: 'node',
                    root: n.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    orig: { x: pos.x, y: pos.y },
                    moved: false,
                  };
                }}
                onPointerUp={(e) => {
                  // 不阻止冒泡：svg 根节点的 onPointerUp 负责提交拖拽与清理
                  e.preventDefault();
                  handleNodeClick(n.id);
                }}
              >
                <rect
                  className="node-rect"
                  x={-NODE_W / 2}
                  y={-NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  stroke={inConflict ? 'var(--critical)' : isSelected || isExplainEndpoint ? 'var(--accent)' : KIND_COLOR[firstKind]}
                />
                <rect x={-NODE_W / 2} y={-NODE_H / 2} width={5} height={NODE_H} rx={2} fill={KIND_COLOR[firstKind]} />
                <text className="node-text" y={n.members.length > 1 ? -7 : 0}>
                  {codes}
                </text>
                {n.members.length > 1 && (
                  <text className="node-sub" y={11}>
                    {n.members.map((m) => UNIT_KIND_SHORT[h.units[m]?.kind ?? 'deposit']).join('/')} 同期
                  </text>
                )}
                {hasDateIssue && (
                  <circle cx={NODE_W / 2 - 7} cy={-NODE_H / 2 + 7} r={5} fill="var(--critical)">
                    <title>该单元年代无解</title>
                  </circle>
                )}
                <title>
                  {n.members.map((m) => `${h.units[m]?.code} ${h.units[m]?.note}`).join('\n')}
                </title>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="legend">
        <div className="row"><span className="swatch" style={{ background: KIND_COLOR.deposit }} />堆积</div>
        <div className="row"><span className="swatch" style={{ background: KIND_COLOR.cut }} />切割</div>
        <div className="row"><span className="swatch" style={{ background: KIND_COLOR.construction }} />构筑</div>
        <div className="row"><span className="line" />直接早晚连线（晚 → 早）</div>
        <div className="row"><span className="line hidden" />被约简的传递关系</div>
        <div className="row"><span className="line equiv" />＝ 等同（节点已合并）</div>
        {reviewRetractEdgeIds.size > 0 && (
          <div className="row"><span className="line retract" />复核候选撤回（未生效）</div>
        )}
      </div>

      {explainMode && (
        <div className="canvas-mode-hint">
          路径解释模式：依次点击 <b>较晚</b> 单元与 <b>较早</b> 单元
          {explainFrom ? `（已选 ${codeOf(explainFrom)}，再选终点）` : ''}
        </div>
      )}

      <div className="canvas-hud">
        <button onClick={() => zoomBy(1 / 1.15)} title="缩小">－</button>
        <span className="small muted" style={{ minWidth: 42, textAlign: 'center' }}>
          {Math.round(transform.k * 100)}%
        </span>
        <button onClick={() => zoomBy(1.15)} title="放大">＋</button>
        <button onClick={fitView}>适应</button>
        <button onClick={onResetPositions} title="恢复自动布局">重排</button>
        <button className={showHidden ? 'active' : ''} onClick={onToggleHidden}>
          显示隐藏线
        </button>
        <button className={playOpen ? 'active' : ''} onClick={() => { setPlayOpen((v) => !v); setPlaying(false); }}>
          播放形成过程
        </button>
      </div>

      {playOpen && (
        <div className="player">
          <button onClick={() => { setPlayLimit(0); setPlaying(true); }}>⏮ 从头</button>
          <button onClick={() => setPlaying((v) => !v)}>{playing ? '⏸' : '▶'}</button>
          <input
            type="range"
            min={0}
            max={maxLevel}
            value={playLimit}
            onChange={(e) => { setPlaying(false); setPlayLimit(Number(e.target.value)); }}
          />
          <span className="small">
            第 {playLimit}/{maxLevel} 层（0 = 最早）
          </span>
        </div>
      )}
    </div>
  );
}

const UNIT_KIND_SHORT: Record<string, string> = {
  deposit: '堆',
  cut: '切',
  construction: '筑',
};
