/**
 * 扫描预览模块
 */

function updateScanProgress(completed, total) {
  if (!isScanning) return;
  const panel = document.getElementById('fileListPanel');
  const list = document.getElementById('fileList');
  const count = document.getElementById('fileCount');
  if (panel && panel.style.display !== 'block') panel.style.display = 'block';
  const percent = total > 0 ? Math.floor(completed / total * 100) : 0;
  if (count) count.textContent = `(扫描中 ${completed}/${total} - ${percent}%)`;
  if (list) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 20px;"><div style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">正在扫描 DDS 文件...</div><div class="progress-bar" style="width:300px;margin:0 auto;"><div class="progress-fill" style="width:${percent}%"></div></div><div style="font-size:12px;color:var(--text-muted);margin-top:8px;">${completed} / ${total} (${percent}%)</div></div>`;
  }
}

async function scanPreview() {
  const config = collectProcessConfig();
  if (!config.input_dir) { log('请先选择输入目录或文件', 'warning'); return; }
  if (isScanning) { log('正在扫描中，请稍候...', 'warning'); return; }
  isScanning = true;
  log('正在扫描文件...');
  const panel = document.getElementById('fileListPanel');
  const list = document.getElementById('fileList');
  const count = document.getElementById('fileCount');
  if (panel) panel.style.display = 'block';
  if (count) count.textContent = '(扫描中...)';
  if (list) list.innerHTML = `<div class="empty-state" style="padding:30px 20px;"><div style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">正在扫描 DDS 文件...</div><div class="progress-bar" style="width:300px;margin:0 auto;"><div class="progress-fill" style="width:0%"></div></div></div>`;
  let files;
  try { files = await window.ddsTool.scanFilesWithInfo(config); }
  catch (e) {
    isScanning = false;
    log(`扫描失败: ${e.message}`, 'error');
    if (list) list.innerHTML = `<div class="empty-state"><p style="color:var(--accent-error);">扫描失败: ${escapeHtml(e.message)}</p></div>`;
    if (count) count.textContent = '(扫描失败)';
    return;
  }
  isScanning = false;
  scannedFiles = files;
  try {
    const toProcess = files.filter(f => f.should_process).length;
    if (count) count.textContent = `(共 ${files.length} 个文件, ${toProcess} 个需处理)`;
    if (files.length === 0) { if (list) list.innerHTML = '<div class="empty-state"><p>没有找到符合条件的 DDS 文件</p></div>'; log('扫描完成，没有找到符合条件的 DDS 文件', 'warning'); return; }
    let html = `<div class="file-item file-item-header"><span class="file-check"><input type="checkbox" id="checkAllScanFiles" onchange="selectAllScanFiles(this.checked)" checked></span><span>文件名</span><span class="file-size">大小</span><span class="file-dim">尺寸</span><span class="file-fmt">格式</span><span class="file-status">状态</span></div>`;
    const inputDir = config.input_dir || '';
    const groups = {};
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; f._origIndex = i;
      let relPath = '';
      try { relPath = f.path.substring(inputDir.length).replace(/^[\\/]/, ''); } catch (e) { relPath = f.name; }
      const lastSep = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
      const folder = lastSep > 0 ? relPath.substring(0, lastSep) : '(根目录)';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(f);
    }
    const folderNames = Object.keys(groups).sort();
    for (const folder of folderNames) {
      const folderFiles = groups[folder];
      const folderToProcess = folderFiles.filter(f => f.should_process).length;
      const folderId = 'folder_' + folder.replace(/[^a-zA-Z0-9]/g, '_');
      html += `<div class="file-folder-header" onclick="toggleScanFolder('${folderId}')"><span class="folder-arrow" id="arrow_${folderId}">▼</span><span class="folder-check"><input type="checkbox" onclick="event.stopPropagation(); selectFolderFiles('${folderId}', this.checked)" ${folderToProcess > 0 ? 'checked' : ''}></span><span class="folder-name">${folder}</span><span class="folder-count">${folderFiles.length} 个文件 (${folderToProcess} 需处理)</span></div><div class="file-folder-content" id="${folderId}" style="display:block;">`;
      for (const f of folderFiles) {
        const statusClass = f.should_process ? 'status-changed' : 'status-unchanged';
        const statusText = f.should_process ? '需处理' : '跳过';
        html += `<div class="file-item"><span class="file-check"><input type="checkbox" class="scan-file-checkbox" data-index="${f._origIndex}" ${f.should_process ? 'checked' : ''}></span><span class="file-name" title="${f.path}">${f.name}</span><span class="file-size">${f.size_formatted}</span><span class="file-dim">${f.width}x${f.height}</span><span class="file-fmt">${f.format}</span><span class="file-status ${statusClass}">${statusText}</span></div>`;
      }
      html += `</div>`;
    }
    if (list) list.innerHTML = html;
    log(`扫描完成，找到 ${files.length} 个文件（${toProcess} 个需处理）`, 'success');
  } catch (e) {
    log(`渲染扫描结果失败: ${e.message}`, 'error');
    if (list) list.innerHTML = `<div class="empty-state"><p style="color:var(--accent-error);">渲染失败: ${escapeHtml(e.message)}</p></div>`;
    if (count) count.textContent = '(渲染失败)';
  }
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
    if (content.style.display === 'none') { content.style.display = 'block'; arrow.textContent = '▼'; }
    else { content.style.display = 'none'; arrow.textContent = '▶'; }
  }
}

function selectFolderFiles(folderId, checked) {
  const content = document.getElementById(folderId);
  if (content) { const checkboxes = content.querySelectorAll('.scan-file-checkbox'); checkboxes.forEach(cb => { cb.checked = checked; }); }
}

async function processSelectedFiles() {
  if (isProcessing) return;
  const checkboxes = document.querySelectorAll('.scan-file-checkbox:checked');
  if (checkboxes.length === 0) { log('请先勾选要处理的文件', 'warning'); return; }
  const selectedPaths = Array.from(checkboxes).map(cb => scannedFiles[parseInt(cb.dataset.index)].path);
  log(`已选择 ${selectedPaths.length} 个文件，开始处理...`);
  const config = collectProcessConfig();
  config.selected_files = selectedPaths;
  await startProcessWithConfig(config);
}

function expandAllScanFolders() {
  const contents = document.querySelectorAll('.file-folder-content');
  contents.forEach(c => c.style.display = 'block');
  const arrows = document.querySelectorAll('.folder-arrow');
  arrows.forEach(a => a.textContent = '▼');
}

function collapseAllScanFolders() {
  const contents = document.querySelectorAll('.file-folder-content');
  contents.forEach(c => c.style.display = 'none');
  const arrows = document.querySelectorAll('.folder-arrow');
  arrows.forEach(a => a.textContent = '▶');
}