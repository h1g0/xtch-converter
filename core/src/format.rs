//! XTG / XTH page images and the XTC / XTCH container.
//!
//! Layout follows the CrossPoint Reader firmware parser (lib/Xtc) and
//! CrazyCoder's format notes. All integers are little-endian.

pub const XTG_MAGIC: [u8; 4] = *b"XTG\0";
pub const XTH_MAGIC: [u8; 4] = *b"XTH\0";
pub const XTC_MAGIC: [u8; 4] = *b"XTC\0";
pub const XTCH_MAGIC: [u8; 4] = *b"XTCH";

pub const PAGE_HEADER_SIZE: usize = 22;
pub const CONTAINER_HEADER_SIZE: usize = 56;
pub const METADATA_SIZE: usize = 256;
pub const CHAPTER_SIZE: usize = 96;
pub const PAGE_TABLE_ENTRY_SIZE: usize = 16;

const TITLE_LEN: usize = 128;
const AUTHOR_LEN: usize = 64;
const CHAPTER_NAME_LEN: usize = 80;

/// Bytes of pixel data for a page of the given size and bit depth.
pub fn page_data_size(width: usize, height: usize, bits: u8) -> usize {
    if bits == 2 {
        width * height.div_ceil(8) * 2
    } else {
        width.div_ceil(8) * height
    }
}

fn page_header(magic: [u8; 4], width: usize, height: usize, data_len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(PAGE_HEADER_SIZE + data_len);
    out.extend_from_slice(&magic);
    out.extend_from_slice(&(width as u16).to_le_bytes());
    out.extend_from_slice(&(height as u16).to_le_bytes());
    out.push(0); // color mode
    out.push(0); // compression
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 8]); // optional MD5 prefix, left empty
    out
}

/// Encode a 1-bit page. `levels`: 0 = black, 1 = white, row-major.
pub fn encode_xtg(levels: &[u8], width: usize, height: usize) -> Vec<u8> {
    let row_bytes = width.div_ceil(8);
    let size = row_bytes * height;
    let mut out = page_header(XTG_MAGIC, width, height, size);
    let base = out.len();
    out.resize(base + size, 0);
    let data = &mut out[base..];
    for y in 0..height {
        let row = &levels[y * width..(y + 1) * width];
        let dst = &mut data[y * row_bytes..(y + 1) * row_bytes];
        for (x, &q) in row.iter().enumerate() {
            if q != 0 {
                dst[x >> 3] |= 0x80 >> (x & 7);
            }
        }
    }
    out
}

/// Device pixel value for a luminance level (0 = black .. 3 = white).
/// The device maps 0 = white, 1 = dark grey, 2 = light grey, 3 = black.
const XTH_VALUE: [u8; 4] = [3, 1, 2, 0];

