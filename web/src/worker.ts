/// <reference lib="webworker" />
// Decodes one source image (if needed) and runs the wasm pipeline on it.
import init, { convertImage } from './wasm/xtch_core.js';
import type { WorkerRequest, WorkerResponse } from './types';

const ready = init();

async function decode(bytes: ArrayBuffer): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  // createImageBitmap applies EXIF orientation and handles JPEG/PNG/WebP/AVIF/GIF/BMP.
  const bmp = await createImageBitmap(new Blob([bytes]));
  const { width, height } = bmp;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, job, opts } = e.data;
  let res: WorkerResponse;
  try {
    await ready;
    const img =
      job.kind === 'encoded'
        ? await decode(job.bytes)
        : { rgba: new Uint8Array(job.rgba), width: job.width, height: job.height };
    const pages = convertImage(img.rgba as Uint8Array, img.width, img.height, opts);
    res = { id, ok: true, pages };
    (self as DedicatedWorkerGlobalScope).postMessage(res, [pages.buffer]);
    return;
  } catch (err) {
    res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as DedicatedWorkerGlobalScope).postMessage(res);
};
