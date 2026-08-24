/**
 * 渲染进程 - GUI 交互逻辑
 */

// ============================================================
// 全局状态
// ============================================================

let currentConfig = {};
let isProcessing = false;
let processStartTime = 0;

// 性能优化：进度更新节流
let pendingProgress = null;
let progressRafPending = false;
const MAX_LOG_LINES = 300;

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  currentConfig = await window.ddsTool.getConfig();
  restoreFormValues();
  updateTexconvStatus();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  document.getElementById('btnHelp').addEventListener('click', (e) => {
    e.preventDefault();
    showHelp();
  });

  document.getElementById('btnSelectTexconv').addEventListener('click', selectTexconv);
  document.getElementById('btnChangeTexconv').addEventListener('click', selectTexconv);

  window.ddsTool.onProcessProgress((data) => {
    updateProgress(data.completed, data.total, data.result);
  });

  window.ddsTool.onProcessLog((message, type) => {
    if (isProcessing && message.startsWith('[完成]')) return;
    log(message, type);
  });

  log('DDS Texture Tool 已启动');
  if (currentConfig._using_bundled_texconv) {
    log('已自动加载内置 texconv.exe，可直接使用', 'success');
  } else if (!currentConfig.texconv_path) {
    log('提示: 请先点击右上角"选择 texconv"按钮设置 texconv.exe 路径', 'warning');
  }
});

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

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
  if (c.input_dir) {
    document.getElementById('rollbackBaseDir').value = c.input_dir;
  }
}

function estimateBytesPerPixel(format) {
  if (!format) return 1;
  const fmt = format.toUpperCase();
  if (fmt.includes('BC1') || fmt.includes('BC4')) return 0.5;
  if (fmt.includes('BC2') || fmt.includes('BC3') || fmt.includes('BC5') || fmt.includes('BC6') || fmt.includes('BC7')) return 1;
  if (fmt.includes('R8G8B8A8') || fmt.includes('B8G8R8A8')) return 4;
  if (fmt.includes('R16G16B16A16')) return 8;
  if (fmt.includes('R32G32B32A32')) return 16;
  return 1;
}

function applyPreset(size) {
  document.getElementById('maxWidth').value = size;
  document.getElementById('maxHeight').value = size;
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes(String(size))) {
      btn.classList.add('active');
    }
  });
  log(`已应用预设: ${size}x${size}`, 'info');
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

async function selectTexconv() {
  const filepath = await window.ddsTool.selectTexconv();
  if (filepath) {
    currentConfig.texconv_path = filepath;
    await window.ddsTool.saveConfig({ texconv_path: filepath });
    updateTexconvStatus();
    log(`已设置 texconv 路径: ${filepath}`, 'success');
  }
}

