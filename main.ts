// Eclipse Portal — procedural poster art for make.fun coolest-art-01.
//
// Renders a 1024x1024 scene pixel by pixel with the Node standard library
// only: a glowing ringed eclipse over a dusk sky, layered mountain
// silhouettes in a valley, a lone watcher and a pine on a ridge, and a
// still lake mirroring the whole sky. Fully deterministic: a fixed-seed
// PRNG drives the stars, and the PNG encoder always emits identical bytes
// for identical pixels. No network, no dependencies.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader the program writes to /output/entry.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ------------------------------------------------------------------ canvas

const W = 1024;
const H = 1024;
const HORIZON = 648; // y of the horizon line: sky above, lake below.

// ------------------------------------------------------------------- utils

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Piecewise-linear gradient through [position, r, g, b] stops.
function gradient(stops, t) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

// -------------------------------------------------------------------- scene

// Dusk sky: deep space indigo at the top, violet and magenta through the
// middle, ember orange kissing the horizon.
const SKY = [
  [0.0, 6, 9, 30],
  [0.3, 16, 13, 48],
  [0.52, 38, 20, 76],
  [0.7, 84, 31, 92],
  [0.84, 138, 46, 90],
  [0.93, 196, 88, 72],
  [1.0, 233, 131, 78],
];

const SUN = { x: 512, y: 408, disc: 190 }; // the eclipse: centre and disc radius
const GLOW = [255, 205, 140]; // warm gold of the corona
const RIM = [255, 242, 214]; // near-white rim at the disc edge

// Float RGB buffer; quantised once at the end.
const buf = new Float32Array(W * H * 3);
const at = (x, y) => (y * W + x) * 3;

// 1. Sky and lake base: the lake mirrors the sky gradient, darkened.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = at(x, y);
    if (y < HORIZON) {
      const c = gradient(SKY, y / HORIZON);
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    } else {
      const t = (y - HORIZON) / (H - HORIZON);
      const c = gradient(SKY, 1 - t * 0.8);
      // Nearly as bright as the sky right at the horizon line, darkening
      // with depth, so no hard edge appears at the waterline.
      const dim = lerp(0.92, 0.45, t);
      buf[i] = c[0] * dim;
      buf[i + 1] = c[1] * dim;
      buf[i + 2] = c[2] * dim;
    }
  }
}

// 2. Stars: fixed-seed, denser toward the top, a few with sparkle arms.
const rand = mulberry32(0xe01c);
const stars = [];
for (let n = 0; n < 520; n++) {
  const x = rand() * W;
  const y = Math.pow(rand(), 1.4) * (HORIZON - 40);
  const m = rand();
  stars.push({
    x,
    y,
    r: m > 0.985 ? 2.2 : m > 0.9 ? 1.5 : 1.0,
    b: 0.35 + 0.65 * m,
    sparkle: m > 0.985,
  });
}

function splat(cx, cy, radius, color, strength) {
  const r0 = Math.ceil(radius * 2.5);
  for (let y = Math.floor(cy - r0); y <= Math.ceil(cy + r0); y++) {
    if (y < 0 || y >= H) continue;
    for (let x = Math.floor(cx - r0); x <= Math.ceil(cx + r0); x++) {
      if (x < 0 || x >= W) continue;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const g = Math.exp(-d2 / (2 * radius * radius));
      const i = at(x, y);
      buf[i] += color[0] * g * strength;
      buf[i + 1] += color[1] * g * strength;
      buf[i + 2] += color[2] * g * strength;
    }
  }
}

for (const s of stars) {
  splat(s.x, s.y, s.r, [255, 250, 240], s.b * 0.8);
  if (s.sparkle) {
    // Four-point sparkle arms on the brightest stars.
    for (let k = -7; k <= 7; k++) {
      const a = (1 - Math.abs(k) / 8) * 0.5 * s.b;
      const hx = Math.round(s.x + k);
      const vy = Math.round(s.y + k);
      if (hx >= 0 && hx < W) {
        const i = at(hx, Math.round(s.y));
        buf[i] += 255 * a;
        buf[i + 1] += 248 * a;
        buf[i + 2] += 235 * a;
      }
      if (vy >= 0 && vy < H) {
        const i = at(Math.round(s.x), vy);
        buf[i] += 255 * a;
        buf[i + 1] += 248 * a;
        buf[i + 2] += 235 * a;
      }
    }
  }
}

