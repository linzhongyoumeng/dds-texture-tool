/**
 * 文件信息模块
 */

async function selectInfoDir() { const dir = await window.ddsTool.selectDirectory('选择包含 DDS 的目录'); if (dir) document.getElementById('infoFilePath').value = dir; }
async function selectInfoFile() { const file = await window.ddsTool.selectDdsFile(); if (file) document.getElementById('infoFilePath').value = file; }

function openInfoFolder() {
  const p = document.getElementById('infoFilePath').value.trim();
  if (p) {
    const isFile = p.toLowerCase().endsWith('.dds');
    const target = isFile ? p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))) : p;
    if (target) window.ddsTool.openPath(target); else window.ddsTool.openPath(p);
  } else log('请先选择目录或文件', 'warning');
}

async function scanInfoFiles() {
  const inputPath = document.getElementById('infoFilePath').value.trim();
  if (!inputPath) { log('请先选择目录或文件', 'warning'); return; }
  log('正在扫描 DDS 文件...');
  const config = { input_dir: inputPath, recursive: true };
  const files = await window.ddsTool.scanFilesWithInfo(config);
  infoFiles = files; infoSortKey = 'name'; infoSortAsc = true; infoSearchQuery = '';
  const searchInput = document.getElementById('infoSearch'); if (searchInput) searchInput.value = '';
  if (files.length === 0) {
    log('没有找到 DDS 文件', 'warning');
    const statsPanel = document.getElementById('infoStatsPanel'); const listPanel = document.getElementById('infoListPanel');
    if (statsPanel) statsPanel.style.display = 'none'; if (listPanel) listPanel.style.display = 'none';
    return;
  }
  renderInfoStats(); renderInfoTable();
  log(`扫描完成，共 ${files.length} 个 DDS 文件`, 'success');
}

function renderInfoStats() {
  const panel = document.getElementById('infoStatsPanel'); const container = document.getElementById('infoStats');
  if (!panel || !container) return;
  const sizeGroups = {}; const formatGroups = {}; let totalSize = 0; let maxW = 0, maxH = 0;
  for (const f of infoFiles) {
    const sizeKey = `${f.width}x${f.height}`; sizeGroups[sizeKey] = (sizeGroups[sizeKey] || 0) + 1;
    formatGroups[f.format] = (formatGroups[f.format] || 0) + 1; totalSize += f.size;
    maxW = Math.max(maxW, f.width); maxH = Math.max(maxH, f.height);
  }
  const topSizes = Object.entries(sizeGroups).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topFormats = Object.entries(formatGroups).sort((a, b) => b[1] - a[1]);
  let html = `<div class="info-stat-card"><div class="info-stat-value">${infoFiles.length}</div><div class="info-stat-label">文件总数</div></div><div class="info-stat-card"><div class="info-stat-value">${(totalSize / 1024 / 1024).toFixed(1)} MB</div><div class="info-stat-label">总大小</div></div><div class="info-stat-card"><div class="info-stat-value">${maxW}x${maxH}</div><div class="info-stat-label">最大尺寸</div></div><div class="info-stat-card"><div class="info-stat-value">${Object.keys(sizeGroups).length}</div><div class="info-stat-label">尺寸种类</div></div>`;
  html += `<div class="info-stat-card info-stat-wide"><div class="info-stat-label">尺寸分布（Top 5）</div>`;
  for (const [size, count] of topSizes) { const pct = (count / infoFiles.length * 100).toFixed(0); html += `<div class="info-stat-bar"><span class="info-stat-bar-label">${size}</span><div class="info-stat-bar-track"><div class="info-stat-bar-fill" style="width:${pct}%"></div></div><span class="info-stat-bar-count">${count} (${pct}%)</span></div>`; }
  html += `</div>`;
  html += `<div class="info-stat-card info-stat-wide"><div class="info-stat-label">格式分布</div>`;
  for (const [fmt, count] of topFormats) { const pct = (count / infoFiles.length * 100).toFixed(0); html += `<div class="info-stat-bar"><span class="info-stat-bar-label">${fmt}</span><div class="info-stat-bar-track"><div class="info-stat-bar-fill" style="width:${pct}%"></div></div><span class="info-stat-bar-count">${count} (${pct}%)</span></div>`; }
  html += `</div>`;
  container.innerHTML = html; panel.style.display = 'block';
}

