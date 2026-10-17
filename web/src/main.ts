import './style.css';
import init, { decodePage } from './wasm/xtch_core.js';
import { convertSource, type ConvertResult } from './convert';
import { WorkerPool } from './pool';
import { isArchive, isImage, isPdf, openArchive, openImages, openPdf, type Source } from './sources';
import { DEVICES, type ConvertOptions, type DeviceId } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('settings');
const fileInput = $<HTMLInputElement>('file');
const drop = $<HTMLLabelElement>('drop');
const convertBtn = $<HTMLButtonElement>('convert');
const cancelBtn = $<HTMLButtonElement>('cancel');
const clearBtn = $<HTMLButtonElement>('clear');
const statusEl = $<HTMLSpanElement>('status');
const jobsEl = $<HTMLUListElement>('jobs');
const previewEl = $<HTMLElement>('preview');
const thumbsEl = $<HTMLDivElement>('thumbs');
const viewer = $<HTMLDialogElement>('viewer');
const big = $<HTMLCanvasElement>('big');

const wasmReady = init();
const STORAGE_KEY = 'xtch-converter:settings';
const QUALITY_DEFAULTS = { trim: false, dither: 'floyd-steinberg', gamma: '1', black: '0', white: '255' };

// ---------- settings ----------

function readOptions(): ConvertOptions {
  const f = new FormData(form);
  const dev = DEVICES[(f.get('device') as DeviceId) ?? 'x4'];
  return {
    width: dev.width,
    height: dev.height,
    bits: f.get('bits') === '1' ? 1 : 2,
    mode: f.get('mode') as ConvertOptions['mode'],
    rotate: f.get('rotate') as ConvertOptions['rotate'],
    stripOrder: f.get('stripOrder') as ConvertOptions['stripOrder'],
    minOverlap: Number(f.get('minOverlap')),
    trim: f.get('trim') === 'on',
    dither: f.get('dither') as ConvertOptions['dither'],
    gamma: Number(f.get('gamma')),
    black: Number(f.get('black')),
    white: Number(f.get('white')),
  };
}

function setField(name: string, value: string | boolean) {
  const els = form.elements.namedItem(name);
  if (!els) return;
  if (els instanceof RadioNodeList) {
    els.forEach((el) => ((el as HTMLInputElement).checked = (el as HTMLInputElement).value === value));
  } else if (els instanceof HTMLInputElement && els.type === 'checkbox') {
    els.checked = Boolean(value);
  } else {
    (els as HTMLInputElement | HTMLSelectElement).value = String(value);
  }
}

function syncSettingsUi() {
  const o = readOptions();
  const out = (n: string, v: string) => ((form.elements.namedItem(n) as HTMLOutputElement).value = v);
  out('gammaOut', o.gamma.toFixed(2));
  out('blackOut', String(o.black));
  out('whiteOut', String(o.white));
  out('minOverlapOut', `${o.minOverlap}px`);
  form.querySelectorAll<HTMLElement>('.split-only').forEach((el) => el.classList.toggle('dim', o.mode === 'fit'));
  try {
    const raw: Record<string, string | boolean> = {};
    new FormData(form).forEach((v, k) => (raw[k] = String(v)));
    raw.trim = o.trim;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {
    /* storage unavailable */
  }
  for (const j of jobs) renderJob(j);
}

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved) {
      setField('trim', false);
      for (const [k, v] of Object.entries(saved)) setField(k, v as string | boolean);
    }
  } catch {
    /* ignore */
  }
}

form.addEventListener('input', syncSettingsUi);
form.addEventListener('change', syncSettingsUi);
$('reset').addEventListener('click', () => {
  for (const [k, v] of Object.entries(QUALITY_DEFAULTS)) setField(k, v);
  syncSettingsUi();
});

// ---------- jobs ----------

interface Job {
  id: number;
  files: File[];
  label: string;
  title: string;
  state: 'pending' | 'running' | 'done' | 'error';
  progress: [number, number];
  message: string;
  result?: ConvertResult;
  url?: string;
  optsKey?: string;
  el: HTMLLIElement;
}

const jobs: Job[] = [];
let nextJobId = 1;
let selected: Job | null = null;
let running: AbortController | null = null;
let pool: WorkerPool | null = null;

const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');

function addFiles(list: FileList | File[]) {
  const files = [...list];
  const images = files.filter((f) => isImage(f.name));
  const rejected: string[] = [];
  for (const f of files) {
    if (isPdf(f.name) || isArchive(f.name)) addJob([f], f.name);
    else if (!isImage(f.name)) rejected.push(f.name);
  }
  if (images.length) {
    const label = images.length === 1 ? images[0].name : `${images[0].name} ほか ${images.length - 1} 枚`;
    addJob(images, label);
  }
  statusEl.textContent = rejected.length ? `未対応の形式をスキップ: ${rejected.join(', ')}` : '';
  updateButtons();
}

