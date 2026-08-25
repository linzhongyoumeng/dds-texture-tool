/**
 * Electron 主进程
 * 窗口管理 + IPC 通信 + 核心业务逻辑
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const { DDSParser } = require('./src/dds-parser');
const { BackupManager } = require('./src/backup-manager');
const { FileScanner } = require('./src/file-scanner');
const { DDSProcessor } = require('./src/processor');
const { ProDDSProcessor } = require('./src/pro-processor');

let mainWindow = null;
let currentProcessor = null;
let currentProProcessor = null;

// 配置文件路径
const configPath = path.join(app.getPath('userData'), 'config.json');

/**
 * 获取打包内置的 texconv.exe 路径
 * 打包后在 resources/bin/texconv.exe，开发模式在 assets/bin/texconv.exe
 */
function getBundledTexconvPath() {
  // 生产环境：electron-builder 打包后 extraResources 在 process.resourcesPath
  const bundledPath = path.join(process.resourcesPath, 'bin', 'texconv.exe');
  if (fs.existsSync(bundledPath)) return bundledPath;

  // 开发环境：项目目录下的 assets/bin/texconv.exe
  const devPath = path.join(__dirname, 'assets', 'bin', 'texconv.exe');
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

// 默认配置
const defaultConfig = {
  texconv_path: '',
  input_dir: '',
  output_dir: '',
  max_width: 3072,
  max_height: 3072,
  align_to: 4,
  fit_mode: 'inside',
  target_format: '',
  force_format: false,
  srgb: 'auto',
  mipmaps: '',
  generate_mipmaps: false,
  threads: 4,
  dxt_quality: 'production',
  bc7_quality: 'production',
  recursive: true,
  backup: true,
  backup_dir: '',
  dry_run: false,
  window_bounds: null,
};

// 加载配置
function loadConfig() {
  let config = { ...defaultConfig };
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config = { ...defaultConfig, ...data };
    }
  } catch (e) {
    console.error('加载配置失败:', e.message);
  }

  // 如果用户没有手动设置 texconv_path，自动使用打包内置的
  if (!config.texconv_path || !fs.existsSync(config.texconv_path)) {
    const bundled = getBundledTexconvPath();
    if (bundled) {
      config.texconv_path = bundled;
      config._using_bundled_texconv = true;
    }
  }

  return config;
}

// 保存配置
function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存配置失败:', e.message);
  }
}

