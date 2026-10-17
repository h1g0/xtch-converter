//! Tone adjustment and quantization to the device's 2 or 4 gray levels.

use crate::image::Gray;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Dither {
    #[default]
    FloydSteinberg,
    Atkinson,
    Ordered,
    None,
}

/// Map [black, white] to [0, 255] and apply a gamma curve
/// (gamma > 1 darkens midtones, which helps thin text on e-paper).
pub fn adjust(g: &mut Gray, black: f32, white: f32, gamma: f32) {
    if black <= 0.0 && white >= 255.0 && (gamma - 1.0).abs() < 1e-3 {
        return;
    }
    let range = (white - black).max(1.0);
    let mut lut = [0f32; 256];
    for (i, v) in lut.iter_mut().enumerate() {
        let n = ((i as f32 - black) / range).clamp(0.0, 1.0);
        *v = n.powf(gamma) * 255.0;
    }
    // Interpolate between LUT entries so float precision from resizing is kept.
    for p in g.px.iter_mut() {
        let x = p.clamp(0.0, 255.0);
        let i = x as usize;
        let f = x - i as f32;
        let a = lut[i];
        let b = lut[(i + 1).min(255)];
        *p = a + (b - a) * f;
    }
}

/// Quantize to `levels` (2 or 4) evenly spaced grays.
/// Returns level indices, 0 = black .. levels-1 = white.
pub fn quantize(g: &Gray, levels: usize, method: Dither) -> Vec<u8> {
    let step = 255.0 / (levels - 1) as f32;
    let maxq = (levels - 1) as f32;
    let nearest = |v: f32| -> u8 { (v / step).round().clamp(0.0, maxq) as u8 };
    match method {
        Dither::None => g.px.iter().map(|&v| nearest(v)).collect(),
        Dither::Ordered => {
            let mut out = Vec::with_capacity(g.px.len());
            for y in 0..g.h {
                for x in 0..g.w {
                    let t = (BAYER8[y & 7][x & 7] as f32 + 0.5) / 64.0 - 0.5;
                    out.push(nearest(g.px[y * g.w + x] + t * step));
                }
            }
            out
        }
        Dither::FloydSteinberg => floyd_steinberg(g, step, maxq),
        Dither::Atkinson => atkinson(g, step, maxq),
    }
}

fn floyd_steinberg(g: &Gray, step: f32, maxq: f32) -> Vec<u8> {
    let (w, h) = (g.w, g.h);
    let mut out = vec![0u8; w * h];
    // Two error rows with one pixel of padding on each side.
    let mut cur = vec![0f32; w + 2];
    let mut next = vec![0f32; w + 2];
    for y in 0..h {
        let ltr = y % 2 == 0; // serpentine scan avoids directional artifacts
        for i in 0..w {
            let x = if ltr { i } else { w - 1 - i };
            let v = g.px[y * w + x] + cur[x + 1];
            let q = (v / step).round().clamp(0.0, maxq);
            out[y * w + x] = q as u8;
            let e = v - q * step;
            let (fwd, back) = if ltr { (x + 2, x) } else { (x, x + 2) };
            cur[fwd] += e * 7.0 / 16.0;
            next[back] += e * 3.0 / 16.0;
            next[x + 1] += e * 5.0 / 16.0;
            next[fwd] += e * 1.0 / 16.0;
        }
        std::mem::swap(&mut cur, &mut next);
        next.iter_mut().for_each(|v| *v = 0.0);
    }
    out
}

fn atkinson(g: &Gray, step: f32, maxq: f32) -> Vec<u8> {
    let (w, h) = (g.w, g.h);
    let mut out = vec![0u8; w * h];
    let stride = w + 4;
    // Three error rows, two pixels of padding on each side.
    let mut rows = [vec![0f32; stride], vec![0f32; stride], vec![0f32; stride]];
    for y in 0..h {
        for x in 0..w {
            let v = g.px[y * w + x] + rows[0][x + 2];
            let q = (v / step).round().clamp(0.0, maxq);
            out[y * w + x] = q as u8;
            let e = (v - q * step) / 8.0;
            rows[0][x + 3] += e;
            rows[0][x + 4] += e;
            rows[1][x + 1] += e;
            rows[1][x + 2] += e;
            rows[1][x + 3] += e;
            rows[2][x + 2] += e;
        }
        rows.rotate_left(1);
        rows[2].iter_mut().for_each(|v| *v = 0.0);
    }
    out
}

const BAYER8: [[u8; 8]; 8] = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
];

#[cfg(test)]
mod tests {
    use super::*;

    fn mean_level(q: &[u8], levels: usize) -> f32 {
        q.iter().map(|&v| v as f32).sum::<f32>() / q.len() as f32 * 255.0 / (levels - 1) as f32
    }

    #[test]
    fn dithers_preserve_mean_tone() {
        let g = Gray::new(64, 64, 100.0);
        for m in [Dither::FloydSteinberg, Dither::Atkinson, Dither::Ordered] {
            for levels in [2, 4] {
                let q = quantize(&g, levels, m);
                let mean = mean_level(&q, levels);
                assert!((mean - 100.0).abs() < 8.0, "{m:?} {levels}: {mean}");
            }
        }
    }

    #[test]
    fn exact_levels_are_stable() {
        let g = Gray { w: 4, h: 1, px: vec![0.0, 85.0, 170.0, 255.0] };
        assert_eq!(quantize(&g, 4, Dither::FloydSteinberg), vec![0, 1, 2, 3]);
    }
}
