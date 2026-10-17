import type { ConvertOptions, Job, WorkerRequest, WorkerResponse } from './types';

interface Task {
  req: WorkerRequest;
  transfer: Transferable[];
  resolve: (pages: Uint8Array) => void;
  reject: (err: Error) => void;
}

/** Fixed-size pool of conversion workers, each with its own wasm instance. */
export class WorkerPool {
  readonly size: number;
  private idle: Worker[] = [];
  private queue: Task[] = [];
  private running = new Map<Worker, Task>();
  private nextId = 1;
  private workers: Worker[] = [];

  constructor(size = Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.finish(w, e.data);
      w.onerror = (e) => {
        e.preventDefault();
        this.finish(w, { id: 0, ok: false, error: e.message || 'worker failed to load' });
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  run(job: Job, opts: ConvertOptions): Promise<Uint8Array> {
    const transfer: Transferable[] = [job.kind === 'encoded' ? job.bytes : job.rgba];
    return new Promise((resolve, reject) => {
      this.queue.push({ req: { id: this.nextId++, job, opts }, transfer, resolve, reject });
      this.pump();
    });
  }

  terminate(): void {
    this.workers.forEach((w) => w.terminate());
    const err = new Error('cancelled');
    this.queue.forEach((t) => t.reject(err));
    this.running.forEach((t) => t.reject(err));
    this.queue = [];
    this.running.clear();
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const t = this.queue.shift()!;
      this.running.set(w, t);
      w.postMessage(t.req, t.transfer);
    }
  }

  private finish(w: Worker, res: WorkerResponse): void {
    const t = this.running.get(w);
    this.running.delete(w);
    this.idle.push(w);
    if (t) {
      if (res.ok) t.resolve(res.pages);
      else t.reject(new Error(res.error));
    }
    this.pump();
  }
}
