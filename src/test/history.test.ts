import { describe, expect, it } from 'vitest';
import { History } from '../lib/history';

describe('历史恢复', () => {
  it('push 后可撤销、重做', () => {
    const h = new History<number>(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    h.push(1);
    h.push(2);
    expect(h.state).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(1);
    expect(h.state).toBe(1);
    expect(h.redo()).toBe(2);
  });

  it('在撤销后提交会丢弃重做栈', () => {
    const h = new History<string>('a');
    h.push('b');
    h.push('c');
    h.undo(); // back to b
    expect(h.state).toBe('b');
    h.push('d');
    expect(h.canRedo).toBe(false);
    expect(h.state).toBe('d');
    expect(h.undo()).toBe('b');
  });

  it('到达容量上限时丢弃最早快照', () => {
    const h = new History<number>(0, 3);
    h.push(1);
    h.push(2);
    h.push(3);
    h.push(4);
    // past 容量 3：1 已被丢弃，撤销三步回到 1 而非 0
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.canUndo).toBe(false);
  });

  it('无历史时 undo/redo 安全返回当前状态', () => {
    const h = new History<number>(42);
    expect(h.undo()).toBe(42);
    expect(h.redo()).toBe(42);
  });
});
