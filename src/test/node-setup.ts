// node 测试环境下提供 localStorage 的内存实现（store 模块加载时需要）
const mem = new Map<string, string>();

const storage = {
  getItem: (k: string): string | null => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string): void => {
    mem.set(k, String(v));
  },
  removeItem: (k: string): void => {
    mem.delete(k);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (i: number): string | null => [...mem.keys()][i] ?? null,
  get length(): number {
    return mem.size;
  },
};

Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