/// Encode a 2-bit page. `levels`: 0 = black .. 3 = white, row-major.
/// Output is two bit planes, column-major with columns stored right to left,
/// 8 vertical pixels per byte (MSB = topmost).
pub fn encode_xth(levels: &[u8], width: usize, height: usize) -> Vec<u8> {
    let col_bytes = height.div_ceil(8);
    let plane = width * col_bytes;
    let mut out = page_header(XTH_MAGIC, width, height, plane * 2);
    let base = out.len();
    out.resize(base + plane * 2, 0);
    let (p1, p2) = out[base..].split_at_mut(plane);
    for y in 0..height {
        let row = &levels[y * width..(y + 1) * width];
        let byte_in_col = y >> 3;
        let mask = 0x80u8 >> (y & 7);
        for (x, &q) in row.iter().enumerate() {
            let v = XTH_VALUE[q as usize & 3];
            if v == 0 {
                continue;
            }
            let idx = (width - 1 - x) * col_bytes + byte_in_col;
            if v & 2 != 0 {
                p1[idx] |= mask;
            }
            if v & 1 != 0 {
                p2[idx] |= mask;
            }
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageInfo {
    pub bits: u8,
    pub width: usize,
    pub height: usize,
    /// Total length including the 22-byte header.
    pub len: usize,
}

pub fn parse_page_header(buf: &[u8]) -> Result<PageInfo, String> {
    let info = parse_header_only(buf)?;
    if buf.len() < info.len {
        return Err("page buffer truncated".into());
    }
    Ok(info)
}

/// Decode a page back to 8-bit grayscale (for previews and tests).
pub fn decode_page_gray(buf: &[u8]) -> Result<(PageInfo, Vec<u8>), String> {
    let info = parse_page_header(buf)?;
    let (w, h) = (info.width, info.height);
    let data = &buf[PAGE_HEADER_SIZE..info.len];
    let mut out = vec![0u8; w * h];
    if info.bits == 1 {
        let row_bytes = w.div_ceil(8);
        for y in 0..h {
            for x in 0..w {
                let bit = data[y * row_bytes + (x >> 3)] & (0x80 >> (x & 7));
                out[y * w + x] = if bit != 0 { 255 } else { 0 };
            }
        }
    } else {
        const GRAY: [u8; 4] = [255, 85, 170, 0];
        let col_bytes = h.div_ceil(8);
        let (p1, p2) = data.split_at(w * col_bytes);
        for y in 0..h {
            for x in 0..w {
                let idx = (w - 1 - x) * col_bytes + (y >> 3);
                let shift = 7 - (y & 7);
                let v = (((p1[idx] >> shift) & 1) << 1) | ((p2[idx] >> shift) & 1);
                out[y * w + x] = GRAY[v as usize];
            }
        }
    }
    Ok((info, out))
}

/// Split a buffer of back-to-back XTG/XTH pages into slices.
pub fn split_pages(buf: &[u8]) -> Result<Vec<(PageInfo, &[u8])>, String> {
    let mut pages = Vec::new();
    let mut pos = 0;
    while pos < buf.len() {
        let info = parse_page_header(&buf[pos..])?;
        pages.push((info, &buf[pos..pos + info.len]));
        pos += info.len;
    }
    Ok(pages)
}

#[derive(Debug, Clone)]
pub struct Chapter {
    pub name: String,
    /// 0-based, inclusive.
    pub start: u16,
    pub end: u16,
}

#[derive(Debug, Clone, Default)]
pub struct BookMeta {
    pub title: String,
    pub author: String,
    pub created: u32,
    pub chapters: Vec<Chapter>,
    /// 0 = left-to-right, 1 = right-to-left, 2 = top-to-bottom.
    pub read_direction: u8,
}

fn put_str(dst: &mut [u8], s: &str) {
    // Truncate on a char boundary and keep a terminating NUL.
    let max = dst.len() - 1;
    let mut end = s.len().min(max);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    dst[..end].copy_from_slice(&s.as_bytes()[..end]);
}

/// Parse page info from a page header alone (no pixel data needed).
pub fn parse_header_only(buf: &[u8]) -> Result<PageInfo, String> {
    let mut probe = [0u8; PAGE_HEADER_SIZE];
    probe.copy_from_slice(buf.get(..PAGE_HEADER_SIZE).ok_or("page header too short")?);
    let magic: [u8; 4] = probe[0..4].try_into().unwrap();
    let bits = match magic {
        XTG_MAGIC => 1,
        XTH_MAGIC => 2,
        _ => return Err("unknown page magic".into()),
    };
    let width = u16::from_le_bytes([probe[4], probe[5]]) as usize;
    let height = u16::from_le_bytes([probe[6], probe[7]]) as usize;
    let size = u32::from_le_bytes(probe[10..14].try_into().unwrap()) as usize;
    if size != page_data_size(width, height, bits) {
        return Err("page data size mismatch".into());
    }
    Ok(PageInfo { bits, width, height, len: PAGE_HEADER_SIZE + size })
}

/// Build an XTC (1-bit) or XTCH (2-bit) container from concatenated pages.
/// Section order: header, metadata, chapters, page table, page data.
pub fn build_container(pages_buf: &[u8], meta: &BookMeta) -> Result<Vec<u8>, String> {
    let pages = split_pages(pages_buf)?;
    let infos: Vec<PageInfo> = pages.iter().map(|(p, _)| *p).collect();
    let mut out = build_prefix(&infos, meta)?;
    out.reserve(pages_buf.len());
    for (_, bytes) in pages {
        out.extend_from_slice(bytes);
    }
    Ok(out)
}

/// Everything in the container that precedes the page data. Appending the
/// pages in order yields the complete file, so callers can stream pages
/// without holding the whole file in one buffer.
pub fn build_prefix(pages: &[PageInfo], meta: &BookMeta) -> Result<Vec<u8>, String> {
    if pages.is_empty() {
        return Err("no pages".into());
    }
    if pages.len() > u16::MAX as usize {
        return Err(format!("too many pages ({}), max {}", pages.len(), u16::MAX));
    }
    let bits = pages[0].bits;
    if pages.iter().any(|p| p.bits != bits) {
        return Err("mixed 1-bit and 2-bit pages".into());
    }

    let page_count = pages.len();
    let chapters: Vec<&Chapter> = meta
        .chapters
        .iter()
        .filter(|c| (c.start as usize) < page_count && c.start <= c.end)
        .collect();

    let metadata_offset = CONTAINER_HEADER_SIZE;
    let chapter_offset = metadata_offset + METADATA_SIZE;
    let table_offset = chapter_offset + chapters.len() * CHAPTER_SIZE;
    let data_offset = table_offset + page_count * PAGE_TABLE_ENTRY_SIZE;
    let mut out = vec![0u8; data_offset];

    // Header
    out[0..4].copy_from_slice(if bits == 2 { &XTCH_MAGIC } else { &XTC_MAGIC });
    out[4] = 1; // version major
    out[5] = 0; // version minor
    out[6..8].copy_from_slice(&(page_count as u16).to_le_bytes());
    out[8] = meta.read_direction;
    out[9] = 1; // has metadata
    out[10] = 0; // has thumbnails
    out[11] = (!chapters.is_empty()) as u8;
    out[12..16].copy_from_slice(&1u32.to_le_bytes()); // current page (1-based)
    out[16..24].copy_from_slice(&(metadata_offset as u64).to_le_bytes());
    out[24..32].copy_from_slice(&(table_offset as u64).to_le_bytes());
    out[32..40].copy_from_slice(&(data_offset as u64).to_le_bytes());
    out[40..48].copy_from_slice(&0u64.to_le_bytes()); // thumbnails
    let ch_off = if chapters.is_empty() { 0 } else { chapter_offset as u64 };
    out[48..56].copy_from_slice(&ch_off.to_le_bytes());

    // Metadata
    let m = &mut out[metadata_offset..metadata_offset + METADATA_SIZE];
    put_str(&mut m[0..TITLE_LEN], &meta.title);
    put_str(&mut m[TITLE_LEN..TITLE_LEN + AUTHOR_LEN], &meta.author);
    // publisher (32) and language (16) left empty
    m[240..244].copy_from_slice(&meta.created.to_le_bytes());
    m[244..246].copy_from_slice(&0u16.to_le_bytes()); // cover page
    m[246..248].copy_from_slice(&(chapters.len() as u16).to_le_bytes());

    // Chapters: page numbers are stored 1-based (CrossPoint decrements them).
    for (i, c) in chapters.iter().enumerate() {
        let e = &mut out[chapter_offset + i * CHAPTER_SIZE..chapter_offset + (i + 1) * CHAPTER_SIZE];
        put_str(&mut e[..CHAPTER_NAME_LEN], &c.name);
        let end = (c.end as usize).min(page_count - 1) as u16;
        e[80..82].copy_from_slice(&(c.start + 1).to_le_bytes());
        e[82..84].copy_from_slice(&(end + 1).to_le_bytes());
    }

    // Page table; data follows directly at data_offset.
    let mut pos = data_offset;
    for (i, info) in pages.iter().enumerate() {
        let e = &mut out[table_offset + i * PAGE_TABLE_ENTRY_SIZE..table_offset + (i + 1) * PAGE_TABLE_ENTRY_SIZE];
        e[0..8].copy_from_slice(&(pos as u64).to_le_bytes());
        e[8..12].copy_from_slice(&(info.len as u32).to_le_bytes());
        e[12..14].copy_from_slice(&(info.width as u16).to_le_bytes());
        e[14..16].copy_from_slice(&(info.height as u16).to_le_bytes());
        pos += info.len;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u64_at(b: &[u8], o: usize) -> usize {
        u64::from_le_bytes(b[o..o + 8].try_into().unwrap()) as usize
    }

    #[test]
    fn xth_roundtrip_and_layout() {
        let (w, h) = (5, 11);
        let levels: Vec<u8> = (0..w * h).map(|i| (i % 4) as u8).collect();
        let page = encode_xth(&levels, w, h);
        assert_eq!(page.len(), PAGE_HEADER_SIZE + w * 2 * 2);
        let (info, gray) = decode_page_gray(&page).unwrap();
        assert_eq!((info.width, info.height, info.bits), (w, h, 2));
        let expect: Vec<u8> = levels.iter().map(|&q| q * 85).collect();
        assert_eq!(gray, expect);

        // Top-left pixel black => column index w-1, MSB of first byte, both planes set.
        let mut one = vec![3u8; w * h];
        one[0] = 0;
        let page = encode_xth(&one, w, h);
        let col_bytes = 2;
        let plane = w * col_bytes;
        let d = &page[PAGE_HEADER_SIZE..];
        assert_eq!(d[(w - 1) * col_bytes], 0x80);
        assert_eq!(d[plane + (w - 1) * col_bytes], 0x80);
        assert_eq!(d.iter().filter(|&&b| b != 0).count(), 2);
    }

    #[test]
    fn xth_grey_planes() {
        // light grey (q=2) -> value 2 -> plane1 only; dark grey (q=1) -> value 1 -> plane2 only
        let page = encode_xth(&[2, 1], 2, 1);
        let d = &page[PAGE_HEADER_SIZE..];
        // columns right-to-left: col index 0 holds x=1, col index 1 holds x=0
        assert_eq!(&d[0..2], &[0x00, 0x80]); // plane1
        assert_eq!(&d[2..4], &[0x80, 0x00]); // plane2
    }

    #[test]
    fn xtg_roundtrip() {
        let (w, h) = (13, 3);
        let levels: Vec<u8> = (0..w * h).map(|i| ((i * 7) % 3 == 0) as u8).collect();
        let page = encode_xtg(&levels, w, h);
        let (_, gray) = decode_page_gray(&page).unwrap();
        assert_eq!(gray, levels.iter().map(|&q| q * 255).collect::<Vec<_>>());
    }

    #[test]
    fn container_layout() {
        let a = encode_xth(&vec![3u8; 480 * 800], 480, 800);
        let b = encode_xth(&vec![0u8; 480 * 800], 480, 800);
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        let meta = BookMeta {
            title: "テスト".into(),
            author: "me".into(),
            chapters: vec![Chapter { name: "c1".into(), start: 1, end: 1 }],
            ..Default::default()
        };
        let out = build_container(&buf, &meta).unwrap();
        assert_eq!(&out[0..4], b"XTCH");
        assert_eq!((out[4], out[5]), (1, 0));
        assert_eq!(u16::from_le_bytes([out[6], out[7]]), 2);
        assert_eq!(out[9], 1);
        assert_eq!(out[11], 1);
        assert_eq!(u64_at(&out, 16), 0x38);
        assert_eq!(&out[0x38..0x38 + 9], "テスト".as_bytes());
        assert_eq!(&out[0xB8..0xBA], b"me");
        let ch = u64_at(&out, 48);
        assert_eq!(ch, 56 + 256);
        assert_eq!(u16::from_le_bytes([out[ch + 80], out[ch + 81]]), 2);
        let table = u64_at(&out, 24);
        let data = u64_at(&out, 32);
        assert_eq!(table, ch + 96);
        assert_eq!(data, table + 32);
        let off1 = u64_at(&out, table + 16);
        assert_eq!(off1, data + a.len());
        assert_eq!(&out[off1..off1 + b.len()], &b[..]);
        assert_eq!(out.len(), data + a.len() + b.len());
    }

    #[test]
    fn put_str_truncates_on_char_boundary() {
        let mut buf = [0u8; 5];
        put_str(&mut buf, "あい"); // 6 bytes; only one char (3 bytes) fits in 4
        assert_eq!(&buf, &[0xE3, 0x81, 0x82, 0, 0]);
    }
}