function updateTexconvStatus() {
  const path = currentConfig.texconv_path;
  const isBundled = currentConfig._using_bundled_texconv;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const pathBar = document.getElementById('pathBar');
  const pathValue = document.getElementById('texconvPath');
  if (path) {
    dot.classList.add('ready');
    text.textContent = isBundled ? '内置 texconv 已就绪' : 'texconv 已就绪';
    pathBar.style.display = 'flex';
    pathValue.textContent = isBundled ? `(内置) ${path}` : path;
  } else {
    dot.classList.remove('ready');
    text.textContent = '未设置 texconv';
    pathBar.style.display = 'none';
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
  if (dir) {
    document.getElementById('outputDir').value = dir;
  }
}

async function selectRollbackDir() {
  const dir = await window.ddsTool.selectDirectory('选择工作目录');
  if (dir) {
    document.getElementById('rollbackBaseDir').value = dir;
  }
}

function openInputFolder() {
  const dir = document.getElementById('inputDir').value.trim();
  if (dir) {
    window.ddsTool.openPath(dir);
  } else {
    log('请先选择输入目录', 'warning');
  }
}

function openRollbackFolder() {
  const dir = document.getElementById('rollbackBaseDir').value.trim();
  if (dir) {
    window.ddsTool.openPath(dir);
  } else {
    log('请先选择工作目录', 'warning');
  }
}

async function selectInfoFile() {
  const file = await window.ddsTool.selectDdsFile();
  if (file) {
    document.getElementById('infoFilePath').value = file;
  }
}

// 扫描预览的文件列表
let scannedFiles = [];

async function scanPreview() {
  const config = collectProcessConfig();
  if (!config.input_dir) {
    log('请先选择输入目录或文件', 'warning');
    return;
  }
  log('正在扫描文件...');
  const files = await window.ddsTool.scanFilesWithInfo(config);
  scannedFiles = files;
  const panel = document.getElementById('fileListPanel');
  const list = document.getElementById('fileList');
  const count = document.getElementById('fileCount');
  panel.style.display = 'block';
  const toProcess = files.filter(f => f.should_process).length;
  count.textContent = `(共 ${files.length} 个文件, ${toProcess} 个需处理)`;
  if (files.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>没有找到符合条件的 DDS 文件</p></div>';
    return;
  }
  let html = `
    <div class="file-item file-item-header">
      <span class="file-check"><input type="checkbox" id="checkAllScanFiles" onchange="selectAllScanFiles(this.checked)" checked></span>
      <span>文件名</span>
      <span class="file-size">大小</span>
      <span class="file-dim">尺寸</span>
      <span class="file-fmt">格式</span>
      <span class="file-status">状态</span>
    </div>
  `;
  const inputDir = config.input_dir || '';
  const groups = {};
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    f._origIndex = i;
    let relPath = '';
    try {
      relPath = f.path.substring(inputDir.length).replace(/^[\\/]/, '');
    } catch (e) {
      relPath = f.name;
    }
    const lastSep = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
    const folder = lastSep > 0 ? relPath.substring(0, lastSep) : '(根目录)';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(f);
  }
  const folderNames = Object.keys(groups).sort();
  let displayedCount = 0;
  const maxDisplay = 200;
  for (const folder of folderNames) {
    if (displayedCount >= maxDisplay) break;
    const folderFiles = groups[folder];
    const folderToProcess = folderFiles.filter(f => f.should_process).length;
    const folderId = 'folder_' + folder.replace(/[^a-zA-Z0-9]/g, '_');
    html += `
      <div class="file-folder-header" onclick="toggleScanFolder('${folderId}')">
        <span class="folder-arrow" id="arrow_${folderId}">▼</span>
        <span class="folder-check"><input type="checkbox" onclick="event.stopPropagation(); selectFolderFiles('${folderId}', this.checked)" ${folderToProcess > 0 ? 'checked' : ''}></span>
        <span class="folder-name">${folder}</span>
        <span class="folder-count">${folderFiles.length} 个文件 (${folderToProcess} 需处理)</span>
      </div>
      <div class="file-folder-content" id="${folderId}">
    `;
    for (const f of folderFiles) {
      if (displayedCount >= maxDisplay) break;
      const statusClass = f.should_process ? 'status-changed' : 'status-unchanged';
      const statusText = f.should_process ? '需处理' : '跳过';
      html += `
        <div class="file-item">
          <span class="file-check"><input type="checkbox" class="scan-file-checkbox" data-index="${f._origIndex}" ${f.should_process ? 'checked' : ''}></span>
          <span class="file-name" title="${f.path}">${f.name}</span>
          <span class="file-size">${f.size_formatted}</span>
          <span class="file-dim">${f.width}x${f.height}</span>
          <span class="file-fmt">${f.format}</span>
          <span class="file-status ${statusClass}">${statusText}</span>
        </div>
      `;
      displayedCount++;
    }
    html += `</div>`;
  }
  if (files.length > maxDisplay) {
    html += `<div class="file-item" style="justify-content:center;color:var(--text-muted);">... 还有 ${files.length - maxDisplay} 个文件未显示</div>`;
  }
  list.innerHTML = html;
  log(`扫描完成，找到 ${files.length} 个文件（${toProcess} 个需处理）`, 'success');
}

function selectAllScanFiles(checked) {
  const checkboxes = document.querySelectorAll('.scan-file-checkbox');
  checkboxes.forEach(cb => { cb.checked = checked; });
  const mainCb = document.getElementById('checkAllScanFiles');
  if (mainCb) mainCb.checked = checked;
}

function toggleScanFolder(folderId) {
  const content = document.getElementById(folderId);
  const arrow = document.getElementById('arrow_' + folderId);
  if (content && arrow) {
    if (content.style.display === 'none') {
      content.style.display = 'block';
      arrow.textContent = '▼';
    } else {
      content.style.display = 'none';
      arrow.textContent = '▶';
    }
  }
}

function selectFolderFiles(folderId, checked) {
  const content = document.getElementById(folderId);
  if (content) {
    const checkboxes = content.querySelectorAll('.scan-file-checkbox');
    checkboxes.forEach(cb => { cb.checked = checked; });
  }
}

async function processSelectedFiles() {
  if (isProcessing) return;
  const checkboxes = document.querySelectorAll('.scan-file-checkbox:checked');
  if (checkboxes.length === 0) {
    log('请先勾选要处理的文件', 'warning');
    return;
  }
  const selectedPaths = Array.from(checkboxes).map(cb => scannedFiles[parseInt(cb.dataset.index)].path);
  log(`已选择 ${selectedPaths.length} 个文件，开始处理...`);
  const config = collectProcessConfig();
  config.selected_files = selectedPaths;
  await startProcessWithConfig(config);
}

async function startProcess() {
  if (isProcessing) return;
  const config = collectProcessConfig();
  await startProcessWithConfig(config);
}

