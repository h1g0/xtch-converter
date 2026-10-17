//! Converter core for Xteink e-paper readers, exposed to JavaScript via wasm-bindgen.

pub mod dither;
pub mod format;
pub mod image;
pub mod layout;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Convert one RGBA image into encoded XTG/XTH pages, concatenated.
/// `options` is a plain object matching `layout::Options` (camelCase).
#[wasm_bindgen(js_name = convertImage)]
pub fn convert_image(rgba: &[u8], width: u32, height: u32, options: JsValue) -> Result<Vec<u8>, JsError> {
    let opts: layout::Options = serde_wasm_bindgen::from_value(options)?;
    layout::convert(rgba, width as usize, height as usize, &opts).map_err(|e| JsError::new(&e))
}

#[derive(Deserialize)]
struct JsChapter {
    name: String,
    start: u16,
    end: u16,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct JsBookMeta {
    title: String,
    author: String,
    created: u32,
    read_direction: u8,
    chapters: Vec<JsChapter>,
}

/// Container bytes preceding the page data. `headers` holds the 22-byte
/// header of every page, back to back, in output order; the full file is the
/// returned prefix followed by all pages in the same order.
#[wasm_bindgen(js_name = buildContainerPrefix)]
pub fn build_container_prefix(headers: &[u8], meta: JsValue) -> Result<Vec<u8>, JsError> {
    let infos = headers
        .chunks(format::PAGE_HEADER_SIZE)
        .map(format::parse_header_only)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| JsError::new(&e))?;
    let m: JsBookMeta = if meta.is_undefined() || meta.is_null() {
        JsBookMeta::default()
    } else {
        serde_wasm_bindgen::from_value(meta)?
    };
    let meta = format::BookMeta {
        title: m.title,
        author: m.author,
        created: m.created,
        read_direction: m.read_direction,
        chapters: m
            .chapters
            .into_iter()
            .map(|c| format::Chapter { name: c.name, start: c.start, end: c.end })
            .collect(),
    };
    format::build_prefix(&infos, &meta).map_err(|e| JsError::new(&e))
}

/// Number of pages in a buffer of concatenated XTG/XTH pages.
#[wasm_bindgen(js_name = countPages)]
pub fn count_pages(pages: &[u8]) -> Result<u32, JsError> {
    Ok(format::split_pages(pages).map_err(|e| JsError::new(&e))?.len() as u32)
}

/// Decode the `index`-th page of a concatenated page buffer to RGBA (for previews).
#[wasm_bindgen(js_name = decodePage)]
pub fn decode_page(pages: &[u8], index: u32) -> Result<DecodedPage, JsError> {
    let list = format::split_pages(pages).map_err(|e| JsError::new(&e))?;
    let (_, bytes) = list
        .get(index as usize)
        .ok_or_else(|| JsError::new("page index out of range"))?;
    let (info, gray) = format::decode_page_gray(bytes).map_err(|e| JsError::new(&e))?;
    let rgba = gray.iter().flat_map(|&v| [v, v, v, 255]).collect();
    Ok(DecodedPage { width: info.width as u32, height: info.height as u32, rgba })
}

#[wasm_bindgen]
pub struct DecodedPage {
    pub width: u32,
    pub height: u32,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl DecodedPage {
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}
