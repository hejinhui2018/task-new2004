import type { ChainStep } from '../lib/types';
import type { Hypothesis } from '../lib/types';

interface ChainViewProps {
  steps: ChainStep[];
  h: Hypothesis;
  onSelectUnit?(id: string): void;
  onSelectEdge?(id: string): void;
  /** 标记为“拟新增”的边/等同 id（渲染为待处理样式） */
  provisionalId?: string;
}

/** 渲染晚→早/等同的证据链 */
export default function ChainView({ steps, h, onSelectUnit, onSelectEdge, provisionalId }: ChainViewProps) {
  if (!steps.length) return null;
  const code = (id: string): string => h.units[id]?.code ?? '?';
  const nodes: React.ReactNode[] = [];
  const unitBtn = (id: string, key: string): React.ReactNode => (
    <button
      key={key}
      className="step"
      onClick={() => onSelectUnit?.(id)}
      title={h.units[id]?.note}
    >
      {code(id)}
    </button>
  );

  nodes.push(unitBtn(steps[0].from, 'u0'));
  steps.forEach((s, i) => {
    const isProv = s.refId === provisionalId;
    const rel = h.above.find((r) => r.id === s.refId);
    const arrowLabel = s.kind === 'equiv' ? '＝ 同期' : `晚于${isProv ? '（新增）' : ''}`;
    nodes.push(
      <span className="arrow" key={`a${i}`} title={rel?.note}>
        {' '}
        {arrowLabel}{' '}
      </span>,
    );
    if (!isProv && s.kind === 'above') {
      nodes.push(
        <button
          key={`e${i}`}
          className={`step above`}
          onClick={() => onSelectEdge?.(s.refId)}
          title={rel?.note ?? '点选该关系'}
        >
          ▸
        </button>,
        <span className="arrow" key={`a2${i}`}> </span>,
      );
    }
    nodes.push(unitBtn(s.to, `u${i + 1}`));
  });

  return <div className="chain">{nodes}</div>;
}