async function startProcessWithConfig(config) {
  if (isProcessing) return;
  if (!config.input_dir) {
    log('请先选择输入目录或文件', 'error');
    return;
  }
  if (!config.dry_run && !config.texconv_path) {
    log('请先设置 texconv.exe 路径', 'error');
    return;
  }
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
  log(config.dry_run ? '开始预览处理...' : '开始批量处理...');
  try {
    const result = await window.ddsTool.startProcess(config);
    if (result.success) {
      const report = result.report;
      log(`处理完成: 成功 ${report.processed}, 跳过 ${report.skipped}, 失败 ${report.failed}`,
        report.failed > 0 ? 'warning' : 'success');
      document.getElementById('statProcessed').textContent = report.processed;
      document.getElementById('statSkipped').textContent = report.skipped;
      document.getElementById('statFailed').textContent = report.failed;
      document.getElementById('progressFill').style.width = '100%';
      document.getElementById('progressText').textContent = `${report.total} / ${report.total}`;
      if (report.results && report.results.length > 0) {
        let totalOriginalSize = 0;
        let totalNewSize = 0;
        let processedCount = 0;
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
      if (report.backup_id) {
        log(`备份点 ID: ${report.backup_id}（可在"备份回滚"页面恢复）`, 'info');
      }
    } else {
      log(`处理失败: ${result.error}`, 'error');
    }
  } catch (e) {
    log(`处理异常: ${e.message}`, 'error');
  } finally {
    isProcessing = false;
    document.getElementById('btnStartProcess').style.display = 'inline-flex';
    document.getElementById('btnScanPreview').style.display = 'inline-flex';
    document.getElementById('btnCancelProcess').style.display = 'none';
    document.getElementById('currentFileBar').style.display = 'none';
  }
}

async function cancelProcess() {
  if (!isProcessing) return;
  await window.ddsTool.cancelProcess();
  log('正在取消处理...', 'warning');
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
      if (r.original_size && r.new_size) {
        infoText = `${r.original_size.width}x${r.original_size.height} → ${r.new_size.width}x${r.new_size.height}`;
      }
      if (r.new_format) infoText += ` (${r.new_format})`;
      if (r.skipped) infoText += ' [跳过]';
      document.getElementById('currentFileInfo').textContent = infoText;
      if (r.skipped) {
        const el = document.getElementById('statSkipped');
        el.textContent = parseInt(el.textContent) + 1;
      } else if (r.success) {
        const el = document.getElementById('statProcessed');
        el.textContent = parseInt(el.textContent) + 1;
      } else {
        const el = document.getElementById('statFailed');
        el.textContent = parseInt(el.textContent) + 1;
        log(`[失败] ${r.filepath.split(/[\\/]/).pop()}: ${r.error}`, 'error', { filepath: r.filepath, error: r.error });
      }
    }
    const elapsed = Math.floor((Date.now() - processStartTime) / 1000);
    document.getElementById('statDuration').textContent = `${elapsed}s`;
  });
}

// 备份回滚
let currentDetailBackupId = null;
let currentDetailFiles = [];
let backupViewMode = 'folder';
let backupSearchQuery = '';
let expandedFolders = new Set();

async function refreshBackups() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) {
    log('请先选择工作目录', 'warning');
    return;
  }
  log('正在加载备份列表...');
  const data = await window.ddsTool.listBackups(baseDir, null);
  renderBackupList('backupList', data.backups, true);
  document.getElementById('backupTotalSize').textContent = `(总占用 ${data.total_size_formatted})`;
  log(`加载完成，共 ${data.backups.length} 个备份点`, 'success');
}

function renderBackupList(containerId, backups, showRollback) {
  const container = document.getElementById(containerId);
  if (backups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <path d="M3 10h18"/>
        </svg>
        <p>暂无备份点</p>
      </div>
    `;
    return;
  }
  let html = '';
  for (const b of backups) {
    const date = new Date(b.timestamp);
    const dateStr = date.toLocaleString('zh-CN');
    html += `
      <div class="backup-item" onclick="showBackupDetail('${b.id}')" style="cursor:pointer;">
        <div class="backup-info">
          <div class="backup-id">${b.id} <span class="expand-hint">点击查看文件 →</span></div>
          <div class="backup-meta">
            <span>📅 ${dateStr}</span>
            <span>📁 ${b.file_count} 个文件</span>
            <span>💾 ${b.total_size_formatted}</span>
          </div>
          <div class="backup-desc">${b.description || ''}</div>
        </div>
        <div class="backup-actions">
          ${showRollback ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();rollbackBackup('${b.id}')">全部回滚</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();deleteBackupItem('${containerId}', '${b.id}')">删除</button>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

async function rollbackBackup(backupId) {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) return;
  if (!confirm(`确定要回滚到备份点 ${backupId} 吗？\n这将覆盖当前文件。`)) {
    return;
  }
  log(`正在回滚到 ${backupId}...`);
  const result = await window.ddsTool.rollback(baseDir, null, backupId, true);
  log(`回滚完成: 成功 ${result.success}, 失败 ${result.failed}`,
    result.failed > 0 ? 'warning' : 'success');
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      log(err, 'error');
    }
  }
}

async function deleteBackupItem(containerId, backupId) {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) {
    log('请先选择工作目录', 'warning');
    return;
  }
  if (!confirm(`确定要删除备份点 ${backupId} 吗？此操作不可恢复。`)) {
    return;
  }
  log(`正在删除备份点: ${backupId}...`);
  const success = await window.ddsTool.deleteBackup(baseDir, null, backupId);
  if (success) {
    log(`已删除备份点: ${backupId}`, 'success');
    if (currentDetailBackupId === backupId) {
      closeBackupDetail();
    }
    refreshBackups();
  } else {
    log(`删除备份点失败: ${backupId}（可能文件被占用或路径无效）`, 'error');
  }
}

