// Copies pdf.js runtime assets (CJK cMaps, standard fonts, image-decoder wasm,
// ICC profiles) into web/public so they are served next to the app.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dst = join(root, 'web', 'public', 'pdfjs');

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir);
  if (!existsSync(from)) continue;
  mkdirSync(join(dst, dir), { recursive: true });
  cpSync(from, join(dst, dir), { recursive: true });
}
console.log('pdf.js assets copied to', dst);
