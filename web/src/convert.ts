import { t } from './i18n';
import { buildContainerPrefix } from './wasm/xtch_core.js';
import type { WorkerPool } from './pool';
import type { Source } from './sources';
import type { ConvertOptions } from './types';

const PAGE_HEADER = 22;

export interface ConvertResult {
  blob: Blob;
  fileName: string;
  /** Each encoded XTG/XTH page, in output order. */
  pages: Uint8Array[];
  warnings: string[];
  millis: number;
}

export interface ConvertParams {
  title: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Split a buffer of back-to-back XTG/XTH pages. */
function splitPages(buf: Uint8Array): Uint8Array[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Uint8Array[] = [];
  for (let pos = 0; pos + PAGE_HEADER <= buf.length; ) {
    const len = PAGE_HEADER + view.getUint32(pos + 10, true);
    out.push(buf.subarray(pos, pos + len));
    pos += len;
  }
  return out;
}

export async function convertSource(
  src: Source,
  baseOpts: ConvertOptions,
  pool: WorkerPool,
  { title, onProgress, signal }: ConvertParams,
): Promise<ConvertResult> {
  const t0 = performance.now();
  // A PDF page is vector data, i.e. "large" at any size: auto means split.
  const opts: ConvertOptions =
    src.kind === 'pdf' && baseOpts.mode === 'auto' ? { ...baseOpts, mode: 'split' } : baseOpts;

  const n = src.items.length;
  const results: (Uint8Array | null)[] = new Array(n).fill(null);
  const warnings: string[] = [];
  const inflight = new Set<Promise<void>>();
  const maxInflight = pool.size * 2;
  let done = 0;
  onProgress?.(0, n);

  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const item = src.items[i];
    let job;
    try {
      job = await item.load(opts);
    } catch (e) {
      warnings.push(`${item.label}: ${(e as Error).message}`);
      onProgress?.(++done, n);
      continue;
    }
    const p: Promise<void> = pool
      .run(job, opts)
      .then(
        (pages) => void (results[i] = pages),
        (e: Error) => void warnings.push(`${item.label}: ${e.message}`),
      )
      .finally(() => {
        inflight.delete(p);
        onProgress?.(++done, n);
      });
    inflight.add(p);
    if (inflight.size >= maxInflight) await Promise.race(inflight);
  }
  await Promise.all(inflight);
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');

  const pages: Uint8Array[] = [];
  const firstPage: number[] = [];
  for (const r of results) {
    firstPage.push(pages.length);
    if (r) pages.push(...splitPages(r));
  }
  if (!pages.length) throw new Error(t('error.noPages'));
  if (pages.length > 0xffff) throw new Error(t('error.tooManyPages', { n: pages.length }));

  const chapters = src.chapters
    .map((c) => ({ name: c.title, start: firstPage[c.item] }))
    .filter((c) => c.start < pages.length)
    .map((c, i, all) => ({ ...c, end: (all[i + 1]?.start ?? pages.length) - 1 }))
    .filter((c) => c.end >= c.start);

  const headers = new Uint8Array(pages.length * PAGE_HEADER);
  pages.forEach((p, i) => headers.set(p.subarray(0, PAGE_HEADER), i * PAGE_HEADER));
  const prefix = buildContainerPrefix(headers, {
    title,
    author: '',
    created: Math.floor(Date.now() / 1000),
    readDirection: 0,
    chapters,
  });

  const ext = opts.bits === 2 ? 'xtch' : 'xtc';
  const blob = new Blob([prefix as Uint8Array<ArrayBuffer>, ...(results.filter(Boolean) as Uint8Array<ArrayBuffer>[])], {
    type: 'application/octet-stream',
  });
  const safe = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'book';
  return { blob, fileName: `${safe}.${ext}`, pages, warnings, millis: performance.now() - t0 };
}
