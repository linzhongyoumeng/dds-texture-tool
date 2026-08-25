/**
 * Electron 主进程
 * 窗口管理 + IPC 通信 + 核心业务逻辑
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const { DDSParser } = require('./src/dds-parser');
const { BackupManager } = require('./src/backup-manager');
const { FileScanner } = require('./src/file-scanner');
const { DDSProcessor } = require('./src/processor');

let mainWindow = null;
let currentProcessor = null;

const configPath = path.join(app.getPath('userData'), 'config.json');

function getBundledTexconvPath() {
  const bundledPath = path.join(process.resourcesPath, 'bin', 'texconv.exe');
  if (fs.existsSync(bundledPath)) return bundledPath;
  const devPath = path.join(__dirname, 'assets', 'bin', 'texconv.exe');
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

const defaultConfig = {
  texconv_path: '', input_dir: '', output_dir: '',
  max_width: 3072, max_height: 3072, align_to: 4, fit_mode: 'inside',
  target_format: '', force_format: false, srgb: 'auto', mipmaps: '',
  generate_mipmaps: false, threads: 4, dxt_quality: 'production',
  bc7_quality: 'production', recursive: true, backup: true, backup_dir: '',
  dry_run: false, window_bounds: null,
};

function loadConfig() {
  let config = { ...defaultConfig };
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config = { ...defaultConfig, ...data };
    }
  } catch (e) { console.error('加载配置失败:', e.message); }
  if (!config.texconv_path || !fs.existsSync(config.texconv_path)) {
    const bundled = getBundledTexconvPath();
    if (bundled) { config.texconv_path = bundled; config._using_bundled_texconv = true; }
  }
  return config;
}

function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) { console.error('保存配置失败:', e.message); }
}

function createWindow() {
  const config = loadConfig();
  mainWindow = new BrowserWindow({
    width: 1100, height: 750, minWidth: 900, minHeight: 600,
    title: 'DDS Texture Tool',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  if (config.window_bounds) { try { mainWindow.setBounds(config.window_bounds); } catch (e) {} }
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('resize', () => { const cfg = loadConfig(); cfg.window_bounds = mainWindow.getBounds(); saveConfig(cfg); });
  mainWindow.on('move', () => { const cfg = loadConfig(); cfg.window_bounds = mainWindow.getBounds(); saveConfig(cfg); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (event, config) => { const current = loadConfig(); saveConfig({ ...current, ...config }); return true; });
ipcMain.handle('select-texconv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择 texconv.exe', filters: [{ name: '可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }], properties: ['openFile'] });
  if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
  return null;
});
ipcMain.handle('select-directory', async (event, title = '选择目录') => {
  const result = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
  return null;
});
ipcMain.handle('select-dds-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择 DDS 文件', filters: [{ name: 'DDS 纹理', extensions: ['dds'] }, { name: '所有文件', extensions: ['*'] }], properties: ['openFile'] });
  if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
  return null;
});
ipcMain.handle('check-texconv', (event, texconvPath) => { if (!texconvPath) return false; try { return fs.existsSync(texconvPath); } catch (e) { return false; } });
ipcMain.handle('parse-dds', (event, filepath) => {
  const parser = new DDSParser();
  const info = parser.parse(filepath);
  if (info) info.file_size_formatted = DDSParser.formatSize(info.file_size);
  return info;
});
ipcMain.handle('scan-files', (event, config) => {
  const scanner = new FileScanner();
  const files = scanner.scan(config);
  return files.map(f => ({ path: f, name: path.basename(f), size: fs.existsSync(f) ? fs.statSync(f).size : 0, size_formatted: DDSParser.formatSize(fs.existsSync(f) ? fs.statSync(f).size : 0) }));
});
ipcMain.handle('scan-files-with-info', async (event, config) => {
  const parser = new DDSParser();
  const tempProcessor = new DDSProcessor(config, null, null);
  let files;
  const inputPath = config.input_dir || '.';
  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()) { files = [inputPath]; }
  else { const scanner = new FileScanner(); files = scanner.scan(config); }
  const total = files.length;
  const results = new Array(total);
  const BATCH_SIZE = 100;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, total);
    for (let j = i; j < end; j++) {
      const f = files[j];
      let fileSize = 0; try { fileSize = fs.statSync(f).size; } catch (e) {}
      let info = null; try { info = parser.parse(f); } catch (e) { console.error(`解析失败 ${f}:`, e.message); }
      let shouldProcess = false;
      if (info) { info.filepath = f; try { shouldProcess = tempProcessor.shouldProcess(info).need; } catch (e) { console.error(`shouldProcess 失败 ${f}:`, e.message); } }
      results[j] = { path: f, name: path.basename(f), size: fileSize, size_formatted: DDSParser.formatSize(fileSize), width: info?.width || 0, height: info?.height || 0, format: info?.format || 'UNKNOWN', mipmaps: info?.mipmaps || 0, should_process: shouldProcess };
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { completed: end, total });
    await new Promise(resolve => setImmediate(resolve));
  }
  return results;
});
ipcMain.handle('start-process', async (event, config) => {
  try {
    let filepaths;
    if (config.selected_files && config.selected_files.length > 0) { filepaths = config.selected_files.filter(f => fs.existsSync(f)); }
    else {
      const inputPath = config.input_dir || '.';
      if (fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()) { filepaths = [inputPath]; }
      else { const scanner = new FileScanner(); filepaths = scanner.scan(config); }
    }
    if (filepaths.length === 0) return { success: false, error: '没有找到符合条件的 DDS 文件', report: null };
    if (!config.dry_run && (!config.texconv_path || !fs.existsSync(config.texconv_path))) return { success: false, error: '未找到 texconv.exe，请先设置路径', report: null };
    const parser = new DDSParser();
    const tempProcessor = new DDSProcessor(config, null, null);
    const filesToProcess = [];
    let skippedCount = 0;
    for (const filepath of filepaths) {
      try {
        const info = parser.parse(filepath);
        if (!info) { skippedCount++; continue; }
        info.filepath = filepath;
        const { need } = tempProcessor.shouldProcess(info);
        if (need) filesToProcess.push(filepath); else skippedCount++;
      } catch (e) { skippedCount++; }
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process-log', `[扫描] 共 ${filepaths.length} 个文件，需处理 ${filesToProcess.length} 个，跳过 ${skippedCount} 个（尺寸未超限）`, 'info');
    if (filesToProcess.length === 0) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process-log', '[处理] 所有文件均未超过尺寸上限，无需处理', 'success');
      return { success: true, error: null, report: { total: filepaths.length, processed: 0, skipped: filepaths.length, failed: 0, duration: 0, backup_id: null, results: [] } };
    }
    let backupId = null;
    if (config.backup && !config.dry_run) {
      const backupMgr = new BackupManager(config.input_dir || '.', config.backup_dir || null);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process-log', `[备份] 正在备份 ${filesToProcess.length} 个文件（仅需处理的文件）...`);
      const backupPoint = await backupMgr.createBackup(filesToProcess, `自动备份 - 处理前 (${filesToProcess.length} 个文件)`, config, (completed, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) { const percent = Math.floor(completed / total * 100); if (percent % 10 === 0 || completed === total) mainWindow.webContents.send('process-log', `[备份] ${completed}/${total} (${percent}%)`); }
      });
      if (backupPoint) { backupId = backupPoint.id; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process-log', `[备份] 完成 - ${backupPoint.file_count} 个文件, ${BackupManager.formatSize(backupPoint.total_size)}, ID: ${backupId}`, 'success'); }
    }
    const maxW = config.max_width || 3072; const maxH = config.max_height || 3072;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (config.dry_run) mainWindow.webContents.send('process-log', `[预览] 开始预览，共 ${filepaths.length} 个文件（上限 ${maxW}x${maxH}）`);
      else mainWindow.webContents.send('process-log', `[处理] 开始处理，共 ${filepaths.length} 个文件（上限 ${maxW}x${maxH}，${config.threads || 1} 线程）`);
    }
    currentProcessor = new DDSProcessor(config,
      (completed, total, result) => { if (mainWindow && !mainWindow.isDestroyed()) { const adjustedCompleted = completed + skippedCount; const adjustedTotal = filepaths.length; mainWindow.webContents.send('process-progress', { completed: adjustedCompleted, total: adjustedTotal, result }); } },
      (message) => { if (mainWindow && !mainWindow.isDestroyed()) { let type = 'info'; if (message.startsWith('[失败]') || message.startsWith('[错误]')) type = 'error'; else if (message.startsWith('[完成]')) type = 'success'; else if (message.startsWith('[警告]') || message.startsWith('[备份]')) type = 'warning'; mainWindow.webContents.send('process-log', message, type); } }
    );
    const report = await currentProcessor.processBatch(filesToProcess, backupId);
    currentProcessor = null;
    report.total = filepaths.length; report.skipped += skippedCount;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const duration = report.duration.toFixed(1);
      if (config.dry_run) mainWindow.webContents.send('process-log', `[预览] 完成 - 需处理 ${report.processed} 个，跳过 ${report.skipped} 个，耗时 ${duration}s`, report.processed > 0 ? 'success' : 'info');
      else { const status = report.failed > 0 ? 'warning' : 'success'; mainWindow.webContents.send('process-log', `[处理] 完成 - 成功 ${report.processed}，跳过 ${report.skipped}，失败 ${report.failed}，耗时 ${duration}s`, status); if (backupId) mainWindow.webContents.send('process-log', `[回滚] 如需恢复，备份点 ID: ${backupId}（在"备份回滚"页面操作）`, 'info'); }
    }
    return { success: true, error: null, report };
  } catch (e) { currentProcessor = null; return { success: false, error: e.message, report: null }; }
});
ipcMain.handle('cancel-process', () => { if (currentProcessor) { currentProcessor.cancel(); return true; } return false; });
ipcMain.handle('list-backups', (event, baseDir, backupDir) => { const mgr = new BackupManager(baseDir || '.', backupDir || null); const backups = mgr.listBackups(); const totalSize = mgr.getTotalSize(); return { backups: backups.map(b => ({ ...b, total_size_formatted: BackupManager.formatSize(b.total_size) })), total_size: totalSize, total_size_formatted: BackupManager.formatSize(totalSize) }; });
ipcMain.handle('rollback', async (event, baseDir, backupDir, backupId, overwrite) => { const mgr = new BackupManager(baseDir || '.', backupDir || null); return await mgr.rollback(backupId, overwrite !== false, false); });
ipcMain.handle('get-backup-detail', (event, baseDir, backupDir, backupId) => { const mgr = new BackupManager(baseDir || '.', backupDir || null); return mgr.getBackupDetail(backupId); });
ipcMain.handle('rollback-files', async (event, baseDir, backupDir, backupId, filePaths, overwrite) => { const mgr = new BackupManager(baseDir || '.', backupDir || null); return await mgr.rollbackFiles(backupId, filePaths || [], overwrite !== false); });
ipcMain.handle('delete-backup', (event, baseDir, backupDir, backupId) => { const mgr = new BackupManager(baseDir || '.', backupDir || null); return mgr.deleteBackup(backupId); });
ipcMain.handle('clean-backups', (event, baseDir, backupDir, keepCount) => { const mgr = new BackupManager(baseDir || '.', backupDir || null); return mgr.cleanOldBackups(keepCount || 5); });
ipcMain.handle('create-backup', async (event, config, description) => {
  const scanner = new FileScanner(); const filepaths = scanner.scan(config);
  if (filepaths.length === 0) return null;
  const parser = new DDSParser(); const tempProcessor = new DDSProcessor(config, null, null); const filesToBackup = [];
  for (const filepath of filepaths) { try { const info = parser.parse(filepath); if (!info) continue; info.filepath = filepath; const { need } = tempProcessor.shouldProcess(info); if (need) filesToBackup.push(filepath); } catch (e) {} }
  if (filesToBackup.length === 0) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process-log', '[备份] 所有文件均未超过尺寸上限，无需备份', 'info'); return null; }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process-log', `[备份] 共扫描 ${filepaths.length} 个文件，备份 ${filesToBackup.length} 个需处理的文件`, 'info');
  const mgr = new BackupManager(config.input_dir || '.', config.backup_dir || null);
  return await mgr.createBackup(filesToBackup, description || '手动备份', config);
});
ipcMain.handle('open-external', (event, url) => { shell.openExternal(url); });
ipcMain.handle('show-in-folder', (event, filepath) => { shell.showItemInFolder(filepath); });
ipcMain.handle('open-path', (event, dirpath) => { if (dirpath && fs.existsSync(dirpath)) { shell.openPath(dirpath); return true; } return false; });

app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });