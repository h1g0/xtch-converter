// Validate and summarize an .xtc / .xtch file.
//   node scripts/inspect-xtc.mjs book.xtch [--dump outdir]
// --dump writes every page as a PGM image for visual checks.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , file, flag, dumpDir] = process.argv;
if (!file) {
  console.error('usage: node scripts/inspect-xtc.mjs <file> [--dump <dir>]');
  process.exit(1);
}
const buf = readFileSync(file);
const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const u64 = (o) => Number(v.getBigUint64(o, true));
const cstr = (o, n) => {
  const s = buf.subarray(o, o + n);
  const end = s.indexOf(0);
  return new TextDecoder().decode(end < 0 ? s : s.subarray(0, end));
};
const fail = (msg) => {
  console.error('INVALID:', msg);
  process.exit(2);
};

const magic = buf.subarray(0, 4).toString('latin1');
if (magic !== 'XTC\0' && magic !== 'XTCH') fail(`bad magic ${JSON.stringify(magic)}`);
const bits = magic === 'XTCH' ? 2 : 1;
const pageCount = v.getUint16(6, true);
const h = {
  magic: magic.replace('\0', ''),
  version: `${buf[4]}.${buf[5]}`,
  pageCount,
  readDirection: buf[8],
  hasMetadata: buf[9],
  hasThumbnails: buf[10],
  hasChapters: buf[11],
  currentPage: v.getUint32(12, true),
  metadataOffset: u64(16),
  pageTableOffset: u64(24),
  dataOffset: u64(32),
  thumbOffset: u64(40),
  chapterOffset: u64(48),
};
console.log(h);
if (h.pageTableOffset + pageCount * 16 > buf.length) fail('page table out of bounds');

if (h.hasMetadata) {
  const m = h.metadataOffset;
  console.log({
    title: cstr(m, 128),
    author: cstr(m + 128, 64),
    created: new Date(v.getUint32(m + 240, true) * 1000).toISOString(),
    chapterCount: v.getUint16(m + 246, true),
  });
}
if (h.hasChapters && h.chapterOffset) {
  for (let o = h.chapterOffset; o + 96 <= h.pageTableOffset; o += 96) {
    console.log('chapter', JSON.stringify(cstr(o, 80)), 'pages', v.getUint16(o + 80, true), '-', v.getUint16(o + 82, true), '(1-based)');
  }
}

const sizes = new Map();
let expectedOffset = h.dataOffset;
for (let i = 0; i < pageCount; i++) {
  const e = h.pageTableOffset + i * 16;
  const off = u64(e);
  const size = v.getUint32(e + 8, true);
  const w = v.getUint16(e + 12, true);
  const ht = v.getUint16(e + 14, true);
  if (off !== expectedOffset) fail(`page ${i}: offset ${off} != ${expectedOffset}`);
  if (off + size > buf.length) fail(`page ${i}: out of bounds`);
  const pm = buf.subarray(off, off + 4).toString('latin1');
  if (pm !== (bits === 2 ? 'XTH\0' : 'XTG\0')) fail(`page ${i}: bad page magic`);
  if (v.getUint16(off + 4, true) !== w || v.getUint16(off + 6, true) !== ht) fail(`page ${i}: size mismatch`);
  const data = v.getUint32(off + 10, true);
  const expect = bits === 2 ? w * Math.ceil(ht / 8) * 2 : Math.ceil(w / 8) * ht;
  if (data !== expect || size !== data + 22) fail(`page ${i}: data size ${data}, expected ${expect}`);
  sizes.set(`${w}x${ht}`, (sizes.get(`${w}x${ht}`) ?? 0) + 1);
  expectedOffset = off + size;

  if (flag === '--dump' && dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    const px = Buffer.alloc(w * ht);
    const d = buf.subarray(off + 22, off + size);
    for (let y = 0; y < ht; y++) {
      for (let x = 0; x < w; x++) {
        if (bits === 1) {
          px[y * w + x] = d[y * Math.ceil(w / 8) + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0;
        } else {
          const cb = Math.ceil(ht / 8);
          const idx = (w - 1 - x) * cb + (y >> 3);
          const s = 7 - (y & 7);
          const val = (((d[idx] >> s) & 1) << 1) | ((d[idx + w * cb] >> s) & 1);
          px[y * w + x] = [255, 85, 170, 0][val];
        }
      }
    }
    writeFileSync(join(dumpDir, `page-${String(i + 1).padStart(4, '0')}.pgm`), Buffer.concat([Buffer.from(`P5\n${w} ${ht}\n255\n`), px]));
  }
}
if (expectedOffset !== buf.length) fail(`trailing bytes: ${buf.length - expectedOffset}`);
console.log('pages by size:', Object.fromEntries(sizes));
console.log('OK');
