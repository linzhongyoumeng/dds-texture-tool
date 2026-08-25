/**
 * 备份回滚模块
 */

async function selectRollbackDir() { const dir = await window.ddsTool.selectDirectory('选择工作目录'); if (dir) document.getElementById('rollbackBaseDir').value = dir; }
function openRollbackFolder() { const dir = document.getElementById('rollbackBaseDir').value.trim(); if (dir) window.ddsTool.openPath(dir); else log('请先选择工作目录', 'warning'); }

async function refreshBackups() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) { log('请先选择工作目录', 'warning'); return; }
  log('正在加载备份列表...');
  const data = await window.ddsTool.listBackups(baseDir, null);
  renderBackupList('backupList', data.backups, true);
  const totalSizeEl = document.getElementById('backupTotalSize');
  if (totalSizeEl) totalSizeEl.textContent = `(总占用 ${data.total_size_formatted})`;
  log(`加载完成，共 ${data.backups.length} 个备份点`, 'success');
}

function renderBackupList(containerId, backups, showRollback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (backups.length === 0) { container.innerHTML = '<div class="empty-state"><p>暂无备份点</p></div>'; return; }
  let html = '';
  for (const b of backups) {
    const date = new Date(b.timestamp); const dateStr = date.toLocaleString('zh-CN');
    html += `<div class="backup-item" onclick="showBackupDetail('${b.id}')" style="cursor:pointer;"><div class="backup-info"><div class="backup-id">${b.id} <span class="expand-hint">点击查看文件 →</span></div><div class="backup-meta"><span>📅 ${dateStr}</span><span>📁 ${b.file_count} 个文件</span><span>💾 ${b.total_size_formatted}</span></div><div class="backup-desc">${b.description || ''}</div></div><div class="backup-actions">${showRollback ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();rollbackBackup('${b.id}')">全部回滚</button>` : ''}<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();deleteBackupItem('${containerId}', '${b.id}')">删除</button></div></div>`;
  }
  container.innerHTML = html;
}

async function rollbackBackup(backupId) {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) return;
  if (!confirm(`确定要回滚到备份点 ${backupId} 吗？\n这将覆盖当前文件。`)) return;
  log(`正在回滚到 ${backupId}...`);
  const result = await window.ddsTool.rollback(baseDir, null, backupId, true);
  log(`回滚完成: 成功 ${result.success}, 失败 ${result.failed}`, result.failed > 0 ? 'warning' : 'success');
  if (result.errors && result.errors.length > 0) for (const err of result.errors) log(err, 'error');
}

async function deleteBackupItem(containerId, backupId) {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) { log('请先选择工作目录', 'warning'); return; }
  if (!confirm(`确定要删除备份点 ${backupId} 吗？此操作不可恢复。`)) return;
  log(`正在删除备份点: ${backupId}...`);
  const result = await window.ddsTool.deleteBackup(baseDir, null, backupId);
  const success = result === true || (result && result.success);
  if (success) { log(`已删除备份点: ${backupId}`, 'success'); if (currentDetailBackupId === backupId) closeBackupDetail(); refreshBackups(); }
  else log(`删除备份点失败: ${backupId}（可能文件被占用或路径无效）`, 'error');
}

async function showBackupDetail(backupId) {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) { log('请先选择工作目录', 'warning'); return; }
  currentDetailBackupId = backupId;
  log(`正在加载备份点 ${backupId} 的文件详情...`);
  const detail = await window.ddsTool.getBackupDetail(baseDir, null, backupId);
  if (!detail) { log('加载备份详情失败', 'error'); return; }
  currentDetailFiles = detail.files; backupSearchQuery = '';
  const searchInput = document.getElementById('backupFileSearch'); if (searchInput) searchInput.value = '';
  expandedFolders = new Set();
  const folders = groupFilesByFolder(detail.files);
  for (const folder of Object.keys(folders)) expandedFolders.add(folder);
  const detailPanel = document.getElementById('backupDetailPanel'); if (detailPanel) detailPanel.style.display = 'block';
  const detailTitle = document.getElementById('backupDetailTitle'); if (detailTitle) detailTitle.textContent = `${detail.id} (${detail.file_count} 个文件, ${detail.total_size_formatted})`;
  const viewModeBtn = document.getElementById('btnViewMode');
  if (viewModeBtn) { const dict = i18n[currentLang] || i18n.zh; viewModeBtn.textContent = backupViewMode === 'folder' ? dict.btnFolderView : dict.btnFlatView; }
  renderBackupFileList();
  log(`加载完成，共 ${detail.files.length} 个文件（${detail.files.filter(f => f.changed).length} 个已修改）`, 'success');
}