async function showBackupDetail(backupId) {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) {
    log('请先选择工作目录', 'warning');
    return;
  }
  currentDetailBackupId = backupId;
  log(`正在加载备份点 ${backupId} 的文件详情...`);
  const detail = await window.ddsTool.getBackupDetail(baseDir, null, backupId);
  if (!detail) {
    log('加载备份详情失败', 'error');
    return;
  }
  currentDetailFiles = detail.files;
  backupSearchQuery = '';
  document.getElementById('backupFileSearch').value = '';
  expandedFolders = new Set();
  const folders = groupFilesByFolder(detail.files);
  for (const folder of Object.keys(folders)) {
    expandedFolders.add(folder);
  }
  document.getElementById('backupDetailPanel').style.display = 'block';
  document.getElementById('backupDetailTitle').textContent =
    `${detail.id} (${detail.file_count} 个文件, ${detail.total_size_formatted})`;
  document.getElementById('btnViewMode').textContent = backupViewMode === 'folder' ? '文件夹视图' : '扁平视图';
  renderBackupFileList();
  log(`加载完成，共 ${detail.files.length} 个文件（${detail.files.filter(f => f.changed).length} 个已修改）`, 'success');
}

function groupFilesByFolder(files) {
  const folders = {};
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const relPath = f.relative_path || f.name;
    const lastSep = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
    const folder = lastSep > 0 ? relPath.substring(0, lastSep) : '(根目录)';
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push({ ...f, _index: i });
  }
  return folders;
}

function renderBackupFileList() {
  const container = document.getElementById('backupFileList');
  let filteredFiles = currentDetailFiles;
  if (backupSearchQuery) {
    const q = backupSearchQuery.toLowerCase();
    filteredFiles = currentDetailFiles.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.relative_path || '').toLowerCase().includes(q)
    );
  }
  const infoEl = document.getElementById('backupFileFilterInfo');
  if (infoEl) {
    const changedCount = filteredFiles.filter(f => f.changed).length;
    infoEl.textContent = `显示 ${filteredFiles.length}/${currentDetailFiles.length} 个文件（${changedCount} 个已修改）`;
  }
  let html = `
    <div class="backup-file-header">
      <span class="backup-file-check"><input type="checkbox" id="checkAllBackupFiles" onchange="toggleSelectAllBackupFiles(this.checked)"></span>
      <span class="backup-file-name">文件名</span>
      <span class="backup-file-compare">备份时</span>
      <span class="backup-file-arrow">→</span>
      <span class="backup-file-compare">当前</span>
      <span class="backup-file-status">状态</span>
    </div>
  `;
  if (backupViewMode === 'folder') {
    const folders = groupFilesByFolder(filteredFiles);
    const folderNames = Object.keys(folders).sort();
    for (const folder of folderNames) {
      const files = folders[folder];
      const isExpanded = expandedFolders.has(folder);
      const changedInFolder = files.filter(f => f.changed).length;
      const folderKey = folder.replace(/[^a-zA-Z0-9]/g, '_');
      html += `
        <div class="backup-folder-group">
          <div class="backup-folder-header" onclick="toggleBackupFolder('${folderKey}')">
            <span class="folder-toggle">${isExpanded ? '▾' : '▸'}</span>
            <span class="folder-icon">📁</span>
            <span class="folder-name">${folder}</span>
            <span class="folder-count">${files.length} 个文件${changedInFolder > 0 ? ` (${changedInFolder} 已修改)` : ''}</span>
            <span class="folder-check" onclick="event.stopPropagation();">
              <input type="checkbox" id="folder_check_${folderKey}" onchange="toggleFolderFiles('${folderKey}', this.checked)">
            </span>
          </div>
      `;
      if (isExpanded) {
        for (const f of files) {
          html += renderBackupFileItem(f, f._index);
        }
      }
      html += `</div>`;
    }
  } else {
    for (let i = 0; i < filteredFiles.length; i++) {
      const f = filteredFiles[i];
      const originalIndex = currentDetailFiles.indexOf(f);
      html += renderBackupFileItem(f, originalIndex);
    }
  }
  container.innerHTML = html;
}

