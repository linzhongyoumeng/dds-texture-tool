/**
 * 生成应用图标 PNG (256x256)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, pixelFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
  }

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const size = 256;
const png = createPNG(size, size, (x, y, w, h) => {
  const cx = w / 2, cy = h / 2;
  const radius = w * 0.42;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

  const cornerRadius = w * 0.18;
  const inRoundedRect = (() => {
    const left = w * 0.08, right = w * 0.92;
    const top = h * 0.08, bottom = h * 0.92;
    if (x < left || x > right || y < top || y > bottom) return false;
    const corners = [
      [left + cornerRadius, top + cornerRadius],
      [right - cornerRadius, top + cornerRadius],
      [left + cornerRadius, bottom - cornerRadius],
      [right - cornerRadius, bottom - cornerRadius],
    ];
    for (const [ccx, ccy] of corners) {
      if ((x < left + cornerRadius || x > right - cornerRadius) &&
          (y < top + cornerRadius || y > bottom - cornerRadius)) {
        if (Math.sqrt((x - ccx) ** 2 + (y - ccy) ** 2) > cornerRadius) return false;
      }
    }
    return true;
  })();

  if (!inRoundedRect) return [0, 0, 0, 0];

  const t = (y / h);
  const r = Math.round(102 + (118 - 102) * t);
  const g = Math.round(126 + (75 - 126) * t);
  const b = Math.round(234 + (162 - 234) * t);

  const gridSize = w * 0.08;
  const gridX = Math.floor((x - w * 0.25) / gridSize);
  const gridY = Math.floor((y - h * 0.25) / gridSize);
  const inGrid = x >= w * 0.25 && x < w * 0.75 && y >= h * 0.25 && y < h * 0.75;

  if (inGrid) {
    if ((gridX + gridY) % 2 === 0) {
      return [255, 255, 255, 220];
    } else {
      return [255, 255, 255, 100];
    }
  }

  return [r, g, b, 255];
});

const outputPath = path.join(__dirname, 'assets', 'icon.png');
fs.writeFileSync(outputPath, png);
console.log(`图标已生成: ${outputPath} (${png.length} bytes)`);
