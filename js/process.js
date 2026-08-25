/**
 * 批量处理模块
 */

function restoreFormValues() {
  const c = currentConfig;
  if (c.input_dir) document.getElementById('inputDir').value = c.input_dir;
  if (c.output_dir) document.getElementById('outputDir').value = c.output_dir;
  if (c.max_width) document.getElementById('maxWidth').value = c.max_width;
  if (c.max_height) document.getElementById('maxHeight').value = c.max_height;
  if (c.align_to) document.getElementById('alignTo').value = c.align_to;
  if (c.fit_mode) document.getElementById('fitMode').value = c.fit_mode;
  if (c.target_format) document.getElementById('targetFormat').value = c.target_format;
  if (c.srgb) document.getElementById('srgbMode').value = c.srgb;
  if (c.mipmaps !== undefined && c.mipmaps !== '') document.getElementById('mipmaps').value = c.mipmaps;
  if (c.threads) document.getElementById('threads').value = c.threads;
  if (c.dxt_quality) document.getElementById('dxtQuality').value = c.dxt_quality;
  if (c.recursive !== undefined) document.getElementById('recursive').checked = c.recursive;
  if (c.backup !== undefined) document.getElementById('backup').checked = c.backup;
  if (c.force_format) document.getElementById('forceFormat').checked = c.force_format;
  if (c.generate_mipmaps) document.getElementById('genMipmaps').checked = c.generate_mipmaps;
  if (c.dry_run) document.getElementById('dryRun').checked = c.dry_run;
  if (c.input_dir) document.getElementById('rollbackBaseDir').value = c.input_dir;
}

function collectProcessConfig() {
  const config = {
    texconv_path: currentConfig.texconv_path || '',
    input_dir: document.getElementById('inputDir').value.trim(),
    output_dir: document.getElementById('outputDir').value.trim() || null,
    max_width: parseInt(document.getElementById('maxWidth').value) || 3072,
    max_height: parseInt(document.getElementById('maxHeight').value) || 3072,
    align_to: parseInt(document.getElementById('alignTo').value) || 4,
    fit_mode: document.getElementById('fitMode').value,
    target_format: document.getElementById('targetFormat').value || null,
    force_format: document.getElementById('forceFormat').checked,
    srgb: document.getElementById('srgbMode').value,
    mipmaps: document.getElementById('mipmaps').value.trim() === '' ? null : parseInt(document.getElementById('mipmaps').value),
    generate_mipmaps: document.getElementById('genMipmaps').checked,
    threads: parseInt(document.getElementById('threads').value) || 4,
    dxt_quality: document.getElementById('dxtQuality').value,
    bc7_quality: 'production',
    recursive: document.getElementById('recursive').checked,
    backup: document.getElementById('backup').checked,
    skip_unchanged: document.getElementById('skipUnchanged').checked,
    backup_dir: null,
    dry_run: document.getElementById('dryRun').checked,
    include_patterns: ['*.dds'],
    exclude_patterns: [],
    min_file_size: 0,
    max_file_size: 0,
  };
  if (config.srgb === 'on') config.srgb = true;
  else if (config.srgb === 'off') config.srgb = false;
  else config.srgb = null;
  return config;
}

async function saveCurrentConfig() {
  const config = collectProcessConfig();
  await window.ddsTool.saveConfig(config);
  currentConfig = { ...currentConfig, ...config };
}

function applyPreset(size) {
  document.getElementById('maxWidth').value = size;
  document.getElementById('maxHeight').value = size;
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes(String(size))) btn.classList.add('active');
  });
  log(`已应用预设: ${size}x${size}`, 'info');
}

async function startProcess() {
  if (isProcessing) return;
  const config = collectProcessConfig();
  await startProcessWithConfig(config);
}

async function startProcessWithConfig(config) {
  if (isProcessing) return;
  if (!config.input_dir) { log('请先选择输入目录或文件', 'error'); return; }
  if (!config.dry_run && !config.texconv_path) { log('请先设置 texconv.exe 路径', 'error'); return; }
  await saveCurrentConfig();
  isProcessing = true;
  processStartTime = Date.now();
  document.getElementById('btnStartProcess').style.display = 'none';
  document.getElementById('btnScanPreview').style.display = 'none';
  document.getElementById('btnCancelProcess').style.display = 'inline-flex';
  document.getElementById('progressPanel').style.display = 'block';
  document.getElementById('currentFileBar').style.display = 'flex';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = '0 / 0';
  document.getElementById('statProcessed').textContent = '0';
  document.getElementById('statSkipped').textContent = '0';
  document.getElementById('statFailed').textContent = '0';
  document.getElementById('statDuration').textContent = '0s';
  log(config.dry_run ? '[预览] 开始预览处理...' : '[处理] 开始批量处理...');
  try {
    const result = await window.ddsTool.startProcess(config);
    if (result.success) {
      const report = result.report;
      const dur = report.duration ? report.duration.toFixed(1) : '0';
      if (config.dry_run) log(`[预览] 完成 - 需处理 ${report.processed} 个，跳过 ${report.skipped} 个，失败 ${report.failed} 个，耗时 ${dur}s`, report.failed > 0 ? 'warning' : 'success');
      else log(`[处理] 完成 - 成功 ${report.processed}，跳过 ${report.skipped}，失败 ${report.failed}，耗时 ${dur}s`, report.failed > 0 ? 'warning' : 'success');
      document.getElementById('statProcessed').textContent = report.processed;
      document.getElementById('statSkipped').textContent = report.skipped;
      document.getElementById('statFailed').textContent = report.failed;
      document.getElementById('progressFill').style.width = '100%';
      document.getElementById('progressText').textContent = `${report.total} / ${report.total}`;
      if (report.results && report.results.length > 0) {
        let totalOriginalSize = 0, totalNewSize = 0, processedCount = 0;
        for (const r of report.results) {
          if (r.success && !r.skipped && r.original_size && r.new_size) {
            const bytesPerPixel = estimateBytesPerPixel(r.new_format || r.original_format);
            totalOriginalSize += r.original_size.width * r.original_size.height * bytesPerPixel;
            totalNewSize += r.new_size.width * r.new_size.height * bytesPerPixel;
            processedCount++;
          }
        }
        if (processedCount > 0 && report.duration > 0) {
          const savedBytes = totalOriginalSize - totalNewSize;
          const savedMB = (savedBytes / 1024 / 1024).toFixed(1);
          const avgSpeed = (processedCount / report.duration).toFixed(2);
          const avgTimePerFile = (report.duration / processedCount).toFixed(2);
          log(`统计: 处理 ${processedCount} 个文件, 总耗时 ${report.duration.toFixed(1)}s, 平均 ${avgSpeed} 文件/秒 (${avgTimePerFile}s/文件), 估算节省 ~${savedMB} MB`, 'info');
        }
      }
      if (report.backup_id) log(`备份点 ID: ${report.backup_id}（可在"备份回滚"页面恢复）`, 'info');
    } else { log(`处理失败: ${result.error}`, 'error'); }
  } catch (e) { log(`处理异常: ${e.message}`, 'error'); }
  finally {
    isProcessing = false;
    document.getElementById('btnStartProcess').style.display = 'inline-flex';
    document.getElementById('btnScanPreview').style.display = 'inline-flex';
    document.getElementById('btnCancelProcess').style.display = 'none';
    document.getElementById('currentFileBar').style.display = 'none';
  }
}

