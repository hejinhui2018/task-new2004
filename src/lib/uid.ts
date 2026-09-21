/** 稳定 id 生成（无第三方依赖） */
let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function resetIdCounterForTest(n = 0): void {
  counter = n;
}
