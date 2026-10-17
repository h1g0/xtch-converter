//! Turning one source image into one or more device-sized frames.

use crate::dither::{self, Dither};
use crate::format;
use crate::image::Gray;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Split images larger than the screen, fit the rest.
    #[default]
    Auto,
    /// Scale the short side to the screen's long side and cut into screens.
    Split,
    /// Fit the whole image on one screen.
    Fit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Rotation {
    #[default]
    Cw,
    Ccw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum StripOrder {
    #[default]
    Ltr,
    Rtl,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// Device screen in portrait orientation.
    pub width: usize,
    pub height: usize,
    /// 1 = XTC/XTG, 2 = XTCH/XTH.
    pub bits: u8,
    pub mode: Mode,
    /// Rotation applied to bands cut from portrait images.
    pub rotate: Rotation,
    /// Order of strips cut from landscape images.
    pub strip_order: StripOrder,
    /// Minimum overlap between neighbouring segments, in device pixels.
    pub min_overlap: usize,
    /// Crop blank margins before laying out.
    pub trim: bool,
    pub dither: Dither,
    pub gamma: f32,
    pub black: f32,
    pub white: f32,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            width: 480,
            height: 800,
            bits: 2,
            mode: Mode::Auto,
            rotate: Rotation::Cw,
            strip_order: StripOrder::Ltr,
            min_overlap: 0,
            trim: false,
            dither: Dither::FloydSteinberg,
            gamma: 1.0,
            black: 0.0,
            white: 255.0,
        }
    }
}

/// Offsets of `size`-long windows covering `len`, spread evenly so the first
/// starts at 0 and the last ends at `len`, each overlapping by >= `min_overlap`.
pub fn segments(len: usize, size: usize, min_overlap: usize) -> Vec<usize> {
    if len <= size {
        return vec![0];
    }
    let ov = min_overlap.min(size / 2);
    let n = (len - ov).div_ceil(size - ov).max(2);
    let span = (len - size) as f64;
    (0..n)
        .map(|i| (span * i as f64 / (n - 1) as f64).round() as usize)
        .collect()
}

fn fit(g: &Gray, w: usize, h: usize) -> Gray {
    let s = (w as f32 / g.w as f32).min(h as f32 / g.h as f32);
    let nw = ((g.w as f32 * s).round() as usize).clamp(1, w);
    let nh = ((g.h as f32 * s).round() as usize).clamp(1, h);
    g.resize(nw, nh).center_on(w, h)
}

/// Lay out a source image into device-sized frames (portrait W x H).
pub fn frames(src: Gray, o: &Options) -> Vec<Gray> {
    let (w, h) = (o.width, o.height);
    let g = match (o.trim, src.content_bbox()) {
        (true, Some((x, y, cw, ch))) => src.crop(x, y, cw, ch),
        _ => src,
    };

    let split = match o.mode {
        Mode::Split => true,
        Mode::Fit => false,
        Mode::Auto => g.w > w || g.h > h,
    };
    if !split {
        return vec![fit(&g, w, h)];
    }

    // The source's short side goes along the screen's long side (h).
    if g.w <= g.h {
        // Portrait source: scale width to h, cut horizontal bands h wide and
        // w tall, then rotate each band upright onto the screen.
        let len = ((g.h as f32 * h as f32 / g.w as f32).round() as usize).max(1);
        let scaled = g.resize(h, len);
        segments(len, w, o.min_overlap)
            .into_iter()
            .map(|y| {
                let band = scaled.crop(0, y, h, w.min(len));
                let band = if band.h < w { band.center_on(h, w) } else { band };
                match o.rotate {
                    Rotation::Cw => band.rotate_cw(),
                    Rotation::Ccw => band.rotate_ccw(),
                }
            })
            .collect()
    } else {
        // Landscape source: scale height to h, cut vertical strips w wide.
        let len = ((g.w as f32 * h as f32 / g.h as f32).round() as usize).max(1);
        let scaled = g.resize(len, h);
        let mut out: Vec<Gray> = segments(len, w, o.min_overlap)
            .into_iter()
            .map(|x| {
                let strip = scaled.crop(x, 0, w.min(len), h);
                if strip.w < w { strip.center_on(w, h) } else { strip }
            })
            .collect();
        if o.strip_order == StripOrder::Rtl {
            out.reverse();
        }
        out
    }
}