function addJob(files: File[], label: string) {
  const el = document.createElement('li');
  el.className = 'job';
  const job: Job = {
    id: nextJobId++,
    files,
    label,
    title: stripExt(files[0].name),
    state: 'pending',
    progress: [0, 0],
    message: '',
    el,
  };
  el.innerHTML = `
    <div class="job-main">
      <input class="title" type="text" aria-label="タイトル" />
      <div class="job-sub"><span class="name"></span> <span class="msg"></span></div>
      <progress max="1" value="0"></progress>
    </div>
    <div class="job-actions">
      <button class="show ghost">プレビュー</button>
      <a class="dl button primary" download>保存</a>
      <button class="remove ghost" aria-label="削除">×</button>
    </div>`;
  const titleInput = el.querySelector<HTMLInputElement>('.title')!;
  titleInput.value = job.title;
  titleInput.addEventListener('input', () => {
    job.title = titleInput.value;
    job.optsKey = undefined; // title is stored in the file
    renderJob(job);
  });
  el.querySelector('.name')!.textContent = label;
  el.querySelector('.show')!.addEventListener('click', () => showPreview(job));
  el.querySelector('.remove')!.addEventListener('click', () => removeJob(job));
  jobs.push(job);
  jobsEl.append(el);
  renderJob(job);
}

function removeJob(job: Job) {
  if (job.state === 'running') return;
  if (job.url) URL.revokeObjectURL(job.url);
  job.el.remove();
  jobs.splice(jobs.indexOf(job), 1);
  if (selected === job) hidePreview();
  updateButtons();
}

const optsKeyFor = (job: Job) => JSON.stringify([readOptions(), job.title]);
const isStale = (job: Job) => job.state === 'done' && job.optsKey !== optsKeyFor(job);

function renderJob(job: Job) {
  const { el, result } = job;
  el.dataset.state = job.state;
  const bar = el.querySelector('progress')!;
  const [d, t] = job.progress;
  bar.max = t || 1;
  bar.value = job.state === 'done' ? bar.max : d;
  bar.hidden = job.state !== 'running';
  let msg = job.message;
  if (job.state === 'done' && result) {
    msg = `${result.pages.length} ページ · ${formatBytes(result.blob.size)} · ${(result.millis / 1000).toFixed(1)} 秒`;
    if (result.warnings.length) msg += ` · 警告 ${result.warnings.length} 件`;
    if (isStale(job)) msg += ' · 設定変更あり（再変換で反映）';
  }
  el.querySelector('.msg')!.textContent = msg;
  el.querySelector<HTMLElement>('.msg')!.title = result?.warnings.join('\n') ?? '';
  const dl = el.querySelector<HTMLAnchorElement>('.dl')!;
  dl.hidden = !job.url;
  if (job.url && result) {
    dl.href = job.url;
    dl.download = result.fileName;
  }
  el.querySelector<HTMLButtonElement>('.show')!.hidden = !result;
  el.querySelector<HTMLButtonElement>('.remove')!.disabled = job.state === 'running';
  el.querySelector<HTMLInputElement>('.title')!.disabled = job.state === 'running';
  updateButtons();
}

function updateButtons() {
  const todo = jobs.filter((j) => j.state !== 'done' || isStale(j));
  convertBtn.disabled = !!running || !todo.length;
  convertBtn.textContent = jobs.some((j) => j.state === 'done') && todo.length ? '再変換' : '変換';
  clearBtn.disabled = !!running || !jobs.length;
  cancelBtn.hidden = !running;
}

async function openSource(job: Job): Promise<Source> {
  const f = job.files[0];
  if (isPdf(f.name)) return openPdf(f);
  if (isArchive(f.name)) return openArchive(f);
  return openImages(job.files);
}

async function convertAll() {
  await wasmReady;
  const ctrl = new AbortController();
  running = ctrl;
  pool ??= new WorkerPool();
  updateButtons();
  const queue = jobs.filter((j) => j.state !== 'done' || isStale(j));
  try {
    for (const job of queue) {
      if (ctrl.signal.aborted) break;
      await convertJob(job, ctrl.signal);
    }
  } finally {
    running = null;
    updateButtons();
  }
}

