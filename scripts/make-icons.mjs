// Generates PNG app icons with zero dependencies (hand-rolled PNG encoder
// over node:zlib). Draws the Mundialito mark: green tile, stripes, ball.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(size, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const GREEN = hex("#0e7c66"), INK = hex("#1b1a14"), CREAM = hex("#f7f4e8"),
  ORANGE = hex("#e8542f"), GOLD = hex("#d9a521"), PAPER = hex("#f2ecdd");

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  };
  const u = size / 128;
  const corner = 24 * u;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // rounded-corner green tile
      const cx = Math.max(corner - x, x - (size - corner), 0);
      const cy = Math.max(corner - y, y - (size - corner), 0);
      if (cx && cy && Math.hypot(cx, cy) > corner) { put(x, y, [0, 0, 0, 0]); continue; }
      put(x, y, GREEN);
    }
  // stripes with ink borders
  const stripes = [[18, ORANGE], [29, GOLD], [40, PAPER]];
  for (const [sy, col] of stripes)
    for (let y = Math.round(sy * u); y < Math.round((sy + 7) * u); y++)
      for (let x = Math.round(14 * u); x < Math.round(114 * u); x++) {
        const edge = y < sy * u + 1.6 * u || y > (sy + 7) * u - 1.6 * u || x < 14 * u + 1.6 * u || x > 114 * u - 1.6 * u;
        put(x, y, edge ? INK : col);
      }
  // ball
  const bx = 64 * u, by = 84 * u, br = 26 * u;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - bx, y - by);
      if (d < br + 2.4 * u && d >= br - 1.2 * u) put(x, y, INK);
      else if (d < br - 1.2 * u) put(x, y, CREAM);
    }
  for (const [dx, dy, r] of [[0, 0, 6.4], [-14, -10, 4], [14, -10, 4], [-10, 14, 4], [10, 14, 4]])
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (Math.hypot(x - (bx + dx * u), y - (by + dy * u)) < r * u) put(x, y, INK);
  return px;
}

for (const size of [180, 192, 512]) {
  const png = encodePng(size, drawIcon(size));
  const name = size === 180 ? "icon-180.png" : `icon-${size}.png`;
  writeFileSync(new URL(`../public/${name}`, import.meta.url).pathname, png);
  console.log(`wrote public/${name} (${png.length} bytes)`);
}
