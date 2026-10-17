# XTCH Converter

PDF や画像 ZIP（CBZ）を、Xteink X4 / X3 用の `.xtch`（4階調）または `.xtc`（2値）に変換するブラウザアプリです。
画像処理とエンコードは Rust → WebAssembly で行い、CPU コア数に応じた Web Worker で並列に処理します。ファイルは外部に送信されません。

## 使い方

```bash
npm install
npm run build:wasm
npm run dev
```

ブラウザで http://localhost:5173 を開き、ファイルをドロップして「変換」を押します。

配布用の静的ファイルは `npm run build` で `dist/` に出力されます。相対パスで出力されるので、任意の静的ホスティング（GitHub Pages など）やローカルの静的サーバ（`npm run preview`、`npx serve dist` など）で動きます。Web Worker と wasm を使うため、`file://` で直接開いても動きません。

### 必要なもの

- Node.js 20.19 以上
- Rust と `wasm32-unknown-unknown` ターゲット、`wasm-pack`（生成された wasm はリポジトリに含めていないため、初回にビルドが必要です）

## 入力

| 形式 | 扱い |
|---|---|
| PDF | pdf.js でページをレンダリングします。しおりは章として引き継ぎます |
| ZIP / CBZ | 中の画像を自然順（`2.jpg` < `10.jpg`）で並べます。フォルダが複数ある場合はフォルダごとに章を作ります |
| 画像ファイル（複数可） | 名前順に並べて 1 冊にまとめます |

## レイアウト

- **自動**: 画面（X4: 480×800 / X3: 528×792）より大きい画像は分割し、収まる画像はそのまま 1 画面に収めます。PDF はベクターなので常に分割扱いです
- **分割**: 画像の短辺を画面の長辺（800 / 792px）に合わせて拡縮し、画面の短辺幅で切り出します
  - 縦長の画像は 90° 回転し、上から順に帯状に切り出します（回転方向は設定で変更できます）
  - 横長の画像（見開きなど）は回転せず、左→右または右→左（漫画）の順に切り出します
  - 切り出し位置は均等に配置され、最後のページが余白で終わらないようにしています。「最小のりしろ」で重なり幅の下限を指定できます
- **1画面に収める**: 分割せずに縮小します

画質の設定として、余白の自動カット、ディザリング（Floyd–Steinberg / Atkinson / Bayer / なし）、ガンマ、黒レベル、白レベルを選べます。

## 構成

```
core/                 Rust（wasm-bindgen）
  src/format.rs       XTG/XTH エンコードと XTC/XTCH コンテナ
  src/image.rs        グレースケール化、Lanczos3 リサイズ、回転、余白検出
  src/dither.rs       階調補正と 2/4 階調への量子化
  src/layout.rs       分割・回転・フィットの判定とパイプライン
web/                  フロントエンド（Vite + TypeScript）
  src/sources.ts      PDF / ZIP / 画像の読み込み
  src/worker.ts       画像デコードと wasm 変換（Worker）
  src/pool.ts         Worker プール
  src/convert.ts      並列変換とコンテナの組み立て
  src/main.ts         UI
scripts/inspect-xtc.mjs   出力ファイルの検証・PGM 書き出し
```

wasm を変更した場合は `npm run build:wasm` を実行してください。テストは `npm test`（`cargo test`）で実行します。

出力ファイルの検証:

```bash
node scripts/inspect-xtc.mjs book.xtch --dump out/
```

## フォーマットのメモ

- [CrazyCoder 氏の仕様メモ](https://gist.github.com/CrazyCoder/b125f26d6987c0620058249f59f1327d) と [CrossPoint Reader](https://github.com/crosspoint-reader/crosspoint-reader) のパーサ（`lib/Xtc`）に合わせています
- ヘッダは 56 バイト（バージョン 1.0、`0x30` に章オフセット）。メタデータは `0x38` に置き、タイトル（128B）と作成日時を書き込みます
- XTH は 2 枚のビットプレーンを列優先（右の列から）、1 バイトに縦 8 ピクセルで格納します。値の対応は 0=白、1=濃いグレー、2=薄いグレー、3=黒です
- 章のページ番号は 1 始まりで書き込みます（CrossPoint の実装に合わせています）
