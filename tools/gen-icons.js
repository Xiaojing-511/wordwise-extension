#!/usr/bin/env node
'use strict';

/* 生成扩展图标 (16/32/48/128 PNG)，纯 Node 实现，无第三方依赖 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 6;   // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = y * stride + 1 + x * 4;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- SDF 基础 ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cov = (d) => clamp(0.5 - d, 0, 1); // 1px 抗锯齿

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2 - r;
  const hh = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hw;
  const qy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdTriangle(px, py, a, b, c) {
  const e0 = [b[0] - a[0], b[1] - a[1]];
  const e1 = [c[0] - b[0], c[1] - b[1]];
  const e2 = [a[0] - c[0], a[1] - c[1]];
  const v0 = [px - a[0], py - a[1]];
  const v1 = [px - b[0], py - b[1]];
  const v2 = [px - c[0], py - c[1]];
  const l0 = clamp(dot(v0, e0) / dot(e0, e0), 0, 1);
  const l1 = clamp(dot(v1, e1) / dot(e1, e1), 0, 1);
  const l2 = clamp(dot(v2, e2) / dot(e2, e2), 0, 1);
  const pq0 = [v0[0] - e0[0] * l0, v0[1] - e0[1] * l0];
  const pq1 = [v1[0] - e1[0] * l1, v1[1] - e1[1] * l1];
  const pq2 = [v2[0] - e2[0] * l2, v2[1] - e2[1] * l2];
  const s = Math.sign(e0[0] * e2[1] - e0[1] * e2[0]);
  const d0 = [dot(pq0, pq0), s * (v0[0] * e0[1] - v0[1] * e0[0])];
  const d1 = [dot(pq1, pq1), s * (v1[0] * e1[1] - v1[1] * e1[0])];
  const d2 = [dot(pq2, pq2), s * (v2[0] * e2[1] - v2[1] * e2[0])];
  let best = d0;
  if (d1[0] < best[0]) best = d1;
  if (d2[0] < best[0]) best = d2;
  return -Math.sqrt(best[0]) * Math.sign(best[1]);
}

/* ---------- 绘制（128 设计坐标系） ---------- */
const BG_TOP = [76, 123, 255];
const BG_BOT = [46, 79, 208];
const ACCENT = [34, 58, 165];
const WHITE = [255, 255, 255];

function blend(base, over, alpha) {
  return [
    Math.round(base[0] * (1 - alpha) + over[0] * alpha),
    Math.round(base[1] * (1 - alpha) + over[1] * alpha),
    Math.round(base[2] * (1 - alpha) + over[2] * alpha)
  ];
}

function sample(x, y) {
  const bgD = sdRoundRect(x, y, 0, 0, 128, 128, 26);
  const a = cov(bgD);
  if (a <= 0) return [0, 0, 0, 0];
  const t = y / 128;
  let col = [
    BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t,
    BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t,
    BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t
  ];
  const bubA = cov(sdCircle(x, y, 64, 54, 33));
  if (bubA > 0) col = blend(col, WHITE, bubA);
  const tailA = cov(sdTriangle(x, y, [38, 84], [84, 92], [44, 112]));
  if (tailA > 0) col = blend(col, WHITE, tailA);
  const bars = [[48, 40, 80, 49], [48, 56, 80, 65], [56, 72, 72, 81]];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const d = sdRoundRect(x, y, b[0], b[1], b[2], b[3], 4);
    const ca = cov(d);
    if (ca > 0) col = blend(col, ACCENT, ca);
  }
  return [col[0], col[1], col[2], Math.round(a * 255)];
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = size / 128;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const X = (x + (dx + 0.5) / 2) / k;
          const Y = (y + (dy + 0.5) / 2) / k;
          const c = sample(X, Y);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          al += c[3];
        }
      }
      const idx = (y * size + x) * 4;
      px[idx] = al ? Math.round(r / al) : 0;
      px[idx + 1] = al ? Math.round(g / al) : 0;
      px[idx + 2] = al ? Math.round(b / al) : 0;
      px[idx + 3] = Math.round(al / 4);
    }
  }
  return px;
}

const OUT = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });
[16, 32, 48, 128].forEach(function (size) {
  const buf = encodePng(size, makeIcon(size));
  const file = path.join(OUT, 'icon' + size + '.png');
  fs.writeFileSync(file, buf);
  console.log('written ' + file + ' (' + buf.length + ' bytes)');
});