function renderBackupFileItem(f, index) {
  const statusClass = f.changed ? 'status-changed' : (f.current.exists ? 'status-unchanged' : 'status-missing');
  const statusText = f.changed ? '已修改' : (f.current.exists ? '未变化' : '已删除');
  const subPath = f.relative_path && f.relative_path !== f.name ? f.relative_path : '';
  return `
    <div class="backup-file-item">
      <span class="backup-file-check"><input type="checkbox" class="backup-file-checkbox" data-index="${index}" ${f.changed ? 'checked' : ''}></span>
      <span class="backup-file-name" title="${f.original_path}">
        ${f.name}
        ${subPath ? `<div class="file-sub-path">${subPath}</div>` : ''}
      </span>
      <span class="backup-file-compare">
        <div>${f.backup.width}x${f.backup.height}</div>
        <div class="file-size-text">${f.backup.size_formatted}</div>
        <div class="file-format-text">${f.backup.format}</div>
      </span>
      <span class="backup-file-arrow">→</span>
      <span class="backup-file-compare">
        <div>${f.current.exists ? f.current.width + 'x' + f.current.height : '-'}</div>
        <div class="file-size-text">${f.current.exists ? f.current.size_formatted : '-'}</div>
        <div class="file-format-text">${f.current.exists ? f.current.format : '-'}</div>
      </span>
      <span class="backup-file-status ${statusClass}">${statusText}</span>
    </div>
  `;
}

function toggleBackupFolder(folderKey) {
  const folders = groupFilesByFolder(currentDetailFiles);
  for (const folder of Object.keys(folders)) {
    const key = folder.replace(/[^a-zA-Z0-9]/g, '_');
    if (key === folderKey) {
      if (expandedFolders.has(folder)) {
        expandedFolders.delete(folder);
      } else {
        expandedFolders.add(folder);
      }
      break;
    }
  }
  renderBackupFileList();
}

function toggleFolderFiles(folderKey, checked) {
  const folders = groupFilesByFolder(currentDetailFiles);
  for (const folder of Object.keys(folders)) {
    const key = folder.replace(/[^a-zA-Z0-9]/g, '_');
    if (key === folderKey) {
      const files = folders[folder];
      for (const f of files) {
        const cb = document.querySelector(`.backup-file-checkbox[data-index="${f._index}"]`);
        if (cb) cb.checked = checked;
      }
      break;
    }
  }
}

function toggleBackupViewMode() {
  backupViewMode = backupViewMode === 'folder' ? 'flat' : 'folder';
  document.getElementById('btnViewMode').textContent = backupViewMode === 'folder' ? '文件夹视图' : '扁平视图';
  renderBackupFileList();
}

function filterBackupFiles(query) {
  backupSearchQuery = query.trim();
  renderBackupFileList();
}

function expandAllFolders() {
  const folders = groupFilesByFolder(currentDetailFiles);
  for (const folder of Object.keys(folders)) {
    expandedFolders.add(folder);
  }
  renderBackupFileList();
}

function collapseAllFolders() {
  expandedFolders.clear();
  renderBackupFileList();
}

function toggleSelectAllBackupFiles(checked) {
  const checkboxes = document.querySelectorAll('.backup-file-checkbox');
  checkboxes.forEach(cb => {
    if (checked === undefined) {
      cb.checked = !cb.checked;
    } else {
      cb.checked = checked;
    }
  });
}

async function rollbackSelectedFiles() {
  if (!currentDetailBackupId) return;
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  const checkboxes = document.querySelectorAll('.backup-file-checkbox:checked');
  if (checkboxes.length === 0) {
    log('请先选择要回滚的文件', 'warning');
    return;
  }
  if (!confirm(`确定要回滚选中的 ${checkboxes.length} 个文件吗？\n这将覆盖当前文件。`)) {
    return;
  }
  const filePaths = Array.from(checkboxes).map(cb => currentDetailFiles[parseInt(cb.dataset.index)].original_path);
  log(`正在回滚 ${filePaths.length} 个文件...`);
  const result = await window.ddsTool.rollbackFiles(baseDir, null, currentDetailBackupId, filePaths, true);
  log(`回滚完成: 成功 ${result.success}, 失败 ${result.failed}`,
    result.failed > 0 ? 'warning' : 'success');
  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      log(err, 'error');
    }
  }
  showBackupDetail(currentDetailBackupId);
}

function closeBackupDetail() {
  document.getElementById('backupDetailPanel').style.display = 'none';
  currentDetailBackupId = null;
  currentDetailFiles = [];
}

async function manualBackup() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) {
    log('请先选择工作目录', 'warning');
    return;
  }
  const processConfig = collectProcessConfig();
  const config = {
    ...processConfig,
    input_dir: baseDir,
    recursive: true,
    backup: false,
    dry_run: false,
  };
  log('正在创建手动备份...');
  const backup = await window.ddsTool.createBackup(config, '手动备份');
  if (backup) {
    log(`备份创建成功: ${backup.id} (${backup.file_count} 个文件)`, 'success');
    refreshBackups();
  } else {
    log('备份创建失败（可能没有超过尺寸上限的文件）', 'error');
  }
}

// 文件信息
let infoFiles = [];
let infoSortKey = 'name';
let infoSortAsc = true;
let infoSearchQuery = '';

async function selectInfoDir() {
  const dir = await window.ddsTool.selectDirectory('选择包含 DDS 的目录');
  if (dir) {
    document.getElementById('infoFilePath').value = dir;
  }
}

function openInfoFolder() {
  const p = document.getElementById('infoFilePath').value.trim();
  if (p) {
    const isFile = p.toLowerCase().endsWith('.dds');
    const target = isFile
      ? p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))
      : p;
    if (target) {
      window.ddsTool.openPath(target);
    } else {
      window.ddsTool.openPath(p);
    }
  } else {
    log('请先选择目录或文件', 'warning');
  }
}

