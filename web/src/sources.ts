// Turns user-provided files into ordered lists of source images.
import { unzip, type Unzipped } from 'fflate';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ConvertOptions, Job } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDFJS_ASSETS = new URL('pdfjs/', document.baseURI).href;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const ARCHIVE_EXT = /\.(zip|cbz)$/i;
const MAX_RENDER_PIXELS = 50_000_000;

export interface SourceItem {
  label: string;
  load(opts: ConvertOptions): Promise<Job>;
}

export interface Source {
  name: string;
  title: string;
  kind: 'pdf' | 'archive' | 'images';
  items: SourceItem[];
  /** Chapter starts, as indices into `items`. */
  chapters: { title: string; item: number }[];
  dispose(): void;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const isImage = (name: string) => IMAGE_EXT.test(name);
export const isArchive = (name: string) => ARCHIVE_EXT.test(name);
export const isPdf = (name: string) => /\.pdf$/i.test(name);

const stripExt = (name: string) => name.replace(/\.[^.\/]+$/, '');

/** Own, transferable copy of a byte range. */
function ownBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.slice().buffer as ArrayBuffer;
}

export async function openPdf(file: File): Promise<Source> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: PDFJS_ASSETS + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: PDFJS_ASSETS + 'standard_fonts/',
    wasmUrl: PDFJS_ASSETS + 'wasm/',
    iccUrl: PDFJS_ASSETS + 'iccs/',
  });
  const pdf = await task.promise;

  const meta = await pdf.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const items: SourceItem[] = Array.from({ length: pdf.numPages }, (_, i) => ({
    label: `p.${i + 1}`,
    async load(opts: ConvertOptions): Promise<Job> {
      const page = await pdf.getPage(i + 1);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = renderScale(base.width, base.height, opts);
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        canvas.width = width;
        canvas.height = height;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const img = ctx.getImageData(0, 0, width, height);
        return { kind: 'rgba', rgba: img.data.buffer as ArrayBuffer, width, height };
      } finally {
        page.cleanup();
      }
    },
  }));

  return {
    name: file.name,
    title: info.Title?.trim() || stripExt(file.name),
    kind: 'pdf',
    items,
    chapters: await pdfChapters(pdf),
    dispose: () => void task.destroy(),
  };
}

/**
 * Scale at which to rasterize a PDF page so the wasm core needs no (or
 * minimal) resampling: the short side lands exactly on the screen's long
 * side when splitting, or the page fits the screen in fit mode.
 */
function renderScale(w: number, h: number, o: ConvertOptions): number {
  let s = o.mode === 'fit' ? Math.min(o.width / w, o.height / h) : o.height / Math.min(w, h);
  // Margin trimming enlarges the remaining content, so render with headroom.
  if (o.trim) s *= 1.5;
  const maxS = Math.sqrt(MAX_RENDER_PIXELS / (w * h));
  return Math.min(s, maxS);
}

async function pdfChapters(pdf: PDFDocumentProxy): Promise<Source['chapters']> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline) return [];
  const out: Source['chapters'] = [];
  type Node = (typeof outline)[number];
  const walk = async (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      try {
        const dest = typeof n.dest === 'string' ? await pdf.getDestination(n.dest) : n.dest;
        const ref = dest?.[0];
        const index =
          ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) : Number.isInteger(ref) ? (ref as number) : -1;
        if (index >= 0) out.push({ title: '　'.repeat(depth) + n.title, item: index });
      } catch {
        // Unresolvable destination: skip the entry.
      }
      if (n.items?.length && depth < 2) await walk(n.items as Node[], depth + 1);
    }
  };
  await walk(outline, 0);
  return out;
}

export async function openArchive(file: File): Promise<Source> {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Unzipped>((resolve, reject) =>
    unzip(
      data,
      {
        filter: (f) => isImage(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) && f.originalSize > 0,
      },
      (err, res) => (err ? reject(err) : resolve(res)),
    ),
  );
  const names = Object.keys(entries).sort(collator.compare);
  if (!names.length) throw new Error('ZIP内に画像が見つかりません');

  const items = names.map((name) => ({
    label: name,
    load: async (): Promise<Job> => ({ kind: 'encoded', bytes: ownBuffer(entries[name]) }),
  }));

  return {
    name: file.name,
    title: stripExt(file.name),
    kind: 'archive',
    items,
    chapters: folderChapters(names),
    dispose: () => {
      for (const k of names) delete entries[k];
    },
  };
}

/** One chapter per directory, when images are spread over several. */
function folderChapters(names: string[]): Source['chapters'] {
  const dir = (n: string) => n.slice(0, n.lastIndexOf('/') + 1);
  const dirs = new Set(names.map(dir));
  if (dirs.size < 2) return [];
  const out: Source['chapters'] = [];
  names.forEach((n, i) => {
    if (i === 0 || dir(n) !== dir(names[i - 1])) {
      const parts = dir(n).split('/').filter(Boolean);
      out.push({ title: parts[parts.length - 1] ?? '', item: i });
    }
  });
  return out;
}

export function openImages(files: File[]): Source {
  const sorted = [...files].sort((a, b) => collator.compare(a.name, b.name));
  return {
    name: sorted[0].name,
    title: stripExt(sorted[0].name),
    kind: 'images',
    items: sorted.map((f) => ({
      label: f.name,
      load: async (): Promise<Job> => ({ kind: 'encoded', bytes: await f.arrayBuffer() }),
    })),
    chapters: [],
    dispose: () => {},
  };
}