// 创建主窗口
function createWindow() {
  const config = loadConfig();

  // 优先使用外部assets目录中的图标（用户可见），回退到app.asar中的图标
  let windowIcon = path.join(__dirname, 'assets', 'icon.png');
  const externalIconPath = path.join(process.resourcesPath, '..', 'assets', 'icon.ico');
  if (fs.existsSync(externalIconPath)) {
    windowIcon = externalIconPath;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'DDS Texture Tool',
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 恢复窗口位置
  if (config.window_bounds) {
    try { mainWindow.setBounds(config.window_bounds); } catch (e) {}
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 保存窗口位置
  mainWindow.on('resize', () => {
    const cfg = loadConfig();
    cfg.window_bounds = mainWindow.getBounds();
    saveConfig(cfg);
  });
  mainWindow.on('move', () => {
    const cfg = loadConfig();
    cfg.window_bounds = mainWindow.getBounds();
    saveConfig(cfg);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================
// IPC 处理函数
// ============================================================

// 获取配置
ipcMain.handle('get-config', () => {
  return loadConfig();
});

// 保存配置
ipcMain.handle('save-config', (event, config) => {
  const current = loadConfig();
  const merged = { ...current, ...config };
  saveConfig(merged);
  return true;
});

// 选择文件（texconv）
ipcMain.handle('select-texconv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 texconv.exe',
    filters: [{ name: '可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 选择目录
ipcMain.handle('select-directory', async (event, title = '选择目录') => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 选择 DDS 文件
ipcMain.handle('select-dds-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 DDS 文件',
    filters: [{ name: 'DDS 纹理', extensions: ['dds'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 检查 texconv 是否可用
ipcMain.handle('check-texconv', (event, texconvPath) => {
  if (!texconvPath) return false;
  try {
    return fs.existsSync(texconvPath);
  } catch (e) {
    return false;
  }
});

// 解析 DDS 文件信息
ipcMain.handle('parse-dds', (event, filepath) => {
  const parser = new DDSParser();
  const info = parser.parse(filepath);
  if (info) {
    info.file_size_formatted = DDSParser.formatSize(info.file_size);
  }
  return info;
});

// 扫描文件
ipcMain.handle('scan-files', (event, config) => {
  const scanner = new FileScanner();
  const files = scanner.scan(config);
  return files.map(f => ({
    path: f,
    name: path.basename(f),
    size: fs.existsSync(f) ? fs.statSync(f).size : 0,
    size_formatted: DDSParser.formatSize(fs.existsSync(f) ? fs.statSync(f).size : 0),
  }));
});

// 扫描并解析文件（带详细信息）- 异步分批，带进度
ipcMain.handle('scan-files-with-info', async (event, config) => {
  const parser = new DDSParser();
  const tempProcessor = new DDSProcessor(config, null, null);

  // 支持单文件输入
  let files;
  const inputPath = config.input_dir || '.';
  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()) {
    files = [inputPath];
  } else {
    const scanner = new FileScanner();
    files = scanner.scan(config);
  }

  const total = files.length;
  const results = new Array(total);
  const BATCH_SIZE = 100;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, total);
    for (let j = i; j < end; j++) {
      const f = files[j];
      let fileSize = 0;
      try { fileSize = fs.statSync(f).size; } catch (e) {}
      let info = null;
      try {
        info = parser.parse(f);
      } catch (e) {
        console.error(`解析失败 ${f}:`, e.message);
      }
      let shouldProcess = false;
      if (info) {
        info.filepath = f;
        try {
          shouldProcess = tempProcessor.shouldProcess(info).need;
        } catch (e) {
          console.error(`shouldProcess 失败 ${f}:`, e.message);
        }
      }
      results[j] = {
        path: f,
        name: path.basename(f),
        size: fileSize,
        size_formatted: DDSParser.formatSize(fileSize),
        width: info?.width || 0,
        height: info?.height || 0,
        format: info?.format || 'UNKNOWN',
        mipmaps: info?.mipmaps || 0,
        should_process: shouldProcess,
      };
    }
    // 发送进度
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan-progress', { completed: end, total });
    }
    // 让出事件循环，避免 UI 卡死
    await new Promise(resolve => setImmediate(resolve));
  }

  return results;
});

// 开始处理
ipcMain.handle('start-process', async (event, config) => {
  try {
    let filepaths;

    // 如果指定了选中的文件列表，直接使用
    if (config.selected_files && config.selected_files.length > 0) {
      filepaths = config.selected_files.filter(f => fs.existsSync(f));
    } else {
      // 扫描文件（支持输入是单个文件）
      const inputPath = config.input_dir || '.';
      if (fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()) {
        // 单文件模式
        filepaths = [inputPath];
      } else {
        // 目录模式
        const scanner = new FileScanner();
        filepaths = scanner.scan(config);
      }
    }

    if (filepaths.length === 0) {
      return { success: false, error: '没有找到符合条件的 DDS 文件', report: null };
    }

    // 检查 texconv
    if (!config.dry_run) {
      if (!config.texconv_path || !fs.existsSync(config.texconv_path)) {
        return { success: false, error: '未找到 texconv.exe，请先设置路径', report: null };
      }
    }

    // 预扫描：解析所有文件尺寸，过滤出真正需要处理的文件
    // 只备份需要处理的文件，避免浪费时间和空间
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
        if (need) {
          filesToProcess.push(filepath);
        } else {
          skippedCount++;
        }
      } catch (e) {
        skippedCount++;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-log',
        `[扫描] 共 ${filepaths.length} 个文件，需处理 ${filesToProcess.length} 个，跳过 ${skippedCount} 个（尺寸未超限）`, 'info');
    }

    // 如果没有需要处理的文件，直接返回
    if (filesToProcess.length === 0) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-log', '[处理] 所有文件均未超过尺寸上限，无需处理', 'success');
      }
      return {
        success: true,
        error: null,
        report: {
          total: filepaths.length,
          processed: 0,
          skipped: filepaths.length,
          failed: 0,
          duration: 0,
          backup_id: null,
          results: [],
        }
      };
    }

    // 创建备份（只备份需要处理的文件，异步带进度）
    let backupId = null;
    if (config.backup && !config.dry_run) {
      const backupMgr = new BackupManager(config.input_dir || '.', config.backup_dir || null);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-log', `[备份] 正在备份 ${filesToProcess.length} 个文件（仅需处理的文件）...`);
      }
      const backupPoint = await backupMgr.createBackup(
        filesToProcess,
        `自动备份 - 处理前 (${filesToProcess.length} 个文件)`,
        config,
        (completed, total) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const percent = Math.floor(completed / total * 100);
            if (percent % 10 === 0 || completed === total) {
              mainWindow.webContents.send('process-log', `[备份] ${completed}/${total} (${percent}%)`);
            }
          }
        }
      );
      if (backupPoint) {
        backupId = backupPoint.id;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-log',
            `[备份] 完成 - ${backupPoint.file_count} 个文件, ${BackupManager.formatSize(backupPoint.total_size)}, ID: ${backupId}`, 'success');
        }
      }
    }

    // 处理开始日志
    const maxW = config.max_width || 3072;
    const maxH = config.max_height || 3072;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (config.dry_run) {
        mainWindow.webContents.send('process-log', `[预览] 开始预览，共 ${filepaths.length} 个文件（上限 ${maxW}x${maxH}）`);
      } else {
        mainWindow.webContents.send('process-log', `[处理] 开始处理，共 ${filepaths.length} 个文件（上限 ${maxW}x${maxH}，${config.threads || 1} 线程）`);
      }
    }

    // 创建处理器
    currentProcessor = new DDSProcessor(config,
      (completed, total, result) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // 调整进度：completed 加上预扫描跳过的数量，total 用总文件数
          // 这样进度条显示的总数和开始日志一致
          const adjustedCompleted = completed + skippedCount;
          const adjustedTotal = filepaths.length;
          mainWindow.webContents.send('process-progress', { completed: adjustedCompleted, total: adjustedTotal, result });
        }
      },
      (message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // 根据前缀自动判断日志类型
          let type = 'info';
          if (message.startsWith('[失败]') || message.startsWith('[错误]')) type = 'error';
          else if (message.startsWith('[完成]')) type = 'success';
          else if (message.startsWith('[警告]') || message.startsWith('[备份]')) type = 'warning';
          mainWindow.webContents.send('process-log', message, type);
        }
      }
    );

    // 只处理真正需要处理的文件（避免不备份时误操作小文件）
    const report = await currentProcessor.processBatch(filesToProcess, backupId);
    currentProcessor = null;

    // 调整统计：total 是总扫描数，skipped 加上预扫描跳过的
    report.total = filepaths.length;
    report.skipped += skippedCount;

    // 处理完成日志
    if (mainWindow && !mainWindow.isDestroyed()) {
      const duration = report.duration.toFixed(1);
      if (config.dry_run) {
        mainWindow.webContents.send('process-log',
          `[预览] 完成 - 需处理 ${report.processed} 个，跳过 ${report.skipped} 个，耗时 ${duration}s`,
          report.processed > 0 ? 'success' : 'info');
      } else {
        const status = report.failed > 0 ? 'warning' : 'success';
        mainWindow.webContents.send('process-log',
          `[处理] 完成 - 成功 ${report.processed}，跳过 ${report.skipped}，失败 ${report.failed}，耗时 ${duration}s`,
          status);
        if (backupId) {
          mainWindow.webContents.send('process-log',
            `[回滚] 如需恢复，备份点 ID: ${backupId}（在"备份回滚"页面操作）`, 'info');
        }
      }
    }

    return { success: true, error: null, report };
  } catch (e) {
    currentProcessor = null;
    return { success: false, error: e.message, report: null };
  }
});