async function scanInfoFiles() {
  const inputPath = document.getElementById('infoFilePath').value.trim();
  if (!inputPath) {
    log('请先选择目录或文件', 'warning');
    return;
  }
  log('正在扫描 DDS 文件...');
  const config = { input_dir: inputPath, recursive: true };
  const files = await window.ddsTool.scanFilesWithInfo(config);
  infoFiles = files;
  infoSortKey = 'name';
  infoSortAsc = true;
  infoSearchQuery = '';
  document.getElementById('infoSearch').value = '';
  if (files.length === 0) {
    log('没有找到 DDS 文件', 'warning');
    document.getElementById('infoStatsPanel').style.display = 'none';
    document.getElementById('infoListPanel').style.display = 'none';
    return;
  }
  renderInfoStats();
  renderInfoTable();
  log(`扫描完成，共 ${files.length} 个 DDS 文件`, 'success');
}

function renderInfoStats() {
  const panel = document.getElementById('infoStatsPanel');
  const container = document.getElementById('infoStats');
  const sizeGroups = {};
  const formatGroups = {};
  let totalSize = 0;
  let maxW = 0, maxH = 0;
  for (const f of infoFiles) {
    const sizeKey = `${f.width}x${f.height}`;
    sizeGroups[sizeKey] = (sizeGroups[sizeKey] || 0) + 1;
    formatGroups[f.format] = (formatGroups[f.format] || 0) + 1;
    totalSize += f.size;
    maxW = Math.max(maxW, f.width);
    maxH = Math.max(maxH, f.height);
  }
  const topSizes = Object.entries(sizeGroups).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topFormats = Object.entries(formatGroups).sort((a, b) => b[1] - a[1]);
  let html = `
    <div class="info-stat-card">
      <div class="info-stat-value">${infoFiles.length}</div>
      <div class="info-stat-label">文件总数</div>
    </div>
    <div class="info-stat-card">
      <div class="info-stat-value">${(totalSize / 1024 / 1024).toFixed(1)} MB</div>
      <div class="info-stat-label">总大小</div>
    </div>
    <div class="info-stat-card">
      <div class="info-stat-value">${maxW}x${maxH}</div>
      <div class="info-stat-label">最大尺寸</div>
    </div>
    <div class="info-stat-card">
      <div class="info-stat-value">${Object.keys(sizeGroups).length}</div>
      <div class="info-stat-label">尺寸种类</div>
    </div>
  `;
  html += `<div class="info-stat-card info-stat-wide">
    <div class="info-stat-label">尺寸分布（Top 5）</div>`;
  for (const [size, count] of topSizes) {
    const pct = (count / infoFiles.length * 100).toFixed(0);
    html += `<div class="info-stat-bar">
      <span class="info-stat-bar-label">${size}</span>
      <div class="info-stat-bar-track"><div class="info-stat-bar-fill" style="width:${pct}%"></div></div>
      <span class="info-stat-bar-count">${count} (${pct}%)</span>
    </div>`;
  }
  html += `</div>`;
  html += `<div class="info-stat-card info-stat-wide">
    <div class="info-stat-label">格式分布</div>`;
  for (const [fmt, count] of topFormats) {
    const pct = (count / infoFiles.length * 100).toFixed(0);
    html += `<div class="info-stat-bar">
      <span class="info-stat-bar-label">${fmt}</span>
      <div class="info-stat-bar-track"><div class="info-stat-bar-fill" style="width:${pct}%"></div></div>
      <span class="info-stat-bar-count">${count} (${pct}%)</span>
    </div>`;
  }
  html += `</div>`;
  container.innerHTML = html;
  panel.style.display = 'block';
}

function renderInfoTable() {
  const panel = document.getElementById('infoListPanel');
  const tbody = document.getElementById('infoTableBody');
  const countEl = document.getElementById('infoFileCount');
  let files = infoFiles;
  if (infoSearchQuery) {
    const q = infoSearchQuery.toLowerCase();
    files = files.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }
  files = [...files].sort((a, b) => {
    let va, vb;
    switch (infoSortKey) {
      case 'width': va = a.width * a.height; vb = b.width * b.height; break;
      case 'size': va = a.size; vb = b.size; break;
      case 'format': va = a.format; vb = b.format; break;
      case 'mipmaps': va = a.mipmaps || 0; vb = b.mipmaps || 0; break;
      default: va = a.name.toLowerCase(); vb = b.name.toLowerCase();
    }
    if (va < vb) return infoSortAsc ? -1 : 1;
    if (va > vb) return infoSortAsc ? 1 : -1;
    return 0;
  });
  countEl.textContent = `(显示 ${files.length}/${infoFiles.length} 个文件)`;
  if (files.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">没有匹配的文件</td></tr>';
    panel.style.display = 'block';
    return;
  }
  const maxDisplay = 500;
  const displayFiles = files.slice(0, maxDisplay);
  let html = '';
  for (const f of displayFiles) {
    const origIndex = infoFiles.indexOf(f);
    html += `
      <tr data-index="${origIndex}" style="cursor:pointer;">
        <td title="${f.path}">${f.name}</td>
        <td>${f.width}x${f.height}</td>
        <td>${f.format}</td>
        <td>${f.size_formatted}</td>
        <td>${f.mipmaps || '-'}</td>
      </tr>
    `;
  }
  if (files.length > maxDisplay) {
    html += `<tr><td colspan="5" style="text-align:center;padding:10px;color:var(--text-muted);">... 还有 ${files.length - maxDisplay} 个文件未显示</td></tr>`;
  }
  tbody.innerHTML = html;
  panel.style.display = 'block';
}

