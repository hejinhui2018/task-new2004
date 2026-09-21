// 轻量快照历史：撤销 / 重做
export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];
  private limit: number;

  constructor(initial: T, limit = 200) {
    this.present = initial;
    this.limit = limit;
  }

  get state(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 提交新状态，清空重做栈 */
  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): T {
    const prev = this.past.pop();
    if (prev === undefined) return this.present;
    this.future.unshift(this.present);
    this.present = prev;
    return this.present;
  }

  redo(): T {
    const next = this.future.shift();
    if (next === undefined) return this.present;
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }
}