// 取消处理
ipcMain.handle('cancel-process', () => {
  if (currentProcessor) {
    currentProcessor.cancel();
    return true;
  }
  return false;
});

// 列出备份点
ipcMain.handle('list-backups', (event, baseDir, backupDir) => {
  const mgr = new BackupManager(baseDir || '.', backupDir || null);
  const backups = mgr.listBackups();
  const totalSize = mgr.getTotalSize();
  return {
    backups: backups.map(b => ({
      ...b,
      total_size_formatted: BackupManager.formatSize(b.total_size),
    })),
    total_size: totalSize,
    total_size_formatted: BackupManager.formatSize(totalSize),
  };
});

// 回滚
ipcMain.handle('rollback', async (event, baseDir, backupDir, backupId, overwrite) => {
  const mgr = new BackupManager(baseDir || '.', backupDir || null);
  return await mgr.rollback(backupId, overwrite !== false, false);
});

// 获取备份点详细信息（含文件对比）
ipcMain.handle('get-backup-detail', (event, baseDir, backupDir, backupId) => {
  const mgr = new BackupManager(baseDir || '.', backupDir || null);
  return mgr.getBackupDetail(backupId);
});

// 回滚指定文件列表（单文件回滚）
ipcMain.handle('rollback-files', async (event, baseDir, backupDir, backupId, filePaths, overwrite) => {
  const mgr = new BackupManager(baseDir || '.', backupDir || null);
  return await mgr.rollbackFiles(backupId, filePaths || [], overwrite !== false);
});