function sortInfoTable(key) {
  if (infoSortKey === key) {
    infoSortAsc = !infoSortAsc;
  } else {
    infoSortKey = key;
    infoSortAsc = true;
  }
  renderInfoTable();
}

function filterInfoList(query) {
  infoSearchQuery = query.trim();
  renderInfoTable();
}

function onInfoTableClick(event) {
  const tr = event.target.closest('tr[data-index]');
  if (tr) {
    const index = parseInt(tr.dataset.index);
    if (index >= 0 && index < infoFiles.length) {
      showInfoDetail(infoFiles[index].path);
    }
  }
}

async function showInfoDetail(filepath) {
  log(`正在解析: ${filepath}`);
  const info = await window.ddsTool.parseDds(filepath);
  const panel = document.getElementById('infoResultPanel');
  const container = document.getElementById('infoResult');
  if (!info) {
    panel.style.display = 'block';
    container.innerHTML = '<div class="empty-state"><p>无法解析该文件</p></div>';
    return;
  }
  const rows = [
    ['文件路径', info.filepath, false],
    ['文件大小', info.file_size_formatted, false],
    ['宽度', `${info.width} px`, true],
    ['高度', `${info.height} px`, true],
    ['像素总数', info.pixel_count.toLocaleString(), true],
    ['宽高比', info.aspect_ratio.toFixed(3), false],
    ['纹理格式', info.format, true],
    ['DXGI 格式代码', info.dxgi_format || 'N/A', true],
    ['FourCC', info.fourcc || 'N/A', true],
    ['DX10 扩展头', info.is_dx10 ? '是' : '否', false],
    ['Mipmap 级数', info.mipmaps || '无', false],
    ['深度', info.depth > 1 ? `${info.depth} (3D纹理)` : '1 (2D纹理)', false],
    ['立方体贴图', info.is_cubemap ? '是' : '否', false],
    ['纹理数组', info.is_array ? `是 (${info.array_size} 个元素)` : '否', false],
    ['头部大小', `${info.header_size} bytes`, false],
  ];
  let html = '';
  for (const [label, value, highlight] of rows) {
    html += `
      <div class="info-row">
        <span class="info-label">${label}</span>
        <span class="info-value ${highlight ? 'highlight' : ''}">${value}</span>
      </div>
    `;
  }
  container.innerHTML = html;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  log('解析完成', 'success');
}

function exportInfoCSV() {
  if (infoFiles.length === 0) {
    log('没有可导出的数据，请先扫描文件', 'warning');
    return;
  }
  const headers = ['文件名', '路径', '宽度', '高度', '尺寸', '格式', '大小(字节)', '大小', 'Mipmap'];
  const rows = infoFiles.map(f => [
    f.name, f.path, f.width, f.height, `${f.width}x${f.height}`,
    f.format, f.size, f.size_formatted, f.mipmaps || '',
  ]);
  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dds_info_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  log(`已导出 ${infoFiles.length} 个文件的信息到 CSV`, 'success');
}

// 备份管理
async function cleanOldBackups() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) {
    log('请先选择工作目录', 'warning');
    return;
  }
  const keepCount = parseInt(document.getElementById('keepCount').value) || 5;
  if (!confirm(`确定要清理旧备份吗？将只保留最新的 ${keepCount} 个备份点。`)) {
    return;
  }
  log(`正在清理旧备份（保留最新 ${keepCount} 个）...`);
  const deleted = await window.ddsTool.cleanBackups(baseDir, null, keepCount);
  log(`已清理 ${deleted} 个旧备份`, 'success');
  refreshBackups();
}

async function cleanAllBackups() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) {
    log('请先选择工作目录', 'warning');
    return;
  }
  if (!confirm('确定要删除所有备份吗？此操作不可恢复！')) {
    return;
  }
  const deleted = await window.ddsTool.cleanBackups(baseDir, null, 0);
  log(`已删除所有 ${deleted} 个备份`, 'success');
  closeBackupDetail();
  refreshBackups();
}

