/** Options passed straight to the wasm core (`layout::Options`). */
export interface ConvertOptions {
  width: number;
  height: number;
  bits: 1 | 2;
  mode: 'auto' | 'split' | 'fit';
  rotate: 'cw' | 'ccw';
  stripOrder: 'ltr' | 'rtl';
  minOverlap: number;
  trim: boolean;
  dither: 'floyd-steinberg' | 'atkinson' | 'ordered' | 'none';
  gamma: number;
  black: number;
  white: number;
}

export const DEVICES = {
  x4: { label: 'Xteink X4', width: 480, height: 800 },
  x3: { label: 'Xteink X3', width: 528, height: 792 },
} as const;
export type DeviceId = keyof typeof DEVICES;

/** One source image handed to a worker. */
export type Job =
  | { kind: 'encoded'; bytes: ArrayBuffer }
  | { kind: 'rgba'; rgba: ArrayBuffer; width: number; height: number };

export interface WorkerRequest {
  id: number;
  job: Job;
  opts: ConvertOptions;
}

export type WorkerResponse =
  | { id: number; ok: true; pages: Uint8Array }
  | { id: number; ok: false; error: string };
