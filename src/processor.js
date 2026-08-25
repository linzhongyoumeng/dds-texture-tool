/**
 * DDS 文件处理器
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DDSParser, SUPPORTED_OUTPUT_FORMATS } = require('./dds-parser');

class DDSProcessor {
  constructor(config, onProgress = null, onLog = null) {
    this.config = config;
    this.parser = new DDSParser();
    this.onProgress = onProgress;
    this.onLog = onLog;
    this._cancelled = false;
  }

  cancel() { this._cancelled = true; }

  calculateNewSize(info) {
    let w = info.width, h = info.height;
    const maxW = this.config.max_width || 3072;
    const maxH = this.config.max_height || 3072;
    const align = Math.max(this.config.align_to || 4, 1);
    const fitMode = this.config.fit_mode || 'inside';
    let newW, newH, scaled = false;
    if (fitMode === 'stretch') { newW = maxW > 0 ? maxW : w; newH = maxH > 0 ? maxH : h; scaled = (newW !== w || newH !== h); }
    else if (fitMode === 'width') { if (maxW > 0 && w > maxW) { const ratio = maxW / w; newW = maxW; newH = Math.floor(h * ratio); scaled = true; } else { newW = w; newH = h; } }
    else if (fitMode === 'height') { if (maxH > 0 && h > maxH) { const ratio = maxH / h; newH = maxH; newW = Math.floor(w * ratio); scaled = true; } else { newW = w; newH = h; } }
    else { let scale = 1.0; if (maxW > 0 && w > maxW) scale = Math.min(scale, maxW / w); if (maxH > 0 && h > maxH) scale = Math.min(scale, maxH / h); if (scale < 1.0) { newW = Math.floor(w * scale); newH = Math.floor(h * scale); scaled = true; } else { newW = w; newH = h; } }
    if (scaled) { if (this.config.min_width > 0) newW = Math.max(newW, this.config.min_width); if (this.config.min_height > 0) newH = Math.max(newH, this.config.min_height); }
    if (scaled && align > 1) { newW = Math.max(Math.floor(newW / align) * align, align); newH = Math.max(Math.floor(newH / align) * align, align); }
    return { width: newW, height: newH, scaled };
  }

  shouldProcess(info) {
    const w = info.width, h = info.height;
    const maxW = this.config.max_width || 0;
    const maxH = this.config.max_height || 0;
    if (this.config.skip_unchanged === false) { const { width: newW, height: newH } = this.calculateNewSize(info); return { need: true, newSize: { width: newW, height: newH } }; }
    const exceedsSizeLimit = (maxW > 0 && w > maxW) || (maxH > 0 && h > maxH);
    const { width: newW, height: newH } = this.calculateNewSize(info);
    let formatChanged = false;
    if (this.config.target_format && this.config.force_format) formatChanged = (this.config.target_format.toUpperCase() !== info.format.toUpperCase());
    let mipmapChanged = false;
    if (this.config.mipmaps !== null && this.config.mipmaps !== undefined) mipmapChanged = (this.config.mipmaps !== info.mipmaps);
    const need = exceedsSizeLimit || formatChanged || mipmapChanged;
    return { need, newSize: { width: newW, height: newH } };
  }

  buildCommand(info, outputPath) {
    const texconv = this.config.texconv_path || 'texconv.exe';
    const { width: newW, height: newH } = this.calculateNewSize(info);
    const cmd = ['-y', '-w', String(newW), '-h', String(newH), '-o', path.dirname(outputPath) || '.'];
    if (this.config.mipmaps !== null && this.config.mipmaps !== undefined) cmd.push('-m', String(this.config.mipmaps));
    else if (this.config.generate_mipmaps) cmd.push('-m');
    const targetFmt = this.config.target_format;
    if (targetFmt && this.config.force_format) { cmd.push('-f', targetFmt); if (targetFmt.toUpperCase().includes('SRGB') || this.config.srgb === true) cmd.push('-srgb'); }
    else if (info.format !== 'UNKNOWN' && SUPPORTED_OUTPUT_FORMATS.includes(info.format)) { cmd.push('-f', info.format); if (info.format.toUpperCase().includes('SRGB')) cmd.push('-srgb'); }
    else if (this.config.srgb === true) cmd.push('-srgb');
    cmd.push(info.filepath);
    return { exe: texconv, args: cmd };
  }

  async processFile(filepath, backupId = null) {
    const result = { filepath, success: false, skipped: false, skip_reason: '', original_size: { width: 0, height: 0 }, new_size: { width: 0, height: 0 }, original_format: '', new_format: '', error: '', duration: 0, backup_id: backupId };
    const startTime = Date.now();
    try {
      const info = this.parser.parse(filepath);
      if (!info) { result.skipped = true; result.skip_reason = '无法解析 DDS 文件'; result.success = true; result.duration = (Date.now() - startTime) / 1000; return result; }
      result.original_size = { width: info.width, height: info.height };
      result.original_format = info.format;
      const { need, newSize } = this.shouldProcess(info);
      if (!need) { result.skipped = true; result.skip_reason = '无需处理（尺寸/格式均符合要求）'; result.success = true; result.duration = (Date.now() - startTime) / 1000; return result; }
      result.new_size = newSize;
      let outputPath;
      if (this.config.output_dir) { const relPath = path.relative(path.resolve(this.config.input_dir || '.'), filepath); outputPath = path.join(this.config.output_dir, relPath); fs.mkdirSync(path.dirname(outputPath), { recursive: true }); } else { outputPath = filepath; }
      result.new_format = this.config.target_format || info.format;
      if (this.config.dry_run) { result.success = true; result.duration = (Date.now() - startTime) / 1000; return result; }
      const { exe, args } = this.buildCommand(info, outputPath);
      await new Promise((resolve, reject) => {
        const child = execFile(exe, args, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) { const errMsg = [stderr?.trim(), stdout?.trim()?.split('\n').filter(l => l.includes('ERROR') || l.includes('error')).join('\n'), error.message].filter(Boolean).join(' | ') || `texconv 返回码 ${error.code}`; reject(new Error(errMsg)); } else { resolve(); }
        });
      });
      if (!fs.existsSync(outputPath)) { const outputDir = path.dirname(outputPath) || '.'; const baseName = path.parse(path.basename(filepath)).name; const possibleOutput = path.join(outputDir, baseName + '.dds'); if (fs.existsSync(possibleOutput) && possibleOutput !== outputPath) { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); fs.renameSync(possibleOutput, outputPath); } }
      if (!fs.existsSync(outputPath)) throw new Error('输出文件未找到');
      result.success = true;
      if (this.onLog) this.onLog(`[完成] ${path.basename(filepath)} -> ${newSize.width}x${newSize.height} (${result.new_format})`);
    } catch (e) { result.error = e.message; if (this.onLog) this.onLog(`[失败] ${path.basename(filepath)}: ${e.message}`); }
    result.duration = (Date.now() - startTime) / 1000;
    return result;
  }

  async processBatch(filepaths, backupId = null) {
    const report = { total: filepaths.length, processed: 0, skipped: 0, failed: 0, start_time: new Date().toISOString(), end_time: '', duration: 0, results: [], backup_id: backupId };
    const startTime = Date.now();
    let completed = 0;
    for (let i = 0; i < filepaths.length; i++) {
      if (this._cancelled) break;
      const result = await this.processFile(filepaths[i], backupId);
      report.results.push(result);
      if (result.skipped) report.skipped++;
      else if (result.success) report.processed++;
      else report.failed++;
      completed++;
      if (this.onProgress) this.onProgress(completed, filepaths.length, result);
    }
    report.end_time = new Date().toISOString();
    report.duration = (Date.now() - startTime) / 1000;
    return report;
  }
}

module.exports = { DDSProcessor };