// 删除备份
ipcMain.handle('delete-backup', (event, baseDir, backupDir, backupId) => {
  const mgr = new BackupManager(baseDir || '.', backupDir || null);
  return mgr.deleteBackup(backupId);
});

// 清理旧备份
ipcMain.handle('clean-backups', (event, baseDir, backupDir, keepCount) => {
  const mgr = new BackupManager(baseDir || '.', backupDir || null);
  // keepCount 可以为 0（删除所有备份），所以不能用 || 5
  const count = (keepCount !== undefined && keepCount !== null) ? keepCount : 5;
  return mgr.cleanOldBackups(count);
});

// 手动备份（只备份需要处理的文件，和自动备份保持一致）
ipcMain.handle('create-backup', async (event, config, description) => {
  const scanner = new FileScanner();
  const filepaths = scanner.scan(config);
  if (filepaths.length === 0) return null;

  // 预扫描：只备份需要处理的文件
  const parser = new DDSParser();
  const tempProcessor = new DDSProcessor(config, null, null);
  const filesToBackup = [];
  for (const filepath of filepaths) {
    try {
      const info = parser.parse(filepath);
      if (!info) continue;
      info.filepath = filepath;
      const { need } = tempProcessor.shouldProcess(info);
      if (need) filesToBackup.push(filepath);
    } catch (e) {}
  }

  if (filesToBackup.length === 0) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-log',
        `[备份] 所有文件均未超过尺寸上限，无需备份`, 'info');
    }
    return null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process-log',
      `[备份] 共扫描 ${filepaths.length} 个文件，备份 ${filesToBackup.length} 个需处理的文件`, 'info');
  }

  const mgr = new BackupManager(config.input_dir || '.', config.backup_dir || null);
  return await mgr.createBackup(filesToBackup, description || '手动备份', config);
});

// 打开外部链接
ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

// 打开文件所在目录
ipcMain.handle('show-in-folder', (event, filepath) => {
  shell.showItemInFolder(filepath);
});

// 打开目录
ipcMain.handle('open-path', (event, dirpath) => {
  if (dirpath && fs.existsSync(dirpath)) {
    shell.openPath(dirpath);
    return true;
  }
  return false;
});