// 日志
function log(message, type = 'info', detail = null) {
  const container = document.getElementById('logContent');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  if (detail) {
    line.style.cursor = 'pointer';
    const summary = document.createElement('div');
    summary.className = 'log-summary';
    summary.innerHTML = `<span class="log-time">[${time}]</span>${escapeHtml(message)} <span class="log-expand-hint">▸</span>`;
    const detailDiv = document.createElement('div');
    detailDiv.className = 'log-detail';
    detailDiv.style.display = 'none';
    let detailHtml = '';
    if (detail.filepath) detailHtml += `<div><b>文件:</b> ${escapeHtml(detail.filepath)}</div>`;
    if (detail.error) detailHtml += `<div><b>错误:</b> ${escapeHtml(detail.error)}</div>`;
    if (detail.original_size) detailHtml += `<div><b>原始尺寸:</b> ${detail.original_size.width}x${detail.original_size.height}</div>`;
    if (detail.new_size) detailHtml += `<div><b>新尺寸:</b> ${detail.new_size.width}x${detail.new_size.height}</div>`;
    if (detail.new_format) detailHtml += `<div><b>格式:</b> ${escapeHtml(detail.new_format)}</div>`;
    for (const key in detail) {
      if (!['filepath', 'error', 'original_size', 'new_size', 'new_format'].includes(key)) {
        detailHtml += `<div><b>${escapeHtml(key)}:</b> ${escapeHtml(String(detail[key]))}</div>`;
      }
    }
    detailDiv.innerHTML = detailHtml;
    summary.addEventListener('click', () => {
      const isOpen = detailDiv.style.display === 'block';
      detailDiv.style.display = isOpen ? 'none' : 'block';
      summary.querySelector('.log-expand-hint').textContent = isOpen ? '▸' : '▾';
    });
    line.appendChild(summary);
    line.appendChild(detailDiv);
  } else {
    line.innerHTML = `<span class="log-time">[${time}]</span>${escapeHtml(message)}`;
  }
  container.appendChild(line);
  while (container.children.length > MAX_LOG_LINES) {
    container.removeChild(container.firstChild);
  }
  container.scrollTop = container.scrollHeight;
}

function clearLog() {
  document.getElementById('logContent').innerHTML = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 帮助弹窗
function showHelp() {
  document.getElementById('helpModal').style.display = 'flex';
}

function closeHelp() {
  document.getElementById('helpModal').style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

// 主题切换 / 语言选择 / 版本检查
const APP_VERSION = '1.9.0';
const GITHUB_REPO = 'linzhongyoumeng/dds-texture-tool';

const i18n = {
  zh: {
    appSubtitle: '通用 DDS 纹理批量处理工具 v' + APP_VERSION,
    tabProcess: '批量处理',
    tabBackup: '备份回滚',
    tabInfo: '文件信息',
  },
  en: {
    appSubtitle: 'Universal DDS Texture Batch Tool v' + APP_VERSION,
    tabProcess: 'Batch Process',
    tabBackup: 'Backup & Rollback',
    tabInfo: 'File Info',
  }
};

let currentLang = 'zh';
let currentTheme = 'dark';

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme();
  localStorage.setItem('dds_theme', currentTheme);
  log(`已切换到${currentTheme === 'dark' ? '黑夜' : '白天'}主题`, 'info');
}

function applyTheme() {
  if (currentTheme === 'light') {
    document.body.classList.add('theme-light');
    document.getElementById('themeIcon').innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    document.body.classList.remove('theme-light');
    document.getElementById('themeIcon').innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
}

function changeLanguage(lang) {
  currentLang = lang;
  applyTranslations();
  localStorage.setItem('dds_lang', lang);
  log(`语言已切换为${lang === 'zh' ? '中文' : 'English'}`, 'info');
}

function applyTranslations() {
  const dict = i18n[currentLang] || i18n.zh;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
}

async function checkUpdate() {
  log('正在检查更新...', 'info');
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!response.ok) {
      log('检查更新失败（可能尚未发布 Release）', 'warning');
      return;
    }
    const data = await response.json();
    const latestVersion = data.tag_name?.replace(/^v/, '') || data.name?.replace(/^v/, '');
    if (!latestVersion) {
      log('未找到最新版本信息', 'warning');
      return;
    }
    const current = APP_VERSION.split('.').map(Number);
    const latest = latestVersion.split('.').map(Number);
    let hasUpdate = false;
    for (let i = 0; i < Math.max(current.length, latest.length); i++) {
      if ((latest[i] || 0) > (current[i] || 0)) { hasUpdate = true; break; }
      if ((latest[i] || 0) < (current[i] || 0)) break;
    }
    if (hasUpdate) {
      log(`发现新版本 v${latestVersion}！当前版本 v${APP_VERSION}`, 'success');
      log(`下载地址: ${data.html_url}`, 'info');
    } else {
      log(`当前已是最新版本 v${APP_VERSION}`, 'success');
    }
  } catch (e) {
    log(`检查更新失败: ${e.message}`, 'error');
  }
}

(function initSettings() {
  const savedTheme = localStorage.getItem('dds_theme');
  if (savedTheme) currentTheme = savedTheme;
  applyTheme();
  const savedLang = localStorage.getItem('dds_lang');
  if (savedLang) {
    currentLang = savedLang;
    document.getElementById('langSelect').value = savedLang;
  }
  applyTranslations();
})();