async function convertJob(job: Job, signal: AbortSignal) {
  const opts = readOptions();
  const key = optsKeyFor(job);
  job.state = 'running';
  job.message = '読み込み中…';
  job.progress = [0, 0];
  renderJob(job);
  let src: Source | null = null;
  try {
    src = await openSource(job);
    job.message = '';
    const result = await convertSource(src, opts, pool!, {
      title: job.title,
      signal,
      onProgress: (d, t) => {
        job.progress = [d, t];
        job.message = `${d} / ${t}`;
        renderJob(job);
      },
    });
    if (job.url) URL.revokeObjectURL(job.url);
    job.result = result;
    job.url = URL.createObjectURL(result.blob);
    job.optsKey = key;
    job.state = 'done';
    job.message = '';
    if (!selected || selected === job) showPreview(job);
  } catch (e) {
    job.state = (e as Error).name === 'AbortError' ? 'pending' : 'error';
    job.message = job.state === 'error' ? `エラー: ${(e as Error).message}` : '中止しました';
    console.error(e);
  } finally {
    src?.dispose();
    renderJob(job);
  }
}

convertBtn.addEventListener('click', () => void convertAll());
cancelBtn.addEventListener('click', () => {
  running?.abort();
  // Workers may be mid-page; recreate them rather than wait.
  pool?.terminate();
  pool = null;
});
clearBtn.addEventListener('click', () => {
  [...jobs].forEach(removeJob);
  hidePreview();
});

// ---------- input ----------

fileInput.addEventListener('change', () => {
  if (fileInput.files) addFiles(fileInput.files);
  fileInput.value = '';
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
for (const ev of ['dragenter', 'dragover'] as const) {
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const ev of ['dragleave', 'drop'] as const) {
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragleave' && (e as DragEvent).relatedTarget) return;
    drop.classList.remove('over');
  });
}
window.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
});

// ---------- preview ----------

const THUMB_W = 150;
let thumbObserver: IntersectionObserver | null = null;
let viewerIndex = 0;

function pageToImageData(page: Uint8Array): ImageData {
  const d = decodePage(page, 0);
  const img = new ImageData(new Uint8ClampedArray(d.rgba), d.width, d.height);
  d.free();
  return img;
}

function hidePreview() {
  selected = null;
  previewEl.hidden = true;
  thumbObserver?.disconnect();
  thumbsEl.replaceChildren();
  jobs.forEach((j) => j.el.classList.remove('selected'));
}

function showPreview(job: Job) {
  const res = job.result;
  if (!res) return;
  selected = job;
  jobs.forEach((j) => j.el.classList.toggle('selected', j === job));
  previewEl.hidden = false;
  $('previewTitle').textContent = res.fileName;
  const first = res.pages[0];
  const v = new DataView(first.buffer, first.byteOffset);
  $('previewInfo').textContent = `${v.getUint16(4, true)}×${v.getUint16(6, true)} · ${res.pages.length} ページ`;

  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const c = e.target as HTMLCanvasElement;
        thumbObserver!.unobserve(c);
        void drawThumb(c, res.pages[Number(c.dataset.i)]);
      }
    },
    { rootMargin: '400px' },
  );
  const frag = document.createDocumentFragment();
  res.pages.forEach((p, i) => {
    const v = new DataView(p.buffer, p.byteOffset);
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = THUMB_W;
    c.height = Math.round((THUMB_W * v.getUint16(6, true)) / v.getUint16(4, true));
    c.dataset.i = String(i);
    c.title = `${i + 1} ページ`;
    c.addEventListener('click', () => openViewer(i));
    const cap = document.createElement('figcaption');
    cap.textContent = String(i + 1);
    fig.append(c, cap);
    frag.append(fig);
    thumbObserver!.observe(c);
  });
  thumbsEl.replaceChildren(frag);
}

async function drawThumb(c: HTMLCanvasElement, page: Uint8Array) {
  const bmp = await createImageBitmap(pageToImageData(page));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
}

function openViewer(i: number) {
  const pages = selected?.result?.pages;
  if (!pages?.length) return;
  viewerIndex = Math.max(0, Math.min(pages.length - 1, i));
  const img = pageToImageData(pages[viewerIndex]);
  big.width = img.width;
  big.height = img.height;
  big.getContext('2d')!.putImageData(img, 0, 0);
  $('viewerInfo').textContent = `${viewerIndex + 1} / ${pages.length}`;
  if (!viewer.open) viewer.showModal();
}

$('prev').addEventListener('click', () => openViewer(viewerIndex - 1));
$('next').addEventListener('click', () => openViewer(viewerIndex + 1));
$('close').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', (e) => e.target === viewer && viewer.close());
viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') openViewer(viewerIndex - 1);
  if (e.key === 'ArrowRight') openViewer(viewerIndex + 1);
});

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

restoreSettings();
syncSettingsUi();
