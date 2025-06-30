/*
 * Revised Single-producer-multiple-consumer time-to-live FIFO queue
 */
export class TTLFIFOQueue<T> {
  private readonly ttl: number;
  private _barrier: bigint = 0n;
  public get barrier(): bigint {
    return this._barrier;
  }

  private _nextIndex: bigint = 0n;
  public get nextIndex(): bigint {
    return this._nextIndex;
  }

  private items: Array<{ value: T; expiresAt: number }> = [];
  private gcInterval: NodeJS.Timeout | null = null;

  constructor(ttl: number) {
    this.ttl = ttl;
    this.startGarbageCollection();
  }

  public add(item: T): void {
    const index = this._nextIndex;
    const expiresAt = Date.now() + this.ttl;
    const arrayIndex = Number(index - this._barrier);

    if (arrayIndex >= this.items.length) {
      this.items.length = arrayIndex + 1;
    }
    this.items[arrayIndex] = { value: item, expiresAt };
    this._nextIndex += 1n;
  }

  public createConsumer(): Consumer<T> {
    return new Consumer(this);
  }

  private isInvalidItem(index: bigint): string | null {
    const arrayIndex = Number(index - this._barrier);
    if (arrayIndex < 0) {
      return "beyond-barrier";
    }
    if (arrayIndex >= this.items.length) {
      return "unwritten";
    }
    const item = this.items[arrayIndex];
    if (item === null) {
      return "discarded";
    }
    if (Date.now() > item.expiresAt) {
      // this.items[arrayIndex] = null; // Mark as discarded
      return "expired";
    }
    return null;
  }

  public peekAt(index: bigint): T | null {
    if (index < this._barrier) {
      throw new Error("Consumer too slow: index beyond barrier");
    }
    if (index === this._nextIndex) {
      return null;
    }
    if (index > this._nextIndex) {
      throw new Error("Invalid peek beyond producer index");
    }

    const invalid = this.isInvalidItem(index);
    if (invalid) {
      if (invalid === "beyond-barrier") {
        throw new Error("Consumer too slow: index beyond barrier");
      }
      return null;
    }

    return this.items[Number(index - this._barrier)]!.value;
  }

  private startGarbageCollection(): void {
    this.gcInterval = setInterval(
      () => {
        const now = Date.now();
        let removeCount = 0;

        while (
          removeCount < this.items.length &&
          this.items[removeCount] &&
          this.items[removeCount]!.expiresAt < now
        ) {
          removeCount++;
        }

        if (removeCount > 0) {
          this.items.splice(0, removeCount);
          this._barrier += BigInt(removeCount);
        }
      },
      Math.max(100, this.ttl / 2),
    );
  }

  public destroy(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
  }
}

class Consumer<T> {
  private queue: TTLFIFOQueue<T>;
  private currentIndex: bigint;
  private stopped: boolean = false;

  constructor(queue: TTLFIFOQueue<T>) {
    this.queue = queue;
    this.currentIndex = queue.nextIndex;
  }

  public peek(): T | null {
    if (this.stopped) {
      const isBeyondBarrier = this.currentIndex < this.queue.barrier;
      if (isBeyondBarrier) {
        throw new Error("Consumer resumed at index beyond barrier");
      }
    }

    const value = this.queue.peekAt(this.currentIndex);

    if (value === null && this.currentIndex >= this.queue.nextIndex) {
      this.stopped = true;
    } else {
      this.stopped = false;
    }

    return value;
  }

  public seek(): void {
    this.currentIndex += BI1;

    if (this.currentIndex > this.queue.nextIndex) {
      this.stopped = true;
    }
  }

  public getCurrentIndex(): bigint {
    return this.currentIndex;
  }
}

const BI1 = 1n;
