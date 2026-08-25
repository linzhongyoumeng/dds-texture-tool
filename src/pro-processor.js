/**
 * 专业模式 DDS 处理器
 * 完全独立实现，支持 texconv 全部参数
 * 没有尺寸限制，所有文件都会处理
 * v2.1.3 - 基于 texconv 2025.3.25.2 真实帮助文档修复所有参数
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DDSParser } = require('./dds-parser');

class ProDDSProcessor {
  constructor(config, onProgress = null, onLog = null, onFileChange = null) {
    this.config = config;
    this.parser = new DDSParser();
    this.onProgress = onProgress;
    this.onLog = onLog;
    this.onFileChange = onFileChange;
    this._cancelled = false;
  }

  cancel() {
    this._cancelled = true;
  }

  calculateTargetSize(info) {
    let w = info.width, h = info.height;
    let changed = false;
    if (this.config.scale && this.config.scale !== 1) {
      w = Math.max(1, Math.round(w * this.config.scale));
      h = Math.max(1, Math.round(h * this.config.scale));
      changed = true;
    }
    if (this.config.target_width && this.config.target_width > 0) {
      w = this.config.target_width;
      changed = true;
    }
    if (this.config.target_height && this.config.target_height > 0) {
      h = this.config.target_height;
      changed = true;
    }
    return { width: w, height: h, changed };
  }

  isFormatChanged(info) {
    if (!this.config.target_format) return false;
    return this.config.target_format.toUpperCase() !== info.format.toUpperCase();
  }

  isMipmapChanged(info) {
    if (!this.config.mipmap || this.config.mipmap === 'auto') return false;
    if (this.config.mipmap === 'generate') return info.mipmaps <= 1;
    if (this.config.mipmap === 'none' || this.config.mipmap === '1') return info.mipmaps > 1;
    return false;
  }

  buildTexconvArgs(info, outputPath) {
    const { width: targetW, height: targetH } = this.calculateTargetSize(info);
    const args = ['-y', '-w', String(targetW), '-h', String(targetH), '-o', path.dirname(outputPath) || '.'];

    if (this.config.target_format) {
      const fmt = this.config.target_format.toUpperCase();
      if (['PNG', 'JPEG', 'JPG', 'TGA', 'BMP', 'TIFF', 'TIF', 'WDP', 'HDP', 'JXR'].includes(fmt)) {
        args.push('-ft', fmt === 'JPG' ? 'JPEG' : fmt);
      }
    }

    // CPU/GPU 模式：-nogpu (CPU), -gpu <adapter> (GPU)
    if (this.config.process_mode === 'cpu') {
      args.push('-nogpu');
    } else if (this.config.gpu_adapter && this.config.gpu_adapter !== '0') {
      args.push('-gpu', String(this.config.gpu_adapter));
    }

    // 单线程模式
    if (this.config.single_proc) {
      args.push('--single-proc');
    }

    // 缩放滤镜
    if (this.config.filter && this.config.filter !== 'LINEAR') {
      args.push('-if', this.config.filter);
    }

    // BC 压缩质量：-bc d (dithering/fast), -bc q (quality)
    if (this.config.quality === 'fast') {
      args.push('-bc', 'd');
    } else if (this.config.quality === 'quality') {
      args.push('-bc', 'q');
    }

    // Mipmap：-m <n> (0=自动完整链, 1=无mipmap)
    if (this.config.mipmap === 'generate') {
      args.push('-m', '0');
    } else if (this.config.mipmap === 'none' || this.config.mipmap === '1') {
      args.push('-m', '1');
    }

    // sRGB：-srgb (启用sRGB)，不指定则为线性
    if (this.config.srgb === 'srgb') {
      args.push('-srgb');
    }

    // Alpha：-pmalpha (预乘), -alpha (直接)
    if (this.config.alpha === 'premultiplied') {
      args.push('-pmalpha');
    } else if (this.config.alpha === 'straight') {
      args.push('-alpha');
    }

    // 翻转：-hflip / -vflip
    if (this.config.flip_x) args.push('-hflip');
    if (this.config.flip_y) args.push('-vflip');

    // 不显示 logo
    if (this.config.nologo) {
      args.push('-nologo');
    }

    // 目标格式
    const targetFormat = this.config.target_format;
    if (targetFormat) {
      args.push('-f', targetFormat);
      if (targetFormat.toUpperCase().includes('SRGB') && !args.includes('-srgb')) {
        args.push('-srgb');
      }
    } else if (info.format && info.format !== 'UNKNOWN') {
      args.push('-f', info.format);
      if (info.format.toUpperCase().includes('SRGB') && !args.includes('-srgb')) {
        args.push('-srgb');
      }
    }

    args.push(info.filepath);
    return args;
  }

  generateChangeDescription(info) {
    const changes = [];
    const { width: targetW, height: targetH, changed: sizeChanged } = this.calculateTargetSize(info);
    if (sizeChanged) changes.push(`尺寸: ${info.width}x${info.height} → ${targetW}x${targetH}`);
    if (this.isFormatChanged(info)) changes.push(`格式: ${info.format} → ${this.config.target_format}`);
    if (this.isMipmapChanged(info)) {
      const mipDesc = this.config.mipmap === 'generate' ? '生成完整 Mipmap' : this.config.mipmap === 'none' ? '移除 Mipmap' : '保持';
      changes.push(`Mipmap: ${info.mipmaps}级 → ${mipDesc}`);
    }
    if (this.config.srgb && this.config.srgb !== 'auto') changes.push(`sRGB: ${this.config.srgb}`);
    if (this.config.alpha && this.config.alpha !== 'auto') changes.push(`Alpha: ${this.config.alpha}`);
    if (changes.length === 0) changes.push('无变更（保持原样）');
    return {
      filename: path.basename(info.filepath), filepath: info.filepath,
      original: { width: info.width, height: info.height, format: info.format, mipmaps: info.mipmaps, fileSize: fs.existsSync(info.filepath) ? fs.statSync(info.filepath).size : 0 },
      target: { width: targetW, height: targetH, format: this.config.target_format || info.format },
      changes, willChange: changes.length > 0 && !changes.includes('无变更（保持原样）'),
    };
  }

  async processFile(filepath, backupId = null) {
    const result = { filepath, success: false, skipped: false, skip_reason: '', original_size: { width: 0, height: 0 }, new_size: { width: 0, height: 0 }, original_format: '', new_format: '', error: '', duration: 0, backup_id: backupId, change_info: null };
    const startTime = Date.now();
    const ext = path.extname(filepath).toLowerCase();
    const isDDS = ext === '.dds';
    try {
      let info = null;
      if (isDDS) {
        info = this.parser.parse(filepath);
        if (!info) { result.skipped = true; result.skip_reason = '无法解析 DDS 文件'; result.success = true; result.duration = (Date.now() - startTime) / 1000; return result; }
        result.original_size = { width: info.width, height: info.height };
        result.original_format = info.format;
      } else {
        info = { filepath, width: 0, height: 0, format: ext.toUpperCase().replace('.', ''), mipmaps: 0 };
        result.original_format = info.format;
      }
      const { width: targetW, height: targetH } = this.calculateTargetSize(info);
      result.new_size = { width: targetW, height: targetH };
      result.new_format = this.config.target_format || info.format;
      result.change_info = isDDS ? this.generateChangeDescription(info) : { filename: path.basename(filepath), filepath, original: { width: 0, height: 0, format: info.format, mipmaps: 0, fileSize: fs.existsSync(filepath) ? fs.statSync(filepath).size : 0 }, target: { width: targetW, height: targetH, format: this.config.target_format || info.format }, changes: ['格式转换/处理'], willChange: true };
      if (this.config.dry_run) {
        result.success = true; result.duration = (Date.now() - startTime) / 1000;
        if (this.onFileChange) this.onFileChange(result.change_info);
        return result;
      }
      let outputPath;
      if (this.config.output_dir) {
        const relPath = path.relative(path.resolve(this.config.input_dir || '.'), filepath);
        outputPath = path.join(this.config.output_dir, relPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      } else { outputPath = filepath; }
      const texconv = this.config.texconv_path || 'texconv.exe';
      const args = this.buildTexconvArgs(info, outputPath);
      await new Promise((resolve, reject) => {
        execFile(texconv, args, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            const errMsg = [stderr?.trim(), stdout?.trim()?.split('\n').filter(l => l.includes('ERROR') || l.includes('error')).join('\n'), error.message].filter(Boolean).join(' | ') || `texconv 返回码 ${error.code}`;
            reject(new Error(errMsg));
          } else { resolve(); }
        });
      });
      if (!fs.existsSync(outputPath)) {
        const outputDir = path.dirname(outputPath) || '.';
        const baseName = path.parse(path.basename(filepath)).name;
        for (const ext of ['.dds', '.png', '.jpg', '.tga', '.bmp', '.tif', '.tiff']) {
          const possibleOutput = path.join(outputDir, baseName + ext);
          if (fs.existsSync(possibleOutput) && possibleOutput !== outputPath) {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            fs.renameSync(possibleOutput, outputPath);
            break;
          }
        }
      }
      result.success = true;
      result.duration = (Date.now() - startTime) / 1000;
    } catch (e) { result.error = e.message; result.duration = (Date.now() - startTime) / 1000; }
    return result;
  }

  async processFiles(fileList, backupId = null) {
    const results = [];
    const changeList = [];
    const stats = { total: fileList.length, processed: 0, skipped: 0, failed: 0 };
    for (let i = 0; i < fileList.length; i++) {
      if (this._cancelled) { if (this.onLog) this.onLog('处理已取消', 'warning'); break; }
      const filepath = fileList[i];
      const result = await this.processFile(filepath, backupId);
      results.push(result);
      if (result.skipped) stats.skipped++;
      else if (result.success) stats.processed++;
      else stats.failed++;
      if (result.change_info) changeList.push(result.change_info);
      if (this.onProgress) this.onProgress({ current: i + 1, total: fileList.length, filepath, result, stats: { ...stats }, change_list: changeList });
      if (this.onLog) {
        if (result.skipped) this.onLog(`跳过: ${path.basename(filepath)} (${result.skip_reason})`, 'debug');
        else if (result.success && !this.config.dry_run) this.onLog(`完成: ${path.basename(filepath)} [${result.change_info?.changes?.join(', ') || ''}]`, 'info');
        else if (!result.success) this.onLog(`失败: ${path.basename(filepath)} - ${result.error}`, 'error');
      }
    }
    return { results, stats, backup_id: backupId, change_list: changeList };
  }
}

module.exports = { ProDDSProcessor };