// 3. The eclipse: broad ambient glow, tight corona, bright rim ring at the
// disc edge, two faint outer portal rings, and the dark disc itself.
{
  // Full sky width: a clipped box would leave a visible seam where the
  // ambient glow cuts off.
  const x0 = 0;
  const x1 = W - 1;
  const y0 = 0;
  const y1 = HORIZON - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - SUN.x;
      const dy = y - SUN.y;
      const d = Math.hypot(dx, dy);
      const i = at(x, y);
      if (d < SUN.disc) {
        // The disc: near-black, breathing almost imperceptibly lighter
        // toward its edge.
        const edge = smoothstep(SUN.disc * 0.55, SUN.disc, d);
        buf[i] = lerp(5, 17, edge);
        buf[i + 1] = lerp(5, 14, edge);
        buf[i + 2] = lerp(12, 30, edge);
        continue;
      }
      const over = d - SUN.disc;
      const ambient = Math.exp(-Math.pow(over / 300, 2)) * 0.3;
      const corona = Math.exp(-Math.pow(over / 85, 2));
      const rim = 1 - smoothstep(0, 4, Math.abs(d - SUN.disc));
      const ring2 = 1 - smoothstep(0, 3, Math.abs(d - (SUN.disc + 52)));
      const ring3 = 1 - smoothstep(0, 3, Math.abs(d - (SUN.disc + 108)));
      const glow = ambient * 0.5 + corona * 0.9;
      buf[i] += GLOW[0] * glow + RIM[0] * rim + 255 * ring2 * 0.3 + 255 * ring3 * 0.12;
      buf[i + 1] += GLOW[1] * glow + RIM[1] * rim + 180 * ring2 * 0.3 + 170 * ring3 * 0.12;
      buf[i + 2] += GLOW[2] * glow + RIM[2] * rim + 130 * ring2 * 0.3 + 140 * ring3 * 0.12;
    }
  }
}

// 4. Mountains: three hazy layers, with a valley carved at the centre so
// the ring stays whole and framed.
const PHASES = [rand() * 6.283, rand() * 6.283, rand() * 6.283];
const LAYERS = [
  { base: HORIZON - 95, amps: [34, 20, 10], freqs: [0.0021, 0.0053, 0.011], color: [74, 44, 92], haze: 0.55 },
  { base: HORIZON - 60, amps: [40, 22, 10], freqs: [0.0017, 0.0047, 0.013], color: [40, 23, 60], haze: 0.3 },
  { base: HORIZON - 28, amps: [30, 16, 8], freqs: [0.0025, 0.0061, 0.015], color: [17, 10, 32], haze: 0 },
];

function ridgeY(layer, x) {
  let y = layer.base;
  for (let k = 0; k < 3; k++) {
    y -= layer.amps[k] * Math.sin(x * layer.freqs[k] * Math.PI * 2 + PHASES[k] + k * 1.7);
  }
  // Valley at the centre: the mountains step back for the eclipse.
  y += 62 * Math.exp(-Math.pow((x - SUN.x) / 190, 2));
  return y;
}

for (const layer of LAYERS) {
  for (let x = 0; x < W; x++) {
    const ry = ridgeY(layer, x);
    const facing = Math.exp(-Math.pow((x - SUN.x) / 420, 2)); // rim light faces the eclipse
    for (let y = Math.max(0, Math.floor(ry)); y < HORIZON; y++) {
      const i = at(x, y);
      const sky = gradient(SKY, y / HORIZON);
      const mix = 1 - layer.haze * 0.45;
      buf[i] = lerp(sky[0], layer.color[0], mix);
      buf[i + 1] = lerp(sky[1], layer.color[1], mix);
      buf[i + 2] = lerp(sky[2], layer.color[2], mix);
      if (y - ry < 2) {
        // Warm crest light on the ridge tops.
        const rimLight = 0.35 * facing * (1 - (y - ry) / 2);
        buf[i] += 255 * rimLight;
        buf[i + 1] += 180 * rimLight;
        buf[i + 2] += 120 * rimLight;
      }
    }
  }
}