// 命令模式：列出指定目录下的备份
ipcMain.handle('list-cmd-backups', async (event, inputDir) => {
  try {
    const { BackupManager } = require('./src/backup-manager');
    
    // 如果是文件，使用文件所在目录
    let baseDir = inputDir;
    if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile()) {
      baseDir = path.dirname(inputDir);
    }
    
    const backupRoot = path.join(baseDir, '.dds_tool_backup');
    
    if (!fs.existsSync(backupRoot)) {
      return [];
    }
    
    const backups = [];
    const dirs = fs.readdirSync(backupRoot).filter(f => f.startsWith('backup_'));
    
    for (const dir of dirs) {
      const backupPath = path.join(backupRoot, dir);
      const metaPath = path.join(backupPath, 'backup_meta.json');
      
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          backups.push({
            id: dir,
            timestamp: meta.timestamp || meta.created_at || dir,
            file_count: meta.file_count || meta.files?.length || 0,
            description: meta.description || '命令模式备份',
            source: meta.source || 'cmd_mode',
          });
        } catch (e) {
          // 元数据读取失败，跳过
        }
      } else {
        // 没有元数据，计算文件数量
        let fileCount = 0;
        try {
          const filesDir = path.join(backupPath, 'files');
          if (fs.existsSync(filesDir)) {
            fileCount = countFiles(filesDir);
          }
        } catch (e) {}
        
        backups.push({
          id: dir,
          timestamp: dir,
          file_count: fileCount,
          description: '命令模式备份',
          source: 'unknown',
        });
      }
    }
    
    // 按时间倒序排列
    backups.sort((a, b) => b.id.localeCompare(a.id));
    return backups;
  } catch (e) {
    console.error('列出备份失败:', e);
    return [];
  }
});

// 命令模式：回滚指定备份
ipcMain.handle('rollback-cmd-backup', async (event, inputDir, backupId) => {
  try {
    const { BackupManager } = require('./src/backup-manager');
    
    // 如果是文件，使用文件所在目录
    let baseDir = inputDir;
    if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile()) {
      baseDir = path.dirname(inputDir);
    }
    
    const bm = new BackupManager(baseDir);
    const result = await bm.rollback(backupId, true, false);
    
    return {
      success: result.failed === 0,
      restored_count: result.success,
      failed_count: result.failed,
      errors: result.errors,
    };
  } catch (e) {
    console.error('回滚备份失败:', e);
    return {
      success: false,
      error: e.message,
      restored_count: 0,
      failed_count: 0,
      errors: [e.message],
    };
  }
});

// 命令模式：删除指定备份
ipcMain.handle('delete-cmd-backup', async (event, inputDir, backupId) => {
  try {
    const { BackupManager } = require('./src/backup-manager');
    
    let baseDir = inputDir;
    if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile()) {
      baseDir = path.dirname(inputDir);
    }
    
    const bm = new BackupManager(baseDir);
    const success = bm.deleteBackup(backupId);
    
    return { success };
  } catch (e) {
    console.error('删除备份失败:', e);
    return { success: false, error: e.message };
  }
});

// 命令模式：清理旧备份（保留最新的N个）
ipcMain.handle('clean-cmd-backups', async (event, inputDir, keepCount) => {
  try {
    const { BackupManager } = require('./src/backup-manager');
    
    let baseDir = inputDir;
    if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile()) {
      baseDir = path.dirname(inputDir);
    }
    
    const bm = new BackupManager(baseDir);
    const deleted = bm.cleanOldBackups(keepCount || 5);
    
    return { success: true, deleted_count: deleted };
  } catch (e) {
    console.error('清理备份失败:', e);
    return { success: false, error: e.message, deleted_count: 0 };
  }
});

// 命令模式：获取备份详情（文件列表）
ipcMain.handle('get-cmd-backup-detail', async (event, inputDir, backupId) => {
  try {
    const { BackupManager } = require('./src/backup-manager');
    
    let baseDir = inputDir;
    if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile()) {
      baseDir = path.dirname(inputDir);
    }
    
    const bm = new BackupManager(baseDir);
    const detail = bm.getBackupDetail(backupId);
    
    return { success: true, detail };
  } catch (e) {
    console.error('获取备份详情失败:', e);
    return { success: false, error: e.message, detail: null };
  }
});

// 辅助函数：递归计算文件数量
function countFiles(dir) {
  let count = 0;
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        count += countFiles(fullPath);
      } else {
        count++;
      }
    }
  } catch (e) {}
  return count;
}