/// Full pipeline for one source image: returns encoded pages back to back.
pub fn convert(rgba: &[u8], w: usize, h: usize, o: &Options) -> Result<Vec<u8>, String> {
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return Err(format!("invalid image buffer ({w}x{h}, {} bytes)", rgba.len()));
    }
    if o.width == 0 || o.height == 0 || o.width > u16::MAX as usize || o.height > u16::MAX as usize {
        return Err("invalid device size".into());
    }
    let levels = if o.bits == 2 { 4 } else { 2 };
    let mut out = Vec::new();
    for mut f in frames(Gray::from_rgba(rgba, w, h), o) {
        dither::adjust(&mut f, o.black, o.white, o.gamma);
        let q = dither::quantize(&f, levels, o.dither);
        let page = if o.bits == 2 {
            format::encode_xth(&q, f.w, f.h)
        } else {
            format::encode_xtg(&q, f.w, f.h)
        };
        out.extend_from_slice(&page);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_cover_evenly() {
        assert_eq!(segments(400, 480, 0), vec![0]);
        assert_eq!(segments(480, 480, 0), vec![0]);
        assert_eq!(segments(960, 480, 0), vec![0, 480]);
        assert_eq!(segments(961, 480, 0), vec![0, 241, 481]);
        let s = segments(1131, 480, 40);
        assert_eq!(*s.last().unwrap(), 1131 - 480);
        for p in s.windows(2) {
            assert!(p[1] - p[0] <= 440);
        }
    }

    fn opts(mode: Mode) -> Options {
        Options { mode, ..Default::default() }
    }

    #[test]
    fn portrait_page_is_rotated_into_bands() {
        // A4-ish page: width 600 -> 800, height 849 -> 1132 => 3 bands of 480
        let g = Gray::new(600, 849, 255.0);
        let f = frames(g, &opts(Mode::Split));
        assert_eq!(f.len(), 3);
        assert!(f.iter().all(|f| f.w == 480 && f.h == 800));
    }

    #[test]
    fn landscape_spread_is_cut_into_strips() {
        let g = Gray::new(2000, 1400, 255.0);
        // height 1400 -> 800, width -> 1143 => 3 strips
        let f = frames(g, &opts(Mode::Auto));
        assert_eq!(f.len(), 3);
        assert!(f.iter().all(|f| f.w == 480 && f.h == 800));
    }

    #[test]
    fn rtl_reverses_strips() {
        let mut g = Gray::new(1600, 800, 255.0);
        for y in 0..800 {
            for x in 0..100 {
                g.px[y * 1600 + x] = 0.0; // dark at left edge
            }
        }
        let o = Options { mode: Mode::Split, strip_order: StripOrder::Rtl, ..Default::default() };
        let f = frames(g, &o);
        assert!(f.first().unwrap().px[400 * 480 + 10] > 200.0);
        assert!(f.last().unwrap().px[400 * 480 + 10] < 50.0);
    }

    #[test]
    fn small_image_fits_in_auto() {
        let g = Gray::new(300, 400, 255.0);
        let f = frames(g, &opts(Mode::Auto));
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].w, f[0].h), (480, 800));
    }

    #[test]
    fn x3_resolution() {
        let o = Options { width: 528, height: 792, mode: Mode::Split, ..Default::default() };
        let rgba = vec![255u8; 1000 * 1500 * 4];
        let out = convert(&rgba, 1000, 1500, &o).unwrap();
        let pages = format::split_pages(&out).unwrap();
        // 1000 -> 792, 1500 -> 1188 => 3 bands of 528
        assert_eq!(pages.len(), 3);
        assert!(pages.iter().all(|(p, _)| p.width == 528 && p.height == 792 && p.bits == 2));
    }

    #[test]
    fn cw_rotation_puts_top_of_source_on_the_right() {
        let mut g = Gray::new(800, 1600, 255.0);
        for y in 0..50 {
            for x in 0..800 {
                g.px[y * 800 + x] = 0.0; // dark band at the top
            }
        }
        let f = frames(g, &opts(Mode::Split));
        let first = &f[0];
        assert!(first.px[400 * 480 + 470] < 50.0); // right edge dark
        assert!(first.px[400 * 480 + 10] > 200.0);
    }
}
