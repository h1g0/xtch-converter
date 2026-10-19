// UI strings. The page ships with English text in the HTML; elements carrying
// data-i18n* attributes are re-translated whenever the language changes.

const en = {
  'header.sub':
    'Converts PDFs and image ZIPs into <code>.xtch</code> / <code>.xtc</code> files for the Xteink X4 / X3. Everything runs in your browser; your files are never uploaded.',
  'settings.aria': 'Conversion settings',
  'settings.title': 'Settings',
  'device.legend': 'Device',
  'format.legend': 'Output format',
  'format.xtch': '4 grays',
  'format.xtc': 'Black & white',
  'layout.legend': 'Layout',
  'layout.auto': 'Auto (split images larger than the screen)',
  'layout.split': 'Always split',
  'layout.fit': 'Fit on one screen (no split)',
  'layout.hint':
    "When splitting, the image's short side is scaled to the screen's long side and cut into screen-sized pages. PDFs are always split in Auto mode.",
  'rotate.legend': 'Rotation of portrait images',
  'rotate.cw': 'Clockwise',
  'rotate.ccw': 'Counter-clockwise',
  'order.legend': 'Order of landscape pieces',
  'order.ltr': 'Left → right',
  'order.rtl': 'Right → left',
  'order.manga': 'Manga',
  'overlap.legend': 'Min overlap',
  'quality.legend': 'Quality',
  'quality.trim': 'Trim blank margins',
  'quality.dither': 'Dithering',
  'dither.ordered': 'Pattern (Bayer)',
  'dither.none': 'None (plain quantization)',
  'quality.gamma': 'Gamma',
  'quality.black': 'Black level',
  'quality.white': 'White level',
  'quality.reset': 'Reset quality settings',
  'drop.title': 'PDF / ZIP (CBZ) / image files',
  'drop.action': 'Drop here, or click to choose',
  'drop.hint': 'Multiple image files are combined into one book in name order',
  'action.convert': 'Convert',
  'action.reconvert': 'Convert again',
  'action.cancel': 'Cancel',
  'action.clear': 'Clear list',
  'note.title': 'If the device shows "Memory error"',
  'note.body':
    'Put the device to sleep, wake it, and open the file again. Right after uploading with the built-in file server, the device may be short of free memory, and even a valid file can fail to open.',
  'preview.title': 'Preview',
  'footer.author': 'About the author',
  'viewer.prev': 'Previous page',
  'viewer.next': 'Next page',
  'viewer.close': 'Close',
  'job.title': 'Title',
  'job.preview': 'Preview',
  'job.save': 'Save',
  'job.remove': 'Remove',
  'job.loading': 'Loading…',
  'job.cancelled': 'Cancelled',
  'job.error': 'Error: {msg}',
  'job.summary': '{pages} pages · {size} · {secs} s',
  'job.warnings': ' · {n} warnings',
  'job.stale': ' · settings changed (convert again to apply)',
  'files.more': '{first} and {n} more',
  'files.skipped': 'Skipped unsupported files: {names}',
  'preview.info': '{w}×{h} · {pages} pages',
  'preview.page': 'Page {n}',
  'error.noPages': 'No pages could be converted',
  'error.tooManyPages': 'Too many pages (max 65535): {n}',
  'error.zipNoImages': 'No images found in the ZIP',
} as const;

export type MessageKey = keyof typeof en;

const ja: Record<MessageKey, string> = {
  'header.sub':
    'PDF・画像ZIPを Xteink X4 / X3 用の <code>.xtch</code> / <code>.xtc</code> に変換します。処理はすべてブラウザ内で行われ、ファイルはどこにも送信されません。',
  'settings.aria': '変換設定',
  'settings.title': '設定',
  'device.legend': '端末',
  'format.legend': '出力形式',
  'format.xtch': '4階調',
  'format.xtc': '白黒2値',
  'layout.legend': 'レイアウト',
  'layout.auto': '自動（画面より大きい画像は分割）',
  'layout.split': '常に分割',
  'layout.fit': '分割せず1画面に収める',
  'layout.hint': '分割時は画像の短辺を画面の長辺に合わせて拡縮し、画面サイズごとに切り出します。PDFは「自動」で分割扱いです。',
  'rotate.legend': '縦長画像の回転方向',
  'rotate.cw': '時計回り',
  'rotate.ccw': '反時計回り',
  'order.legend': '横長画像の分割順',
  'order.ltr': '左 → 右',
  'order.rtl': '右 → 左',
  'order.manga': '漫画',
  'overlap.legend': '最小のりしろ',
  'quality.legend': '画質',
  'quality.trim': '余白を自動カット',
  'quality.dither': 'ディザリング',
  'dither.ordered': 'パターン (Bayer)',
  'dither.none': 'なし（単純量子化）',
  'quality.gamma': 'ガンマ',
  'quality.black': '黒レベル',
  'quality.white': '白レベル',
  'quality.reset': '画質設定をリセット',
  'drop.title': 'PDF / ZIP (CBZ) / 画像ファイル',
  'drop.action': 'ここにドロップ、またはクリックして選択',
  'drop.hint': '複数の画像ファイルは名前順に1冊にまとめます',
  'action.convert': '変換',
  'action.reconvert': '再変換',
  'action.cancel': '中止',
  'action.clear': 'リストを空にする',
  'note.title': '端末で「メモリエラー」と表示されたら',
  'note.body':
    '一度スリープさせてから解除し、もう一度ファイルを開いてください。内蔵のファイルサーバでアップロードした直後などは端末の空きメモリが不足し、正常なファイルでもエラーになることがあります。',
  'preview.title': 'プレビュー',
  'footer.author': '作者について',
  'viewer.prev': '前のページ',
  'viewer.next': '次のページ',
  'viewer.close': '閉じる',
  'job.title': 'タイトル',
  'job.preview': 'プレビュー',
  'job.save': '保存',
  'job.remove': '削除',
  'job.loading': '読み込み中…',
  'job.cancelled': '中止しました',
  'job.error': 'エラー: {msg}',
  'job.summary': '{pages} ページ · {size} · {secs} 秒',
  'job.warnings': ' · 警告 {n} 件',
  'job.stale': ' · 設定変更あり（再変換で反映）',
  'files.more': '{first} ほか {n} 枚',
  'files.skipped': '未対応の形式をスキップ: {names}',
  'preview.info': '{w}×{h} · {pages} ページ',
  'preview.page': '{n} ページ',
  'error.noPages': '変換できたページがありません',
  'error.tooManyPages': 'ページ数が上限(65535)を超えています: {n}',
  'error.zipNoImages': 'ZIP内に画像が見つかりません',
};

export const LANGS = { en, ja } as const;
export type Lang = keyof typeof LANGS;

const STORAGE_KEY = 'xtch-converter:lang';
const listeners: (() => void)[] = [];

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ja') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

let current: Lang = initialLang();

export const getLang = (): Lang => current;

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return LANGS[current][key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

/** Translate every element under `root` that carries a data-i18n* attribute. */
export function applyTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as MessageKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml as MessageKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey));
  });
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = lang;
  applyTranslations();
  listeners.forEach((fn) => fn());
}

export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}