// 检查更新（在主进程中调用 GitHub API，避免 CORS 问题）
ipcMain.handle('check-update', async (event, currentVersion) => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/linzhongyoumeng/dds-texture-tool/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': 'DDS-Texture-Tool',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ success: false, error: `GitHub API 返回 ${res.statusCode}`, latest: null });
            return;
          }
          const release = JSON.parse(data);
          const latestVersion = release.tag_name?.replace(/^v/, '') || release.name?.replace(/^v/, '');
          if (!latestVersion) {
            resolve({ success: false, error: '未找到版本号', latest: null });
            return;
          }
          // 版本比较
          const current = (currentVersion || '').split('.').map(Number);
          const latest = latestVersion.split('.').map(Number);
          let hasUpdate = false;
          for (let i = 0; i < Math.max(current.length, latest.length); i++) {
            if ((latest[i] || 0) > (current[i] || 0)) { hasUpdate = true; break; }
            if ((latest[i] || 0) < (current[i] || 0)) break;
          }
          resolve({
            success: true,
            error: null,
            latest: latestVersion,
            has_update: hasUpdate,
            url: release.html_url,
            body: release.body,
          });
        } catch (e) {
          resolve({ success: false, error: `解析失败: ${e.message}`, latest: null });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, error: `网络错误: ${e.message}`, latest: null });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: '请求超时', latest: null });
    });

    req.end();
  });
});

// ============================================================
// 专业模式 - 独立 IPC 通道，不影响原始功能
// ============================================================

// 专业模式支持的输入格式
const PRO_SUPPORTED_EXTENSIONS = ['.dds', '.png', '.jpg', '.jpeg', '.tga', '.bmp', '.tif', '.tiff', '.wdp', '.hdp', '.jxr'];

// 扫描专业模式文件
function scanProFiles(inputDir, recursive, inputFormat) {
  const files = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.dds_tool_backup') continue;
        if (recursive) walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (inputFormat === 'all') {
          if (PRO_SUPPORTED_EXTENSIONS.includes(ext)) files.push(fullPath);
        } else if (inputFormat === 'dds') {
          if (ext === '.dds') files.push(fullPath);
        } else if (inputFormat === 'image') {
          if (['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.tif', '.tiff', '.wdp', '.hdp', '.jxr'].includes(ext)) files.push(fullPath);
        }
      }
    }
  };
  if (fs.existsSync(inputDir) && fs.statSync(inputDir).isDirectory()) {
    walk(inputDir);
  } else if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile()) {
    files.push(inputDir);
  }
  return files.sort();
}

