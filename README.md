# XTCH Converter

English | [日本語](README.ja.md)

A browser app that converts PDFs and image ZIPs (CBZ) into `.xtch` (4-level grayscale) or `.xtc` (black and white) files for the Xteink X4 / X3.
Image processing and encoding run in Rust compiled to WebAssembly, spread across Web Workers (one per CPU core). Files never leave your browser.

## Usage

```bash
npm install
npm run build:wasm
npm run dev
```

Open http://localhost:5173, drop your files, and press "Convert".

`npm run build` writes a static site to `dist/`. It uses relative paths, so it can be served from any static host (GitHub Pages, etc.) or a local static server (`npm run preview`, `npx serve dist`, …). Opening it directly via `file://` does not work, because Web Workers and wasm need to be served over HTTP.

### Requirements

- Node.js 20.19 or later
- Rust with the `wasm32-unknown-unknown` target, and `wasm-pack` (the generated wasm is not checked in, so it must be built once)

## Input

| Format | Handling |
|---|---|
| PDF | Pages are rendered with pdf.js. The outline (bookmarks) becomes chapters |
| ZIP / CBZ | Images are sorted in natural order (`2.jpg` < `10.jpg`). If images span several folders, each folder becomes a chapter |
| Image files (one or more) | Sorted by name and combined into one book |

## Layout

- **Auto**: images larger than the screen (X4: 480×800 / X3: 528×792) are split; images that fit are placed on a single screen. PDFs are vector data, so they are always split
- **Split**: the image's short side is scaled to the screen's long side (800 / 792 px), then the image is cut into screen-width pieces
  - Portrait images are rotated 90° and cut into bands from top to bottom (the rotation direction is configurable)
  - Landscape images (e.g. two-page spreads) are not rotated and are cut left → right or right → left (manga)
  - Cut positions are spread evenly so the last page does not end in blank space. "Min overlap" sets a lower bound on how much neighbouring pieces overlap
- **Fit to one screen**: scale down without splitting

Quality options: automatic margin trimming, dithering (Floyd–Steinberg / Atkinson / Bayer / none), gamma, black level and white level.

## If the device shows "Memory error"

Put the device to sleep, wake it, and open the file again.

The firmware loads each page into one contiguous block of memory (about 104 KB for X3 XTCH, 96 KB for X4 XTCH). Right after using the built-in file server (Wi‑Fi) to upload, that block may not be available, and even a valid file fails to open. Sleeping and waking the device frees the memory. Confirmed on an X3 running CrossPoint Reader.

## Project layout

```
core/                 Rust (wasm-bindgen)
  src/format.rs       XTG/XTH encoding and the XTC/XTCH container
  src/image.rs        grayscale conversion, Lanczos3 resize, rotation, margin detection
  src/dither.rs       tone adjustment and quantization to 2/4 levels
  src/layout.rs       split / rotate / fit decisions and the pipeline
web/                  frontend (Vite + TypeScript)
  src/sources.ts      reading PDF / ZIP / image inputs
  src/worker.ts       image decoding and wasm conversion (Worker)
  src/pool.ts         worker pool
  src/convert.ts      parallel conversion and container assembly
  src/i18n.ts         UI strings (English / Japanese)
  src/main.ts         UI
scripts/inspect-xtc.mjs   validate an output file and dump pages as PGM
```

After changing the Rust code, run `npm run build:wasm`. Run the tests with `npm test` (`cargo test`).

Validating an output file:

```bash
node scripts/inspect-xtc.mjs book.xtch --dump out/
```

## Format notes

- Follows [CrazyCoder's format notes](https://gist.github.com/CrazyCoder/b125f26d6987c0620058249f59f1327d) and the parser in [CrossPoint Reader](https://github.com/crosspoint-reader/crosspoint-reader) (`lib/Xtc`)
- The header is 56 bytes (version 1.0, chapter offset at `0x30`). Metadata starts at `0x38` and holds the title (128 B) and creation time
- XTH stores two bit planes in column-major order (rightmost column first), 8 vertical pixels per byte. Values map 0 = white, 1 = dark gray, 2 = light gray, 3 = black
- Chapter page numbers are written 1-based (matching CrossPoint)

## License

[MIT](LICENSE)
