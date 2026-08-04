export class NetworkMetadataJobQueue {
  private activeCount = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly concurrency = 2) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await work();
    } finally {
      this.activeCount -= 1;
      this.pending.shift()?.();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.pending.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }
}
