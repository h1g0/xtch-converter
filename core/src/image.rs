//! Single-channel float image and the geometric operations the converter needs.

use std::f32::consts::PI;

#[derive(Debug, Clone)]
pub struct Gray {
    pub w: usize,
    pub h: usize,
    /// 0.0 = black, 255.0 = white.
    pub px: Vec<f32>,
}

impl Gray {
    pub fn new(w: usize, h: usize, fill: f32) -> Self {
        Gray { w, h, px: vec![fill; w * h] }
    }

    /// RGBA8 -> luma, compositing transparency over white.
    pub fn from_rgba(rgba: &[u8], w: usize, h: usize) -> Self {
        let px = rgba
            .chunks_exact(4)
            .take(w * h)
            .map(|p| {
                let l = 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32;
                let a = p[3] as f32 / 255.0;
                l * a + 255.0 * (1.0 - a)
            })
            .collect();
        Gray { w, h, px }
    }

    pub fn crop(&self, x: usize, y: usize, w: usize, h: usize) -> Gray {
        let mut px = Vec::with_capacity(w * h);
        for row in y..y + h {
            px.extend_from_slice(&self.px[row * self.w + x..row * self.w + x + w]);
        }
        Gray { w, h, px }
    }

    /// Paste `self` centered on a white canvas of the given size.
    /// The canvas must be at least as large as the image.
    pub fn center_on(&self, w: usize, h: usize) -> Gray {
        let mut out = Gray::new(w, h, 255.0);
        let ox = (w - self.w) / 2;
        let oy = (h - self.h) / 2;
        for y in 0..self.h {
            let dst = (oy + y) * w + ox;
            out.px[dst..dst + self.w].copy_from_slice(&self.px[y * self.w..(y + 1) * self.w]);
        }
        out
    }

    /// Rotate 90° clockwise.
    pub fn rotate_cw(&self) -> Gray {
        let (w, h) = (self.w, self.h);
        let mut px = vec![0.0; w * h];
        // dst is h wide, w tall: dst(x' = h-1-y, y' = x) = src(x, y)
        for y in 0..h {
            for x in 0..w {
                px[x * h + (h - 1 - y)] = self.px[y * w + x];
            }
        }
        Gray { w: h, h: w, px }
    }

    /// Rotate 90° counter-clockwise.
    pub fn rotate_ccw(&self) -> Gray {
        let (w, h) = (self.w, self.h);
        let mut px = vec![0.0; w * h];
        // dst(x' = y, y' = w-1-x) = src(x, y)
        for y in 0..h {
            for x in 0..w {
                px[(w - 1 - x) * h + y] = self.px[y * w + x];
            }
        }
        Gray { w: h, h: w, px }
    }

    /// Bounding box (x, y, w, h) of the non-blank content, or None if the
    /// page looks blank. A row/column counts as content when enough of its
    /// pixels are noticeably darker than paper, which ignores scan specks.
    pub fn content_bbox(&self) -> Option<(usize, usize, usize, usize)> {
        const DARK: f32 = 200.0;
        let mut rows = vec![0usize; self.h];
        let mut cols = vec![0usize; self.w];
        for y in 0..self.h {
            for x in 0..self.w {
                if self.px[y * self.w + x] < DARK {
                    rows[y] += 1;
                    cols[x] += 1;
                }
            }
        }
        let row_min = (self.w / 500).max(1);
        let col_min = (self.h / 500).max(1);
        let y0 = rows.iter().position(|&c| c >= row_min)?;
        let y1 = rows.iter().rposition(|&c| c >= row_min)?;
        let x0 = cols.iter().position(|&c| c >= col_min)?;
        let x1 = cols.iter().rposition(|&c| c >= col_min)?;
        // Keep a small breathing margin around the content.
        let m = (self.w.min(self.h) / 100).max(2);
        let x0 = x0.saturating_sub(m);
        let y0 = y0.saturating_sub(m);
        let x1 = (x1 + m).min(self.w - 1);
        let y1 = (y1 + m).min(self.h - 1);
        Some((x0, y0, x1 - x0 + 1, y1 - y0 + 1))
    }