// 5. Lake reflection: the eclipse mirrored, squashed, rippled and dimmed.
{
  const my = HORIZON + 130; // mirrored centre, kept close under the horizon
  const x0 = Math.max(0, Math.floor(SUN.x - 430));
  const x1 = Math.min(W - 1, Math.ceil(SUN.x + 430));
  const y0 = HORIZON;
  const y1 = Math.min(H - 1, Math.ceil(my + 210));
  for (let y = y0; y <= y1; y++) {
    const ripple = 3 * Math.sin(y * 0.11 + 1.7 * Math.sin(y * 0.031));
    const band = 0.94 + 0.06 * Math.sin(y * 0.16 + ripple * 0.3);
    const fade = 1 - 0.4 * ((y - HORIZON) / (H - HORIZON));
    for (let x = x0; x <= x1; x++) {
      const dx = x + ripple - SUN.x;
      const dy = (y - my) / 0.35; // vertical squash of the mirror image
      // Per-pixel shimmer: the phase drifts with x so the ripples never
      // form perfectly regular stripes across the water.
      const shimmer = 0.85 + 0.15 * Math.sin(y * 0.45 + ripple * 0.5 + 0.8 * Math.sin(x * 0.01));
      const d = Math.hypot(dx, dy);
      const i = at(x, y);
      // The reflection carries the light, not the dark disc: a shimmering
      // glow on the water with only a faint shadow where the disc mirrors,
      // so it never reads as a solid object.
      const over = d - SUN.disc;
      const corona = Math.exp(-Math.pow(over / 85, 2)) * 0.45 * band * fade * shimmer;
      const rim = (1 - smoothstep(0, 8, Math.abs(d - SUN.disc))) * 0.25 * band * fade * shimmer;
      if (d < SUN.disc) {
        const shade = 0.12 * fade;
        buf[i] = lerp(buf[i], 10, shade);
        buf[i + 1] = lerp(buf[i + 1], 8, shade);
        buf[i + 2] = lerp(buf[i + 2], 20, shade);
      }
      buf[i] += GLOW[0] * corona + RIM[0] * rim;
      buf[i + 1] += GLOW[1] * corona + RIM[1] * rim;
      buf[i + 2] += GLOW[2] * corona + RIM[2] * rim;
    }
  }
  // A soft column of light on the water under the eclipse, and the
  // mountains' dark reflection band just below the horizon.
  for (let y = HORIZON; y < H; y++) {
    const depth = (y - HORIZON) / (H - HORIZON);
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      const col = Math.exp(-Math.pow((x - SUN.x) / 90, 2)) * 0.12 * (1 - depth);
      buf[i] += 255 * col;
      buf[i + 1] += 200 * col;
      buf[i + 2] += 140 * col;
      if (y < HORIZON + 70) {
        const band = 1 - 0.12 * (1 - (y - HORIZON) / 70);
        buf[i] *= band;
        buf[i + 1] *= band;
        buf[i + 2] *= band;
      }
    }
  }
  // A few bright stars shimmer back from the water.
  for (const s of stars) {
    if (!s.sparkle) continue;
    const my2 = HORIZON + (HORIZON - s.y);
    const ripple = 5 * Math.sin(my2 * 0.11 + 1.7 * Math.sin(my2 * 0.031));
    splat(s.x + ripple, my2, 1.2, [255, 245, 225], 0.22);
  }
}

// 6. Foreground ridge, pine and lone watcher, bottom-left.
function hillTop(x) {
  const t = clamp((x - 280) / 340, -1, 1);
  const bump = Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI), 1.2);
  const h = 235 * bump + 14 * Math.sin(x * 0.02 + 1.3) + 8 * Math.sin(x * 0.043);
  return 1024 - Math.max(0, h);
}

for (let x = 0; x < W; x++) {
  const top = hillTop(x);
  if (top >= H) continue;
  const facing = Math.exp(-Math.pow((x - SUN.x) / 450, 2));
  for (let y = Math.floor(top); y < H; y++) {
    const i = at(x, y);
    const f = (y - top) / Math.max(1, H - top);
    buf[i] = lerp(14, 7, f);
    buf[i + 1] = lerp(9, 5, f);
    buf[i + 2] = lerp(28, 16, f);
    if (y - top < 3) {
      const rimLight = 0.3 * facing * (1 - (y - top) / 3);
      buf[i] += 255 * rimLight;
      buf[i + 1] += 180 * rimLight;
      buf[i + 2] += 120 * rimLight;
    }
  }
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = Math.floor(y0); y < y1; y++) {
    for (let x = Math.floor(x0); x < x1; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = at(x, y);
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }
}

function fillTriangle(ax, ay, bx, by, cx, cy, color) {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = at(x, y);
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }
}