function renderInfoTable() {
  const panel = document.getElementById('infoListPanel'); const tbody = document.getElementById('infoTableBody'); const countEl = document.getElementById('infoFileCount');
  if (!panel || !tbody) return;
  let files = infoFiles;
  if (infoSearchQuery) { const q = infoSearchQuery.toLowerCase(); files = files.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)); }
  files = [...files].sort((a, b) => {
    let va, vb;
    switch (infoSortKey) { case 'width': va = a.width * a.height; vb = b.width * b.height; break; case 'size': va = a.size; vb = b.size; break; case 'format': va = a.format; vb = b.format; break; case 'mipmaps': va = a.mipmaps || 0; vb = b.mipmaps || 0; break; default: va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    if (va < vb) return infoSortAsc ? -1 : 1; if (va > vb) return infoSortAsc ? 1 : -1; return 0;
  });
  if (countEl) countEl.textContent = `(显示 ${files.length}/${infoFiles.length} 个文件)`;
  if (files.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">没有匹配的文件</td></tr>'; panel.style.display = 'block'; return; }
  const displayFiles = files;
  let html = '';
  for (const f of displayFiles) {
    const origIndex = infoFiles.indexOf(f);
    html += `<tr data-index="${origIndex}" style="cursor:pointer;"><td title="${f.path}">${f.name}</td><td>${f.width}x${f.height}</td><td>${f.format}</td><td>${f.size_formatted}</td><td>${f.mipmaps || '-'}</td></tr>`;
  }
  tbody.innerHTML = html; panel.style.display = 'block';
}

function sortInfoTable(key) { if (infoSortKey === key) infoSortAsc = !infoSortAsc; else { infoSortKey = key; infoSortAsc = true; } renderInfoTable(); }
function filterInfoList(query) { infoSearchQuery = query.trim(); renderInfoTable(); }
function onInfoTableClick(event) { const tr = event.target.closest('tr[data-index]'); if (tr) { const index = parseInt(tr.dataset.index); if (index >= 0 && index < infoFiles.length) showInfoDetail(infoFiles[index].path); } }

async function showInfoDetail(filepath) {
  log(`正在解析: ${filepath}`);
  const info = await window.ddsTool.parseDds(filepath);
  const panel = document.getElementById('infoResultPanel'); const container = document.getElementById('infoResult');
  if (!panel || !container) return;
  if (!info) { panel.style.display = 'block'; container.innerHTML = '<div class="empty-state"><p>无法解析该文件</p></div>'; return; }
  const rows = [['文件路径', info.filepath, false], ['文件大小', info.file_size_formatted, false], ['宽度', `${info.width} px`, true], ['高度', `${info.height} px`, true], ['像素总数', info.pixel_count.toLocaleString(), true], ['宽高比', info.aspect_ratio.toFixed(3), false], ['纹理格式', info.format, true], ['DXGI 格式代码', info.dxgi_format || 'N/A', true], ['FourCC', info.fourcc || 'N/A', true], ['DX10 扩展头', info.is_dx10 ? '是' : '否', false], ['Mipmap 级数', info.mipmaps || '无', false], ['深度', info.depth > 1 ? `${info.depth} (3D纹理)` : '1 (2D纹理)', false], ['立方体贴图', info.is_cubemap ? '是' : '否', false], ['纹理数组', info.is_array ? `是 (${info.array_size} 个元素)` : '否', false], ['头部大小', `${info.header_size} bytes`, false]];
  let html = '';
  for (const [label, value, highlight] of rows) html += `<div class="info-row"><span class="info-label">${label}</span><span class="info-value ${highlight ? 'highlight' : ''}">${value}</span></div>`;
  container.innerHTML = html; panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  log('解析完成', 'success');
}