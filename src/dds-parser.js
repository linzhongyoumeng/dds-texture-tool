/**
 * DDS 文件解析器
 * 解析 DDS 纹理文件的头部信息
 */

const fs = require('fs');
const path = require('path');

// DXGI 格式映射表
const DXGI_FORMAT_MAP = {
  71: 'BC1_UNORM', 72: 'BC1_UNORM_SRGB', 73: 'BC1_TYPELESS',
  74: 'BC2_TYPELESS', 75: 'BC2_UNORM', 76: 'BC2_UNORM_SRGB',
  77: 'BC3_UNORM', 78: 'BC3_UNORM_SRGB', 79: 'BC3_TYPELESS',
  80: 'BC4_UNORM', 81: 'BC4_SNORM', 82: 'BC4_TYPELESS',
  83: 'BC5_UNORM', 84: 'BC5_SNORM', 85: 'BC5_TYPELESS',
  94: 'BC6H_TYPELESS', 95: 'BC6H_UF16', 96: 'BC6H_SF16',
  97: 'BC7_TYPELESS', 98: 'BC7_UNORM', 99: 'BC7_UNORM_SRGB',
  28: 'R8G8B8A8_UNORM', 29: 'R8G8B8A8_UNORM_SRGB', 30: 'R8G8B8A8_TYPELESS',
  87: 'B8G8R8A8_UNORM', 88: 'B8G8R8A8_UNORM_SRGB', 89: 'B8G8R8A8_TYPELESS',
  10: 'R16G16B16A16_FLOAT', 11: 'R16G16B16A16_UNORM', 9: 'R16G16B16A16_TYPELESS',
  2: 'R32G32B32A32_FLOAT', 1: 'R32G32B32A32_TYPELESS',
  61: 'R8_UNORM', 62: 'R8_TYPELESS', 63: 'A8_UNORM',
  54: 'R16_FLOAT', 55: 'R16_TYPELESS', 56: 'R16_UNORM',
  41: 'R32_FLOAT', 42: 'R32_TYPELESS',
  49: 'R16G16_FLOAT', 50: 'R16G16_TYPELESS', 51: 'R16G16_UNORM',
  16: 'R32G32_FLOAT', 17: 'R32G32_TYPELESS',
  34: 'R10G10B10A2_UNORM', 35: 'R10G10B10A2_TYPELESS',
};

// FourCC 格式映射
const FOURCC_MAP = {
  'DXT1': 'BC1_UNORM', 'DXT2': 'BC2_UNORM', 'DXT3': 'BC2_UNORM',
  'DXT4': 'BC3_UNORM', 'DXT5': 'BC3_UNORM',
  'ATI1': 'BC4_UNORM', 'BC4U': 'BC4_UNORM', 'BC4S': 'BC4_SNORM',
  'ATI2': 'BC5_UNORM', 'BC5U': 'BC5_UNORM', 'BC5S': 'BC5_SNORM',
};

// 支持的输出格式
const SUPPORTED_OUTPUT_FORMATS = [
  'BC1_UNORM', 'BC1_UNORM_SRGB',
  'BC2_UNORM', 'BC2_UNORM_SRGB',
  'BC3_UNORM', 'BC3_UNORM_SRGB',
  'BC4_UNORM', 'BC4_SNORM',
  'BC5_UNORM', 'BC5_SNORM',
  'BC6H_UF16', 'BC6H_SF16',
  'BC7_UNORM', 'BC7_UNORM_SRGB',
  'R8G8B8A8_UNORM', 'R8G8B8A8_UNORM_SRGB',
  'B8G8R8A8_UNORM', 'B8G8R8A8_UNORM_SRGB',
  'R16G16B16A16_FLOAT', 'R32G32B32A32_FLOAT',
  'R8_UNORM', 'A8_UNORM', 'R16_UNORM', 'R16_FLOAT',
];

class DDSParser {
  constructor() {
    this.DDS_MAGIC = Buffer.from('DDS ');
  }

