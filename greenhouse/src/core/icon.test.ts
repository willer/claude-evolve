import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Dependency-free decoder for 8-bit RGBA, non-interlaced PNGs — enough to read
// individual pixels out of assets/icon.png and assert the background is
// transparent (the app icon must not ship a baked-in white square).
interface DecodedPng {
  width: number;
  height: number;
  pixel(x: number, y: number): [number, number, number, number];
}

function decodeRgbaPng(buf: Buffer): DecodedPng {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) throw new Error('not a PNG');
  }

  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (colorType !== 6) throw new Error(`expected RGBA (colorType 6), got ${colorType}`);
      if (interlace !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len; // length(4) + type(4) + data + crc(4)
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0; // left
      const b = y > 0 ? out[(y - 1) * stride + x] : 0; // up
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0; // up-left
      let val: number;
      switch (filter) {
        case 0:
          val = rawByte;
          break;
        case 1:
          val = rawByte + a;
          break;
        case 2:
          val = rawByte + b;
          break;
        case 3:
          val = rawByte + ((a + b) >> 1);
          break;
        case 4:
          val = rawByte + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown filter ${filter}`);
      }
      out[y * stride + x] = val & 0xff;
    }
  }

  return {
    width,
    height,
    pixel(x: number, y: number) {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    },
  };
}

const ICON_PATH = fileURLToPath(new URL('../../assets/icon.png', import.meta.url));

describe('app icon (assets/icon.png)', () => {
  const png = decodeRgbaPng(readFileSync(ICON_PATH));

  it('is a 1024x1024 RGBA image', () => {
    expect(png.width).toBe(1024);
    expect(png.height).toBe(1024);
  });

  it('has fully transparent corners (no baked-in white background)', () => {
    const corners: Array<[string, number, number]> = [
      ['top-left', 0, 0],
      ['top-right', png.width - 1, 0],
      ['bottom-left', 0, png.height - 1],
      ['bottom-right', png.width - 1, png.height - 1],
      // Just inside the canvas margin, outside the rounded panel's arc.
      ['inner-corner', 110, 110],
    ];
    for (const [name, x, y] of corners) {
      const alpha = png.pixel(x, y)[3];
      expect(alpha, `${name} pixel alpha should be 0 (transparent)`).toBe(0);
    }
  });

  it('still renders the panel: center pixel is opaque', () => {
    expect(png.pixel(512, 512)[3]).toBe(255);
  });
});