    /// Resample with a Lanczos-3 filter (scaled for downsampling).
    pub fn resize(&self, nw: usize, nh: usize) -> Gray {
        if nw == self.w && nh == self.h {
            return self.clone();
        }
        let hw = Weights::new(self.w, nw);
        let vw = Weights::new(self.h, nh);

        // Horizontal pass: (w x h) -> (nw x h)
        let mut tmp = vec![0.0f32; nw * self.h];
        for y in 0..self.h {
            let src = &self.px[y * self.w..(y + 1) * self.w];
            let dst = &mut tmp[y * nw..(y + 1) * nw];
            for (x, d) in dst.iter_mut().enumerate() {
                let (start, ws) = hw.get(x);
                let s = &src[start..start + ws.len()];
                *d = s.iter().zip(ws).map(|(a, b)| a * b).sum();
            }
        }

        // Vertical pass: (nw x h) -> (nw x nh), row-wise accumulation.
        let mut px = vec![0.0f32; nw * nh];
        for y in 0..nh {
            let (start, ws) = vw.get(y);
            let dst = &mut px[y * nw..(y + 1) * nw];
            for (k, &wt) in ws.iter().enumerate() {
                let src = &tmp[(start + k) * nw..(start + k + 1) * nw];
                for (d, s) in dst.iter_mut().zip(src) {
                    *d += wt * s;
                }
            }
            for d in dst.iter_mut() {
                *d = d.clamp(0.0, 255.0);
            }
        }
        Gray { w: nw, h: nh, px }
    }
}

fn lanczos3(x: f32) -> f32 {
    let x = x.abs();
    if x < 1e-6 {
        1.0
    } else if x < 3.0 {
        let px = PI * x;
        3.0 * px.sin() * (px / 3.0).sin() / (px * px)
    } else {
        0.0
    }
}

/// Precomputed, normalized filter taps for one axis.
struct Weights {
    starts: Vec<usize>,
    lens: Vec<usize>,
    stride: usize,
    w: Vec<f32>,
}

impl Weights {
    fn new(src: usize, dst: usize) -> Self {
        let scale = src as f32 / dst as f32;
        let fscale = scale.max(1.0);
        let support = 3.0 * fscale;
        let stride = (support * 2.0).ceil() as usize + 2;
        let mut starts = Vec::with_capacity(dst);
        let mut lens = Vec::with_capacity(dst);
        let mut w = vec![0.0f32; dst * stride];
        for i in 0..dst {
            let center = (i as f32 + 0.5) * scale;
            let left = ((center - support).floor().max(0.0)) as usize;
            let right = ((center + support).ceil() as usize).min(src).max(left + 1);
            let n = (right - left).min(stride);
            let ws = &mut w[i * stride..i * stride + n];
            let mut sum = 0.0;
            for (k, wt) in ws.iter_mut().enumerate() {
                let x = (left + k) as f32 + 0.5 - center;
                *wt = lanczos3(x / fscale);
                sum += *wt;
            }
            if sum.abs() > 1e-6 {
                ws.iter_mut().for_each(|v| *v /= sum);
            }
            starts.push(left);
            lens.push(n);
        }
        Weights { starts, lens, stride, w }
    }

    fn get(&self, i: usize) -> (usize, &[f32]) {
        let o = i * self.stride;
        (self.starts[i], &self.w[o..o + self.lens[i]])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_roundtrip() {
        let g = Gray { w: 3, h: 2, px: vec![1., 2., 3., 4., 5., 6.] };
        let cw = g.rotate_cw();
        assert_eq!((cw.w, cw.h), (2, 3));
        // top row of rotated image = left column of source, bottom-up
        assert_eq!(&cw.px[0..2], &[4., 1.]);
        let back = cw.rotate_ccw();
        assert_eq!(back.px, g.px);
    }

    #[test]
    fn resize_preserves_flat_field() {
        let g = Gray::new(100, 60, 128.0);
        for (w, h) in [(33, 20), (250, 140), (100, 60)] {
            let r = g.resize(w, h);
            assert!(r.px.iter().all(|&v| (v - 128.0).abs() < 0.01));
        }
    }

    #[test]
    fn bbox_finds_content() {
        let mut g = Gray::new(400, 400, 255.0);
        for y in 100..150 {
            for x in 50..300 {
                g.px[y * 400 + x] = 0.0;
            }
        }
        let (x, y, w, h) = g.content_bbox().unwrap();
        assert!(x <= 50 && x >= 40 && y <= 100 && y >= 90);
        assert!(x + w >= 300 && y + h >= 150);
        assert!(Gray::new(10, 10, 255.0).content_bbox().is_none());
    }
}