async function cancelProcess() {
  if (!isProcessing) return;
  log('正在取消处理...', 'warning');
  try { await window.ddsTool.cancelProcess(); } catch (e) { log(`取消失败: ${e.message}`, 'error'); }
  await new Promise(r => setTimeout(r, 500));
  isProcessing = false;
  document.getElementById('btnStartProcess').style.display = 'inline-flex';
  document.getElementById('btnScanPreview').style.display = 'inline-flex';
  document.getElementById('btnCancelProcess').style.display = 'none';
  document.getElementById('currentFileBar').style.display = 'none';
  log('处理已取消', 'warning');
}

function updateProgress(completed, total, result) {
  pendingProgress = { completed, total, result };
  if (progressRafPending) return;
  progressRafPending = true;
  requestAnimationFrame(() => {
    progressRafPending = false;
    if (!pendingProgress) return;
    const { completed: c, total: t, result: r } = pendingProgress;
    pendingProgress = null;
    const percent = t > 0 ? (c / t * 100) : 0;
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `${c} / ${t}`;
    if (r) {
      const fileName = r.filepath ? r.filepath.split(/[\\/]/).pop() : '-';
      document.getElementById('currentFileName').textContent = fileName;
      let infoText = '';
      if (r.original_size && r.new_size) infoText = `${r.original_size.width}x${r.original_size.height} → ${r.new_size.width}x${r.new_size.height}`;
      if (r.new_format) infoText += ` (${r.new_format})`;
      if (r.skipped) infoText += ' [跳过]';
      document.getElementById('currentFileInfo').textContent = infoText;
      if (!r.skipped && !r.success && r.error) log(`[失败] ${r.filepath.split(/[\\/]/).pop()}: ${r.error}`, 'error', { filepath: r.filepath, error: r.error });
    }
    const elapsed = Math.floor((Date.now() - processStartTime) / 1000);
    document.getElementById('statDuration').textContent = `${elapsed}s`;
  });
}

function updateTexconvStatus() {
  const path = currentConfig.texconv_path;
  const isBundled = currentConfig._using_bundled_texconv;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const pathBar = document.getElementById('pathBar');
  const pathValue = document.getElementById('texconvPath');
  const dict = i18n[currentLang] || i18n.zh;
  if (path) {
    if (dot) dot.classList.add('ready');
    if (text) text.textContent = isBundled ? dict.texconvBundled : dict.texconvReady;
    if (pathBar) pathBar.style.display = 'flex';
    if (pathValue) pathValue.textContent = isBundled ? `(bundled) ${path}` : path;
  } else {
    if (dot) dot.classList.remove('ready');
    if (text) text.textContent = dict.texconvNotSet;
    if (pathBar) pathBar.style.display = 'none';
  }
}

async function selectTexconv() {
  const filepath = await window.ddsTool.selectTexconv();
  if (filepath) {
    currentConfig.texconv_path = filepath;
    await window.ddsTool.saveConfig({ texconv_path: filepath });
    updateTexconvStatus();
    log(`已设置 texconv 路径: ${filepath}`, 'success');
  }
}

async function selectInputDir() {
  const dir = await window.ddsTool.selectDirectory('选择输入目录');
  if (dir) {
    document.getElementById('inputDir').value = dir;
    document.getElementById('rollbackBaseDir').value = dir;
    document.getElementById('infoFilePath').value = dir;
  }
}

async function selectInputFile() {
  const file = await window.ddsTool.selectDdsFile();
  if (file) {
    document.getElementById('inputDir').value = file;
    document.getElementById('infoFilePath').value = file;
  }
}

async function selectOutputDir() {
  const dir = await window.ddsTool.selectDirectory('选择输出目录');
  if (dir) document.getElementById('outputDir').value = dir;
}

function openInputFolder() {
  const dir = document.getElementById('inputDir').value.trim();
  if (dir) window.ddsTool.openPath(dir);
  else log('请先选择输入目录', 'warning');
}