// The pine: trunk and three stacked boughs.
{
  const tx = 195;
  const base = hillTop(tx);
  const pine = [8, 6, 18];
  fillRect(tx - 3, base - 16, tx + 3, base + 2, pine);
  fillTriangle(tx, base - 78, tx - 32, base - 34, tx + 32, base - 34, pine);
  fillTriangle(tx, base - 62, tx - 26, base - 24, tx + 26, base - 24, pine);
  fillTriangle(tx, base - 46, tx - 20, base - 14, tx + 20, base - 14, pine);
}

// The watcher: a small still figure, head and tapering body.
{
  const fx = 305;
  const base = hillTop(fx);
  const fig = [6, 5, 14];
  for (let y = Math.floor(base - 36); y < base; y++) {
    for (let x = Math.floor(fx - 6); x <= Math.ceil(fx + 6); x++) {
      const dx = x - fx;
      const dy = y - (base - 31);
      const inHead = dx * dx + dy * dy <= 4.5 * 4.5;
      const t = (y - (base - 26)) / 26; // 0 shoulders, 1 feet
      const halfW = lerp(5.5, 3.5, clamp(t, 0, 1));
      const inBody = y >= base - 26 && Math.abs(dx) <= halfW;
      if (!inHead && !inBody) continue;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = at(x, y);
      buf[i] = fig[0];
      buf[i + 1] = fig[1];
      buf[i + 2] = fig[2];
    }
  }
}

// 7. Birds and one shooting star, high in the sky.
function strokeDot(x, y, color, a) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = at(xi, yi);
  buf[i] = lerp(buf[i], color[0], a);
  buf[i + 1] = lerp(buf[i + 1], color[1], a);
  buf[i + 2] = lerp(buf[i + 2], color[2], a);
}

for (const [bx, by, s] of [
  [196, 168, 1],
  [246, 146, 0.8],
  [828, 196, 1],
  [872, 172, 0.7],
]) {
  for (let k = -9; k <= 9; k++) {
    const wing = 1 - Math.abs(k) / 10;
    const yy = by - wing * 4 * s;
    strokeDot(bx + k * s, yy, [16, 12, 30], 0.85);
    strokeDot(bx + k * s, yy + 1, [16, 12, 30], 0.5);
  }
}

{
  // Shooting star: bright head, fading tail.
  const x0 = 140;
  const y0 = 96;
  const x1 = 250;
  const y1 = 168;
  for (let k = 0; k <= 80; k++) {
    const t = k / 80;
    const a = Math.pow(1 - t, 2) * 0.85;
    const r = 1.5 * (1 - t) + 0.5;
    splat(lerp(x0, x1, t), lerp(y0, y1, t), r, [255, 240, 220], a * 0.35);
  }
}

// 8. Vignette: darken the corners a touch, poster-style.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - W / 2, y - H / 2) / 724;
    const f = 1 - 0.16 * smoothstep(0.62, 1.05, d);
    const i = at(x, y);
    buf[i] *= f;
    buf[i + 1] *= f;
    buf[i + 2] *= f;
  }
}

// ------------------------------------------------------------------- output

// Quantise with a tiny integer-hash dither: breaks gradient banding without
// any randomness, so two runs stay byte-identical.
const rgb = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    const dither = (((h >>> 0) % 200) / 100 - 1) * 0.7;
    const i = at(x, y);
    rgb[i] = clamp(Math.round(buf[i] + dither), 0, 255);
    rgb[i + 1] = clamp(Math.round(buf[i + 1] + dither), 0, 255);
    rgb[i + 2] = clamp(Math.round(buf[i + 2] + dither), 0, 255);
  }
}

// Minimal PNG encoder: 8-bit RGB, per-row filter picked by the
// smallest-sum-of-absolute-values heuristic, zlib level 9.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  crc.copy(out, 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePNG(width, height, pixels) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = Buffer.alloc(stride);
  const trial = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestScore = Infinity;
    let bestRow = null;
    for (let filter = 0; filter < 5; filter++) {
      for (let x = 0; x < stride; x++) {
        const left = x >= 3 ? row[x - 3] : 0;
        const up = prev[x];
        const upLeft = x >= 3 ? prev[x - 3] : 0;
        let pred = 0;
        if (filter === 1) pred = left;
        else if (filter === 2) pred = up;
        else if (filter === 3) pred = Math.floor((left + up) / 2);
        else if (filter === 4) pred = paeth(left, up, upLeft);
        trial[x] = (row[x] - pred) & 0xff;
      }
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = trial[x];
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        bestRow = Buffer.from(trial);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    bestRow.copy(raw, y * (stride + 1) + 1);
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

const png = encodePNG(W, H, rgb);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${png.length} bytes, ${W}x${H}`);
