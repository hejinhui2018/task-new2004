import type { UnitKind } from '../lib/types';
import { UNIT_KIND_LABEL } from '../lib/types';

const KIND_VAR: Record<UnitKind, string> = {
  deposit: 'var(--kind-deposit)',
  cut: 'var(--kind-cut)',
  construction: 'var(--kind-construction)',
};

export function CodeChip({ code, kind }: { code: string; kind?: UnitKind }): React.JSX.Element {
  return (
    <span className="code-chip" style={kind ? { background: KIND_VAR[kind] } : undefined}>
      {code}
    </span>
  );
}

export function kindColor(kind: UnitKind): string {
  return KIND_VAR[kind];
}

export { UNIT_KIND_LABEL };