  /**
   * 解析 DDS 文件
   * @param {string} filepath - 文件路径
   * @returns {object|null} DDS 文件信息
   */
  parse(filepath) {
    try {
      const fileSize = fs.statSync(filepath).size;
      if (fileSize < 128) return null;

      const fd = fs.openSync(filepath, 'r');
      const buf = Buffer.alloc(256);
      fs.readSync(fd, buf, 0, 256, 0);
      fs.closeSync(fd);

      // 检查魔数
      if (buf.slice(0, 4).toString('ascii') !== 'DDS ') return null;

      let offset = 4;
      const headerSize = buf.readUInt32LE(offset); offset += 4;
      const flags = buf.readUInt32LE(offset); offset += 4;
      const height = buf.readUInt32LE(offset); offset += 4;
      const width = buf.readUInt32LE(offset); offset += 4;
      const pitchOrSize = buf.readUInt32LE(offset); offset += 4;
      const depth = buf.readUInt32LE(offset); offset += 4;
      const mipmaps = buf.readUInt32LE(offset); offset += 4;

      // 跳过保留字段 (11 DWORD = 44 bytes)
      offset += 44;

      // 像素格式
      const pfSize = buf.readUInt32LE(offset); offset += 4;
      const pfFlags = buf.readUInt32LE(offset); offset += 4;
      const fourcc = buf.slice(offset, offset + 4).toString('ascii').replace(/\0/g, ''); offset += 4;
      const rgbBitCount = buf.readUInt32LE(offset); offset += 4;
      const rBitmask = buf.readUInt32LE(offset); offset += 4;
      const gBitmask = buf.readUInt32LE(offset); offset += 4;
      const bBitmask = buf.readUInt32LE(offset); offset += 4;
      const aBitmask = buf.readUInt32LE(offset); offset += 4;

      // 能力标志
      const caps1 = buf.readUInt32LE(offset); offset += 4;
      const caps2 = buf.readUInt32LE(offset); offset += 4;
      offset += 12; // caps3, caps4, reserved

      let isDx10 = (fourcc === 'DX10');
      let dxgiFormat = null;
      let fmtName = 'UNKNOWN';
      let arraySize = 1;

      if (isDx10) {
        dxgiFormat = buf.readUInt32LE(offset); offset += 4;
        const resourceDimension = buf.readUInt32LE(offset); offset += 4;
        const miscFlag = buf.readUInt32LE(offset); offset += 4;
        arraySize = buf.readUInt32LE(offset); offset += 4;
        const miscFlags2 = buf.readUInt32LE(offset); offset += 4;
        fmtName = DXGI_FORMAT_MAP[dxgiFormat] || `DXGI_${dxgiFormat}`;
      } else if (pfFlags & 0x4) {
        // FourCC
        fmtName = FOURCC_MAP[fourcc] || fourcc;
      } else if (pfFlags & 0x40) {
        // RGB
        if (rgbBitCount === 32 && rBitmask === 0x00FF0000) {
          fmtName = 'B8G8R8A8_UNORM';
        } else if (rgbBitCount === 32) {
          fmtName = 'R8G8B8A8_UNORM';
        } else if (rgbBitCount === 24) {
          fmtName = 'R8G8B8_UNORM';
        } else if (rgbBitCount === 16) {
          fmtName = 'R5G6B5_UNORM';
        }
      }

      const isCubemap = !!(caps2 & 0x200);
      const isArray = arraySize > 1;
      const actualMipmaps = (flags & 0x20000) ? mipmaps : 0;

      return {
        filepath,
        width,
        height,
        depth: (flags & 0x800000) ? depth : 1,
        mipmaps: actualMipmaps,
        format: fmtName,
        dxgi_format: dxgiFormat,
        fourcc: fourcc || null,
        is_dx10: isDx10,
        is_cubemap: isCubemap,
        is_array: isArray,
        array_size: arraySize,
        file_size: fileSize,
        header_size: 128 + (isDx10 ? 20 : 0),
        pixel_count: width * height,
        aspect_ratio: height > 0 ? width / height : 0,
      };
    } catch (e) {
      console.error('解析 DDS 失败:', filepath, e.message);
      return null;
    }
  }

  /**
   * 格式化文件大小
   */
  static formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

module.exports = { DDSParser, DXGI_FORMAT_MAP, FOURCC_MAP, SUPPORTED_OUTPUT_FORMATS };