// 开始专业模式处理
ipcMain.handle('start-pro-process', async (event, config) => {
  try {
    const inputPath = config.input_dir || '.';
    const filepaths = scanProFiles(inputPath, config.recursive !== false, config.input_format || 'all');

    if (filepaths.length === 0) {
      return { success: false, error: '没有找到符合条件的文件', report: null };
    }

    // 检查 texconv
    if (!config.dry_run) {
      if (!config.texconv_path || !fs.existsSync(config.texconv_path)) {
        return { success: false, error: '未找到 texconv.exe，请先设置路径', report: null };
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-log',
        `[专业模式] 共 ${filepaths.length} 个文件，无尺寸限制，全部处理`, 'info');
    }

    // 创建备份（专业模式备份所有会被处理的文件）
    let backupId = null;
    if (config.backup && !config.dry_run) {
      // 修复：当输入是单个文件时，使用文件所在目录作为基础目录
      let backupBaseDir = config.input_dir || '.';
      try {
        if (fs.existsSync(backupBaseDir) && fs.statSync(backupBaseDir).isFile()) {
          backupBaseDir = path.dirname(backupBaseDir);
        }
      } catch (e) {
        // 如果判断失败，使用原路径
      }
      const backupMgr = new BackupManager(backupBaseDir, config.backup_dir || null);
      const proTempProcessor = new ProDDSProcessor(config, null, null);
      const filesToBackup = [];
      const parser = new DDSParser();
      for (const filepath of filepaths) {
        try {
          const ext = path.extname(filepath).toLowerCase();
          // 非DDS文件直接备份
          if (ext !== '.dds') { filesToBackup.push(filepath); continue; }
          // 命令模式下：备份所有文件，因为无法准确判断哪些文件会被修改
          if (config.cmd_mode) {
            filesToBackup.push(filepath);
            continue;
          }
          // 非命令模式：根据变更描述判断是否需要备份
          const info = parser.parse(filepath);
          if (info) {
            info.filepath = filepath;
            const changeInfo = proTempProcessor.generateChangeDescription(info);
            if (changeInfo.willChange) filesToBackup.push(filepath);
          } else {
            filesToBackup.push(filepath);
          }
        } catch (e) { filesToBackup.push(filepath); }
      }
      if (filesToBackup.length > 0) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-log', `[专业模式][备份] 正在备份 ${filesToBackup.length} 个文件...`);
        }
        const backupPoint = await backupMgr.createBackup(
          filesToBackup,
          `专业模式自动备份 (${filesToBackup.length} 个文件)`,
          config,
          (completed, total) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              const percent = Math.floor(completed / total * 100);
              if (percent % 10 === 0 || completed === total) {
                mainWindow.webContents.send('process-log', `[专业模式][备份] ${completed}/${total} (${percent}%)`);
              }
            }
          }
        );
        if (backupPoint) {
          backupId = backupPoint.id;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('process-log',
              `[专业模式][备份] 完成 - ${backupPoint.file_count} 个文件, ID: ${backupId}`, 'success');
          }
        }
      }
    }

    // 处理开始日志
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (config.dry_run) {
        mainWindow.webContents.send('process-log', `[专业模式][预览] 开始预览，共 ${filepaths.length} 个文件`, 'info');
      } else {
        mainWindow.webContents.send('process-log', `[专业模式][处理] 开始处理，共 ${filepaths.length} 个文件（${config.process_mode || 'auto'}模式${config.single_proc ? ', 单线程' : ''}）`, 'info');
      }
    }

    // 创建专业模式处理器
    const changeList = [];
    currentProProcessor = new ProDDSProcessor(config,
      (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-progress', {
            completed: progress.current,
            total: progress.total,
            result: progress.result,
            change_list: progress.change_list,
          });
        }
      },
      (message, type) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-log', message, type || 'info');
        }
      },
      (changeInfo) => {
        changeList.push(changeInfo);
      }
    );

    const proReport = await currentProProcessor.processFiles(filepaths, null);
    currentProProcessor = null;

    // 预览模式下输出每个文件的变更详情
    if (config.dry_run && changeList.length > 0) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-log', `[专业模式][预览] ===== 文件变更详情 (${changeList.length} 个文件) =====`, 'info');
        for (const change of changeList) {
          const sizeInfo = `${change.original.width}x${change.original.height} → ${change.target.width}x${change.target.height}`;
          const formatInfo = change.original.format !== change.target.format ?
            ` [${change.original.format} → ${change.target.format}]` : '';
          mainWindow.webContents.send('process-log',
            `  ${change.filename}: ${sizeInfo}${formatInfo} | ${change.changes.join(', ')}`,
            change.willChange ? 'info' : 'debug');
        }
        mainWindow.webContents.send('process-log', `[专业模式][预览] ===== 变更详情结束 =====`, 'info');
      }
    }

    return {
      success: true,
      error: null,
      report: {
        total: filepaths.length,
        processed: proReport.stats.processed,
        skipped: proReport.stats.skipped,
        failed: proReport.stats.failed,
        duration: 0,
        backup_id: backupId,
        results: proReport.results,
        change_list: changeList,
        pro_mode: true,
      }
    };
  } catch (e) {
    return { success: false, error: e.message, report: null };
  }
});

// 取消专业模式处理
ipcMain.handle('cancel-pro-process', () => {
  if (currentProProcessor) {
    currentProProcessor.cancel();
    return true;
  }
  return false;
});

// ============================================================
// 应用生命周期
// ============================================================

// 设置 Windows 应用程序图标（确保任务栏和窗口图标正确）
if (process.platform === 'win32') {
  try {
    const appIconPath = path.join(__dirname, 'assets', 'icon.ico');
    if (fs.existsSync(appIconPath)) {
      app.setAppUserModelId('com.ddstool.texture');
    }
  } catch (e) {
    console.error('设置应用图标失败:', e.message);
  }
}

app.whenReady().then(() => {
  // 隐藏默认菜单栏（File/Edit/View/Window/Help）
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});