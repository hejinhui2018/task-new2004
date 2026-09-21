import { useMemo, useState } from 'react';
import type { Hypothesis } from '../lib/types';
import { store } from '../lib/store';
import { diffHypotheses } from '../lib/hypothesis';
import { CodeChip } from './ui';

interface ProjectData {
  hypotheses: Record<string, Hypothesis>;
  hypothesisOrder: string[];
  currentId: string;
}

export function HypothesesTab({ project, onCompare }: { project: ProjectData; onCompare: (a: string, b: string) => void }) {
  const [name, setName] = useState('');
  const [a, setA] = useState(project.currentId);
  const others = project.hypothesisOrder.filter((id) => id !== a);
  const [b, setB] = useState(others[0] ?? '');

  return (
    <div>
      <div className="section">
        <h3>解释假设（{project.hypothesisOrder.length}）</h3>
        <p className="small muted">
          复制当前矩阵建立另一套解释；不同假设中的单元按稳定身份对应，可比较新增、删除与反转的关系。
        </p>
        <div className="entity-list">
          {project.hypothesisOrder.map((id) => {
            const hyp = project.hypotheses[id];
            return (
              <div key={id} className={`entity-item${id === project.currentId ? ' selected' : ''}`}>
                <input
                  className="small"
                  style={{ flex: 1 }}
                  value={hyp.name}
                  onChange={(e) => store.renameHypothesis(id, e.target.value)}
                />
                <span className="tag">{hyp.unitIds.length} 单元</span>
                <span className="tag">{hyp.above.length} 关系</span>
                {id !== project.currentId && (
                  <button className="small" onClick={() => store.switchHypothesis(id)}>切换</button>
                )}
                <button className="small" onClick={() => store.duplicateHypothesis()}>复制</button>
                <button
                  className="ghost danger small"
                  disabled={project.hypothesisOrder.length <= 1}
                  onClick={() => store.deleteHypothesis(id)}
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
        <div className="inline-row" style={{ marginTop: 8 }}>
          <input placeholder="新空白假设名称" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            onClick={() => {
              if (!name) return;
              store.createBlankHypothesis(name);
              setName('');
            }}
          >
            新建空白
          </button>
        </div>
      </div>

      <div className="section">
        <h3>比较两套假设</h3>
        <div className="field">
          <label>假设 A（基准）</label>
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {project.hypothesisOrder.map((id) => (
              <option key={id} value={id}>{project.hypotheses[id].name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>假设 B</label>
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {project.hypothesisOrder.filter((id) => id !== a).map((id) => (
              <option key={id} value={id}>{project.hypotheses[id].name}</option>
            ))}
          </select>
        </div>
        <button className="primary" disabled={!b} onClick={() => onCompare(a, b)}>
          比较 A 与 B
        </button>
      </div>
    </div>
  );
}

export function CompareModal({
  project,
  aId,
  bId,
  onClose,
}: {
  project: ProjectData;
  aId: string;
  bId: string;
  onClose(): void;
}) {
  const a = project.hypotheses[aId] as Hypothesis | undefined;
  const b = project.hypotheses[bId] as Hypothesis | undefined;
  const diff = useMemo(() => (a && b ? diffHypotheses(a, b) : null), [a, b]);
  if (!a || !b || !diff) return null;

  const chip = (hyp: Hypothesis, id: string): React.JSX.Element => (
    <CodeChip code={hyp.units[id]?.code ?? '?'} kind={hyp.units[id]?.kind} />
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>假设比较</strong>
          <span className="muted small">
            {a.name}（A） ↔ {b.name}（B）
          </span>
        </header>
        <div className="body">
          {(diff.onlyInA.length > 0 || diff.onlyInB.length > 0) && (
            <div className="section">
              <h3>单元身份差异</h3>
              {diff.onlyInA.length > 0 && (
                <p className="small">仅 A 中有：{diff.onlyInA.map((id) => chip(a, id))}</p>
              )}
              {diff.onlyInB.length > 0 && (
                <p className="small">仅 B 中有：{diff.onlyInB.map((id) => chip(b, id))}</p>
              )}
            </div>
          )}

          <div className="diff-cols">
            <div>
              <h3 className="small">B 相对 A 新增（{diff.added.length}）</h3>
              {diff.added.map((p, i) => (
                <div className="diff-entry added" key={`ad${i}`}>
                  {chip(b, p.younger)} <span className="muted">晚于</span> {chip(b, p.older)}
                </div>
              ))}
              {diff.added.length === 0 && <p className="small muted">无</p>}
              <h3 className="small" style={{ marginTop: 12 }}>等同：新合并（{diff.equiv.merged.length}）</h3>
              {diff.equiv.merged.map((p, i) => (
                <div className="diff-entry added" key={`m${i}`}>
                  {chip(b, p[0])} ＝ {chip(b, p[1])}
                </div>
              ))}
              {diff.equiv.merged.length === 0 && <p className="small muted">无</p>}
            </div>
            <div>
              <h3 className="small">B 相对 A 删除（{diff.removed.length}）</h3>
              {diff.removed.map((p, i) => (
                <div className="diff-entry removed" key={`rm${i}`}>
                  {chip(a, p.younger)} <span className="muted">晚于</span> {chip(a, p.older)}
                </div>
              ))}
              {diff.removed.length === 0 && <p className="small muted">无</p>}
              <h3 className="small" style={{ marginTop: 12 }}>等同：被拆开（{diff.equiv.split.length}）</h3>
              {diff.equiv.split.map((p, i) => (
                <div className="diff-entry removed" key={`s${i}`}>
                  {chip(a, p[0])} ＝ {chip(a, p[1])}
                </div>
              ))}
              {diff.equiv.split.length === 0 && <p className="small muted">无</p>}
            </div>
          </div>

          <h3 className="small" style={{ marginTop: 12 }}>关系反转（{diff.reversed.length}）</h3>
          {diff.reversed.map((r, i) => (
            <div className="diff-entry reversed" key={`rv${i}`}>
              A：{chip(a, r.a)} <span className="muted">晚于</span> {chip(a, r.b)}
              <span style={{ margin: '0 6px' }}>⇄</span>
              B：{chip(b, r.b)} <span className="muted">晚于</span> {chip(b, r.a)}
            </div>
          ))}
          {diff.reversed.length === 0 && <p className="small muted">无</p>}

          {diff.added.length === 0 && diff.removed.length === 0 && diff.reversed.length === 0 &&
            diff.equiv.merged.length === 0 && diff.equiv.split.length === 0 && (
              <p className="small">两套假设的矩阵结构完全一致（仅可能在年代、分期、描述上不同）。</p>
            )}
        </div>
        <footer>
          <button className="primary" onClick={onClose}>关闭</button>
        </footer>
      </div>
    </div>
  );
}