function groupFilesByFolder(files) {
  const folders = {};
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; const relPath = f.relative_path || f.name;
    const lastSep = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
    const folder = lastSep > 0 ? relPath.substring(0, lastSep) : '(根目录)';
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push({ ...f, _index: i });
  }
  return folders;
}

function renderBackupFileList() {
  const container = document.getElementById('backupFileList'); if (!container) return;
  let filteredFiles = currentDetailFiles;
  if (backupSearchQuery) { const q = backupSearchQuery.toLowerCase(); filteredFiles = currentDetailFiles.filter(f => f.name.toLowerCase().includes(q) || (f.relative_path || '').toLowerCase().includes(q)); }
  const infoEl = document.getElementById('backupFileFilterInfo');
  if (infoEl) { const changedCount = filteredFiles.filter(f => f.changed).length; infoEl.textContent = `显示 ${filteredFiles.length}/${currentDetailFiles.length} 个文件（${changedCount} 个已修改）`; }
  let html = `<div class="backup-file-header"><span class="backup-file-check"><input type="checkbox" id="checkAllBackupFiles" onchange="toggleSelectAllBackupFiles(this.checked)"></span><span class="backup-file-name">文件名</span><span class="backup-file-compare">备份时</span><span class="backup-file-arrow">→</span><span class="backup-file-compare">当前</span><span class="backup-file-status">状态</span></div>`;
  if (backupViewMode === 'folder') {
    const folders = groupFilesByFolder(filteredFiles); const folderNames = Object.keys(folders).sort();
    for (const folder of folderNames) {
      const files = folders[folder]; const isExpanded = expandedFolders.has(folder);
      const changedInFolder = files.filter(f => f.changed).length; const folderKey = folder.replace(/[^a-zA-Z0-9]/g, '_');
      html += `<div class="backup-folder-group"><div class="backup-folder-header" onclick="toggleFolder('${folderKey}')"><span class="folder-toggle">${isExpanded ? '▾' : '▸'}</span><span class="folder-icon">📁</span><span class="folder-name">${folder}</span><span class="folder-count">${files.length} 个文件${changedInFolder > 0 ? ` (${changedInFolder} 已修改)` : ''}</span><span class="folder-check" onclick="event.stopPropagation();"><input type="checkbox" id="folder_check_${folderKey}" onchange="toggleFolderFiles('${folderKey}', this.checked)"></span></div>`;
      if (isExpanded) for (const f of files) html += renderBackupFileItem(f, f._index);
      html += `</div>`;
    }
  } else { for (let i = 0; i < filteredFiles.length; i++) { const f = filteredFiles[i]; const originalIndex = currentDetailFiles.indexOf(f); html += renderBackupFileItem(f, originalIndex); } }
  container.innerHTML = html;
}

function renderBackupFileItem(f, index) {
  const statusClass = f.changed ? 'status-changed' : (f.current.exists ? 'status-unchanged' : 'status-missing');
  const statusText = f.changed ? '已修改' : (f.current.exists ? '未变化' : '已删除');
  const subPath = f.relative_path && f.relative_path !== f.name ? f.relative_path : '';
  return `<div class="backup-file-item"><span class="backup-file-check"><input type="checkbox" class="backup-file-checkbox" data-index="${index}" ${f.changed ? 'checked' : ''}></span><span class="backup-file-name" title="${f.original_path}">${f.name}${subPath ? `<div class="file-sub-path">${subPath}</div>` : ''}</span><span class="backup-file-compare"><div>${f.backup.width}x${f.backup.height}</div><div class="file-size-text">${f.backup.size_formatted}</div><div class="file-format-text">${f.backup.format}</div></span><span class="backup-file-arrow">→</span><span class="backup-file-compare"><div>${f.current.exists ? f.current.width + 'x' + f.current.height : '-'}</div><div class="file-size-text">${f.current.exists ? f.current.size_formatted : '-'}</div><div class="file-format-text">${f.current.exists ? f.current.format : '-'}</div></span><span class="backup-file-status ${statusClass}">${statusText}</span></div>`;
}

