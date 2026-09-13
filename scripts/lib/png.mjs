/**
 * Just enough PNG to answer "is anything actually painted?".
 *
 * Used by `scripts/nav-check.mjs`. It reads the COMPOSITED screenshot rather
 * than the WebGL canvas, and that distinction is the whole reason this exists:
 * MapLibre runs without `preserveDrawingBuffer`, so `readPixels` outside the
 * render loop hands back a cleared buffer and reports every map as blank. A
 * check that cannot tell a blank map from a drawn one is worse than no check —
 * it is the one that let a blank map ship.
 *
 * RGB/RGBA, 8-bit, non-interlaced. That is what Chromium emits; anything else
 * throws rather than guessing.
 */

import zlib from "node:zlib";

/** Minimal PNG reader: RGB/RGBA, 8-bit, non-interlaced — what Chromium emits. */
export function decode(buf) {
  let p = 8, w = 0, h = 0, colour = 0, bits = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bits = data[8]; colour = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bits !== 8 || (colour !== 6 && colour !== 2)) throw new Error(`unsupported PNG ${bits}/${colour}`);
  const ch = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  let q = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[q++];
    const row = raw.subarray(q, q + stride); q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, px: out };
}

/** Distinct colours in a region, and whether a given hue shows up in it. */
export function inspect(buf, region) {
  const { w, h, ch, px } = decode(buf);
  const x0 = Math.max(0, Math.floor(region?.x0 ?? 0)), x1 = Math.min(w, Math.floor(region?.x1 ?? w));
  const y0 = Math.max(0, Math.floor(region?.y0 ?? 0)), y1 = Math.min(h, Math.floor(region?.y1 ?? h));
  const seen = new Map();
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * ch;
      const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { colours: seen.size, top };
}
