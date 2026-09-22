import { useMemo, useState } from 'react';
import type { Hypothesis, Selection, PendingChange, UnitKind } from '../lib/types';
import { UNIT_KIND_LABEL } from '../lib/types';
import { store } from '../lib/store';
import { reducedEdges, transitiveReduction, explainPath } from '../lib/graph';
import { dateRefId, phaseRefId } from '../lib/review';
import ChainView from './ChainView';
import PendingCallout from './PendingCallout';
import { CodeChip } from './ui';

interface Props {
  h: Hypothesis;
  selection: Selection;
  pending: PendingChange | null;
}

const KINDS: UnitKind[] = ['deposit', 'cut', 'construction'];

export default function RecordTab({ h, selection, pending }: Props) {
  return (
    <div>
      {pending && <PendingCallout h={h} pending={pending} />}
      <AddUnit />
      <UnitList h={h} selection={selection} />
      <AddRelation h={h} />
      <SelectionDetail h={h} selection={selection} />
      <AllRelations h={h} selection={selection} />
    </div>
  );
}

function AddUnit() {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<UnitKind>('deposit');
  const [note, setNote] = useState('');
  return (
    <div className="section">
      <h3>新建地层单元</h3>
      <div className="field-row">
        <div className="field">
          <label>现场编号</label>
          <input value={code} placeholder="如 201" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="field">
          <label>类型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as UnitKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{UNIT_KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>描述</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="堆积/切割/构筑说明" />
      </div>
      <button
        className="primary"
        onClick={() => {
          store.addUnit(code, kind, note);
          setCode('');
          setNote('');
        }}
      >
        添加单元
      </button>
    </div>
  );
}

function UnitList({ h, selection }: { h: Hypothesis; selection: Selection }) {
  return (
    <div className="section">
      <h3>单元（{h.unitIds.length}）</h3>
      <div className="entity-list">
        {h.unitIds.map((id) => {
          const u = h.units[id];
          const selected = selection.type === 'unit' && selection.id === id;
          return (
            <div
              key={id}
              className={`entity-item${selected ? ' selected' : ''}`}
              onClick={() => store.select({ type: 'unit', id })}
            >
              <CodeChip code={u.code} kind={u.kind} />
              <span className="small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.note || <span className="muted">无描述</span>}
              </span>
              {u.dates.length > 0 && <span className="tag">年代×{u.dates.length}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnitSelect({ h, value, onChange, allowEmpty }: {
  h: Hypothesis;
  value: string;
  onChange(v: string): void;
  allowEmpty?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">选择单元…</option>}
      {h.unitIds.map((id) => (
        <option key={id} value={id}>
          {h.units[id].code} {h.units[id].note.slice(0, 14)}
        </option>
      ))}
    </select>
  );
}

function AddRelation({ h }: { h: Hypothesis }) {
  const [younger, setYounger] = useState('');
  const [older, setOlder] = useState('');
  const [note, setNote] = useState('');
  const [ea, setEa] = useState('');
  const [eb, setEb] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitAbove = (): void => {
    if (!younger || !older || younger === older) {
      setError('请选择两个不同的单元');
      return;
    }
    setError(null);
    const ok = store.addAbove(younger, older, note);
    if (ok) {
      setYounger('');
      setOlder('');
      setNote('');
    }
  };
  const submitEquiv = (): void => {
    if (!ea || !eb || ea === eb) {
      setError('请选择两个不同的单元');
      return;
    }
    setError(null);
    const ok = store.addEquiv(ea, eb);
    if (ok) {
      setEa('');
      setEb('');
    }
  };

  return (
    <div className="section">
      <h3>录入关系</h3>
      <label className="small muted">早晚关系（前者晚于/压着后者）</label>
      <div className="field-row">
        <UnitSelect h={h} value={younger} onChange={setYounger} allowEmpty />
        <UnitSelect h={h} value={older} onChange={setOlder} allowEmpty />
      </div>
      <div className="field">
        <input value={note} placeholder="关系依据（可选）" onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="primary" onClick={submitAbove}>添加早晚关系</button>

      <div style={{ height: 10 }} />
      <label className="small muted">等同关系（两个单元同期）</label>
      <div className="field-row">
        <UnitSelect h={h} value={ea} onChange={setEa} allowEmpty />
        <UnitSelect h={h} value={eb} onChange={setEb} allowEmpty />
      </div>
      <button onClick={submitEquiv}>标记为同期</button>
      {error && <p className="small" style={{ color: 'var(--critical)' }}>{error}</p>}
    </div>
  );
}

function SelectionDetail({ h, selection }: { h: Hypothesis; selection: Selection }) {
  const visible = useMemo(() => new Set(reducedEdges(h).map((r) => r.id)), [h]);

  if (selection.type === 'none') {
    return (
      <div className="section">
        <h3>详情</h3>
        <p className="small muted">点击矩阵中的单元或连线查看详情；也可在画布中使用“路径解释”。</p>
      </div>
    );
  }

  if (selection.type === 'unit') {
    // 选择可能落在等同类的任意成员
    const id = h.units[selection.id] ? selection.id : h.unitIds[0];
    const u = h.units[id];
    if (!u) return null;
    const related = h.above.filter((r) => r.younger === id || r.older === id);
    return (
      <div className="section">
        <h3>单元详情</h3>
        <div className="inline-row" style={{ marginBottom: 6 }}>
          <CodeChip code={u.code} kind={u.kind} />
          <strong>{UNIT_KIND_LABEL[u.kind]}</strong>
          <span className="spacer" />
          <button className="ghost danger small" onClick={() => store.deleteUnit(id)}>删除</button>
        </div>
        <div className="field-row">
          <div className="field">
            <label>编号</label>
            <input value={u.code} onChange={(e) => store.updateUnit(id, { code: e.target.value })} />
          </div>
          <div className="field">
            <label>类型</label>
            <select value={u.kind} onChange={(e) => store.updateUnit(id, { kind: e.target.value as UnitKind })}>
              {KINDS.map((k) => <option key={k} value={k}>{UNIT_KIND_LABEL[k]}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>描述</label>
          <textarea rows={2} value={u.note} onChange={(e) => store.updateUnit(id, { note: e.target.value })} />
        </div>
        <div className="field">
          <label>人工分期</label>
          <div className="inline-row">
            <select style={{ flex: 1 }} value={u.phaseId ?? ''} onChange={(e) => store.setUnitPhase(id, e.target.value || null)}>
              <option value="">（未分期）</option>
              {[...h.phases].sort((a, b) => a.rank - b.rank).map((p) => (
                <option key={p.id} value={p.id}>{p.name}（序 {p.rank}）</option>
              ))}
            </select>
            {u.phaseId && (
              <button className="ghost small" title="把该人工分期指派送复核"
                onClick={() => store.addReviewItem({ evidence: 'phase', refId: phaseRefId(id), unitId: id })}>
                送审
              </button>
            )}
          </div>
        </div>

        <DateEditor h={h} unitId={id} />

        <h3 style={{ marginTop: 12 }}>相关关系（{related.length}）</h3>
        {related.length === 0 && <p className="small muted">暂无</p>}
        {related.map((r) => {
          const other = r.younger === id ? r.older : r.younger;
          const dir = r.younger === id ? '晚于' : '早于';
          return (
            <div key={r.id} className="entity-item" onClick={() => store.select({ type: 'edge', id: r.id })}>
              <span className="small">{dir}</span>
              <CodeChip code={h.units[other].code} kind={h.units[other].kind} />
              {!visible.has(r.id) && <span className="tag">已隐藏</span>}
            </div>
          );
        })}
      </div>
    );
  }

  const rel = h.above.find((r) => r.id === selection.id);
  if (!rel) return null;
  const isHidden = !visible.has(rel.id);
  const cover = isHidden ? explainPath(h, rel.younger, rel.older) : null;
  return (
    <div className="section">
      <h3>关系详情</h3>
      <div className="inline-row" style={{ marginBottom: 6 }}>
        <CodeChip code={h.units[rel.younger].code} kind={h.units[rel.younger].kind} />
        <span className="muted">晚于</span>
        <CodeChip code={h.units[rel.older].code} kind={h.units[rel.older].kind} />
        <span className="spacer" />
        <button className="ghost small" title="作为待审证据送复核"
          onClick={() => store.addReviewItem({ evidence: 'above', refId: rel.id })}>
          送审
        </button>
        <button className="ghost danger small" onClick={() => store.deleteAbove(rel.id)}>删除</button>
      </div>
      <div className="field">
        <label>关系依据</label>
        <textarea rows={2} value={rel.note} onChange={(e) => store.updateAboveNote(rel.id, e.target.value)} />
      </div>
      {isHidden ? (
        <div className="callout warning-callout">
          <strong>该连线在矩阵中已隐藏（传递约简）</strong>
          <p className="small" style={{ margin: '4px 0' }}>
            含义未丢失：下面这条更细的直接关系链已经表达了“{h.units[rel.younger].code} 晚于{' '}
            {h.units[rel.older].code}”。
          </p>
          {cover && cover.length > 0 ? (
            <ChainView
              steps={cover}
              h={h}
              onSelectUnit={(uid) => store.select({ type: 'unit', id: uid })}
              onSelectEdge={(eid) => store.select({ type: 'edge', id: eid })}
            />
          ) : (
            <p className="small muted">（该关系与另一条关系平行，未被隐藏才对——若出现请检查数据）</p>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            删除它不会改变矩阵；删除链上的某条直接关系后，它会重新出现。
          </p>
        </div>
      ) : (
        <p className="small muted">这是保持含义所需的直接连线。</p>
      )}
    </div>
  );
}

function DateEditor({ h, unitId }: { h: Hypothesis; unitId: string }) {
  const u = h.units[unitId];
  const [early, setEarly] = useState('');
  const [late, setLate] = useState('');
  const [label, setLabel] = useState('');

  return (
    <div>
      <label className="small muted">出土物年代范围（公元纪年，公元前填负数）</label>
      {u.dates.map((d, i) => (
        <div key={i} className="inline-row" style={{ marginBottom: 4 }}>
          <input
            className="small"
            type="number"
            value={d.early}
            onChange={(e) => store.updateDate(unitId, i, { early: Number(e.target.value) })}
          />
          <span className="muted">~</span>
          <input
            className="small"
            type="number"
            value={d.late}
            onChange={(e) => store.updateDate(unitId, i, { late: Number(e.target.value) })}
          />
          <input
            className="small"
            style={{ flex: 1.4 }}
            value={d.label}
            onChange={(e) => store.updateDate(unitId, i, { label: e.target.value })}
          />
          <button className="ghost small" title="作为待审证据送复核"
            onClick={() =>
              store.addReviewItem({
                evidence: 'date',
                refId: dateRefId(unitId, i),
                unitId,
                dateIndex: i,
                dateSnapshot: { ...d },
              })
            }>
            送审
          </button>
          <button className="ghost danger" onClick={() => store.deleteDate(unitId, i)}>×</button>
        </div>
      ))}
      <div className="inline-row">
        <input type="number" placeholder="最早" value={early} onChange={(e) => setEarly(e.target.value)} />
        <span className="muted">~</span>
        <input type="number" placeholder="最晚" value={late} onChange={(e) => setLate(e.target.value)} />
        <input style={{ flex: 1.4 }} placeholder="遗物/证据" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button
          onClick={() => {
            if (early === '' || late === '') return;
            store.addDate(unitId, { early: Number(early), late: Number(late), label });
            setEarly('');
            setLate('');
            setLabel('');
          }}
        >
          ＋
        </button>
      </div>
    </div>
  );
}

function AllRelations({ h }: { h: Hypothesis; selection: Selection }) {
  const hidden = useMemo(() => transitiveReduction(h), [h]);
  return (
    <div className="section">
      <h3>全部关系（{h.above.length}，其中 {hidden.size} 条隐藏）</h3>
      <div className="entity-list">
        {[...h.above]
          .sort((a, b) => (a.younger === b.younger ? a.older.localeCompare(b.older) : a.younger.localeCompare(b.younger)))
          .map((r) => (
            <div
              key={r.id}
              className="entity-item"
              onClick={() => store.select({ type: 'edge', id: r.id })}
            >
              <CodeChip code={h.units[r.younger].code} kind={h.units[r.younger].kind} />
              <span className="muted">→</span>
              <CodeChip code={h.units[r.older].code} kind={h.units[r.older].kind} />
              <span className="spacer" />
              {hidden.has(r.id) ? <span className="tag">隐藏</span> : <span className="badge good">直接</span>}
            </div>
          ))}
      </div>
      <h3 style={{ marginTop: 12 }}>等同组（{h.equivs.length}）</h3>
      <div className="entity-list">
        {h.equivs.map((e) => (
          <div key={e.id} className="entity-item">
            <CodeChip code={h.units[e.a].code} kind={h.units[e.a].kind} />
            <span className="muted">＝</span>
            <CodeChip code={h.units[e.b].code} kind={h.units[e.b].kind} />
            <span className="spacer" />
            <button className="ghost small" title="作为待审证据送复核"
              onClick={() => store.addReviewItem({ evidence: 'equiv', refId: e.id })}>
              送审
            </button>
            <button className="ghost danger small" onClick={() => store.deleteEquiv(e.id)}>拆组</button>
          </div>
        ))}
        {h.equivs.length === 0 && <p className="small muted">暂无等同关系</p>}
      </div>
    </div>
  );
}