function toggleFolder(folderKey) {
  const folders = groupFilesByFolder(currentDetailFiles);
  for (const folder of Object.keys(folders)) {
    const key = folder.replace(/[^a-zA-Z0-9]/g, '_');
    if (key === folderKey) { if (expandedFolders.has(folder)) expandedFolders.delete(folder); else expandedFolders.add(folder); break; }
  }
  renderBackupFileList();
}

function toggleFolderFiles(folderKey, checked) {
  const folders = groupFilesByFolder(currentDetailFiles);
  for (const folder of Object.keys(folders)) {
    const key = folder.replace(/[^a-zA-Z0-9]/g, '_');
    if (key === folderKey) { const files = folders[folder]; for (const f of files) { const cb = document.querySelector(`.backup-file-checkbox[data-index="${f._index}"]`); if (cb) cb.checked = checked; } break; }
  }
}

function toggleBackupViewMode() { backupViewMode = backupViewMode === 'folder' ? 'flat' : 'folder'; const dict = i18n[currentLang] || i18n.zh; const btn = document.getElementById('btnViewMode'); if (btn) btn.textContent = backupViewMode === 'folder' ? dict.btnFolderView : dict.btnFlatView; renderBackupFileList(); }
function filterBackupFiles(query) { backupSearchQuery = query.trim(); renderBackupFileList(); }
function expandAllFolders() { const folders = groupFilesByFolder(currentDetailFiles); for (const folder of Object.keys(folders)) expandedFolders.add(folder); renderBackupFileList(); }
function collapseAllFolders() { expandedFolders.clear(); renderBackupFileList(); }

function toggleSelectAllBackupFiles(checked) {
  const checkboxes = document.querySelectorAll('.backup-file-checkbox');
  checkboxes.forEach(cb => { if (checked === undefined) cb.checked = !cb.checked; else cb.checked = checked; });
}

async function rollbackSelectedFiles() {
  if (!currentDetailBackupId) return;
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  const checkboxes = document.querySelectorAll('.backup-file-checkbox:checked');
  if (checkboxes.length === 0) { log('请先选择要回滚的文件', 'warning'); return; }
  if (!confirm(`确定要回滚选中的 ${checkboxes.length} 个文件吗？\n这将覆盖当前文件。`)) return;
  const filePaths = Array.from(checkboxes).map(cb => currentDetailFiles[parseInt(cb.dataset.index)].original_path);
  log(`正在回滚 ${filePaths.length} 个文件...`);
  const result = await window.ddsTool.rollbackFiles(baseDir, null, currentDetailBackupId, filePaths, true);
  log(`回滚完成: 成功 ${result.success}, 失败 ${result.failed}`, result.failed > 0 ? 'warning' : 'success');
  if (result.errors && result.errors.length > 0) for (const err of result.errors) log(err, 'error');
  showBackupDetail(currentDetailBackupId);
}

function closeBackupDetail() { const detailPanel = document.getElementById('backupDetailPanel'); if (detailPanel) detailPanel.style.display = 'none'; currentDetailBackupId = null; currentDetailFiles = []; }

async function manualBackup() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) { log('请先选择工作目录', 'warning'); return; }
  const processConfig = collectProcessConfig();
  const config = { ...processConfig, input_dir: baseDir, recursive: true, backup: false, dry_run: false };
  log('正在创建手动备份...');
  const backup = await window.ddsTool.createBackup(config, '手动备份');
  if (backup) { log(`备份创建成功: ${backup.id} (${backup.file_count} 个文件)`, 'success'); refreshBackups(); }
  else log('备份创建失败（可能没有超过尺寸上限的文件）', 'error');
}

async function cleanOldBackups() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) { log('请先选择工作目录', 'warning'); return; }
  const keepCount = parseInt(document.getElementById('keepCount').value) || 5;
  if (!confirm(`确定要清理旧备份吗？将只保留最新的 ${keepCount} 个备份点。`)) return;
  log(`正在清理旧备份（保留最新 ${keepCount} 个）...`);
  const deleted = await window.ddsTool.cleanBackups(baseDir, null, keepCount);
  log(`已清理 ${deleted} 个旧备份`, 'success');
  refreshBackups();
}

async function cleanAllBackups() {
  const baseDir = document.getElementById('rollbackBaseDir').value.trim();
  if (!baseDir) { log('请先选择工作目录', 'warning'); return; }
  if (!confirm('确定要删除所有备份吗？此操作不可恢复！')) return;
  const deleted = await window.ddsTool.cleanBackups(baseDir, null, 0);
  log(`已删除所有 ${deleted} 个备份`, 'success');
  closeBackupDetail();
  refreshBackups();
}