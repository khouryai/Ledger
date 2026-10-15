// Generates public/icon-192.png, icon-512.png and icon.ico with no image library:
// a near-black rounded square with two arrows, out in Hitachi red (what I owe) and
// in in white (what I am owed). Pure Node (zlib + PNG chunks).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [14, 14, 16];
const RED = [230, 0, 18];
const WHITE = [255, 255, 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));

function make(size) {
  const r = size * 0.2;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const w = Math.max(1.5, size * 0.075);
  const seg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const s = size;
  const top = [[0.24, 0.37, 0.76, 0.37], [0.76, 0.37, 0.62, 0.24], [0.76, 0.37, 0.62, 0.5]].map((l) => l.map((v) => v * s));
  const bot = [[0.76, 0.65, 0.24, 0.65], [0.24, 0.65, 0.38, 0.52], [0.24, 0.65, 0.38, 0.78]].map((l) => l.map((v) => v * s));
  const near = (px, py, lines) => Math.min(...lines.map((l) => seg(px, py, ...l)));
  return png(size, (x, y) => {
    const px = x + 0.5, py = y + 0.5;
    if (!inside(px, py)) return [0, 0, 0, 0];
    const dt = near(px, py, top) - w / 2;
    if (dt < 0) return [...RED, 255];
    if (dt < 1.2) return [...mix(RED, BG, dt / 1.2), 255];
    const db = near(px, py, bot) - w / 2;
    if (db < 0) return [...WHITE, 255];
    if (db < 1.2) return [...mix(WHITE, BG, db / 1.2), 255];
    return [...BG, 255];
  });
}

writeFileSync('public/icon-192.png', make(192));
writeFileSync('public/icon-512.png', make(512));

// A Windows .ico for the desktop and taskbar shortcut. Since Vista an ICO may hold
// PNG payloads directly, so the same generator serves both.
function ico(sizes) {
  const images = sizes.map((sz) => ({ size: sz, png: make(sz) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach((img, i) => {
    const o = i * 16;
    entries[o] = img.size >= 256 ? 0 : img.size;
    entries[o + 1] = img.size >= 256 ? 0 : img.size;
    entries[o + 2] = 0;
    entries[o + 3] = 0;
    entries.writeUInt16LE(1, o + 4);
    entries.writeUInt16LE(32, o + 6);
    entries.writeUInt32LE(img.png.length, o + 8);
    entries.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, entries, ...images.map((im) => im.png)]);
}
writeFileSync('public/icon.ico', ico([16, 32, 48, 256]));
console.log('icons written, including public/icon.ico');
