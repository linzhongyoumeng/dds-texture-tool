/**
 * 备份与回滚管理器
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DDSParser } = require('./dds-parser');

const BACKUP_DIR_NAME = '.dds_tool_backup';
const BACKUP_META_NAME = 'backup_meta.json';

class BackupManager {
  constructor(baseDir = '.', backupDir = null) {
    this.baseDir = path.resolve(baseDir);
    this.backupRoot = path.resolve(backupDir || path.join(this.baseDir, BACKUP_DIR_NAME));
    this._ensureBackupDir();
  }

  _ensureBackupDir() {
    if (!fs.existsSync(this.backupRoot)) {
      fs.mkdirSync(this.backupRoot, { recursive: true });
    }
    const gitignore = path.join(this.backupRoot, '.gitignore');
    if (!fs.existsSync(gitignore)) {
      fs.writeFileSync(gitignore, '*\n');
    }
  }

  _generateBackupId() {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const random = crypto.createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 6);
    return `backup_${timestamp}_${random}`;
  }

  _getBackupPath(backupId) {
    return path.join(this.backupRoot, backupId);
  }

  _getMetaPath(backupId) {
    return path.join(this._getBackupPath(backupId), BACKUP_META_NAME);
  }

  /**
   * 创建备份点（异步，带进度回调，不阻塞主进程）
   */
  async createBackup(filepaths, description = '', configSnapshot = null, onProgress = null) {
    if (!filepaths || filepaths.length === 0) return null;

    const backupId = this._generateBackupId();
    const backupPath = this._getBackupPath(backupId);
    await fs.promises.mkdir(backupPath, { recursive: true });

    const backedUpFiles = [];
    let totalSize = 0;
    let successCount = 0;
    const total = filepaths.length;
    const BATCH_SIZE = 20;

    for (let i = 0; i < filepaths.length; i += BATCH_SIZE) {
      const batch = filepaths.slice(i, i + BATCH_SIZE);

      for (const filepath of batch) {
        try {
          const absPath = path.resolve(filepath);
          if (!fs.existsSync(absPath)) continue;

          let relPath;
          try {
            relPath = path.relative(this.baseDir, absPath);
          } catch (e) {
            relPath = path.basename(absPath);
          }

          const destPath = path.join(backupPath, 'files', relPath);
          await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
          await fs.promises.copyFile(absPath, destPath);

          const stat = await fs.promises.stat(absPath);
          totalSize += stat.size;
          successCount++;

          backedUpFiles.push({
            original_path: absPath,
            relative_path: relPath.replace(/\\/g, '/'),
            backup_path: path.relative(backupPath, destPath).replace(/\\/g, '/'),
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch (e) {
          console.error('备份失败:', filepath, e.message);
        }
      }

      if (onProgress) {
        const completed = Math.min(i + BATCH_SIZE, total);
        onProgress(completed, total, filepaths[Math.min(i + BATCH_SIZE - 1, total - 1)]);
      }

      if (i + BATCH_SIZE < total) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    if (successCount === 0) {
      await fs.promises.rm(backupPath, { recursive: true, force: true });
      return null;
    }

    const backupPoint = {
      id: backupId,
      timestamp: new Date().toISOString(),
      description: description || `自动备份 - ${successCount} 个文件`,
      file_count: successCount,
      total_size: totalSize,
      files: backedUpFiles,
      config_snapshot: configSnapshot,
    };

    await fs.promises.writeFile(this._getMetaPath(backupId), JSON.stringify(backupPoint, null, 2), 'utf-8');
    return backupPoint;
  }

  listBackups() {
    const backups = [];
    if (!fs.existsSync(this.backupRoot)) return backups;

    const entries = fs.readdirSync(this.backupRoot).sort().reverse();
    for (const entry of entries) {
      const metaPath = path.join(this.backupRoot, entry, BACKUP_META_NAME);
      if (!fs.statSync(path.join(this.backupRoot, entry)).isDirectory()) continue;
      if (!fs.existsSync(metaPath)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        backups.push(data);
      } catch (e) {
        console.error('读取备份元数据失败:', entry, e.message);
      }
    }
    return backups;
  }

  getBackup(backupId) {
    const metaPath = this._getMetaPath(backupId);
    if (!fs.existsSync(metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (e) {
      return null;
    }
  }

  getLatestBackup() {
    const backups = this.listBackups();
    return backups.length > 0 ? backups[0] : null;
  }

  async rollback(backupId, overwrite = true, dryRun = false, onProgress = null) {
    const backup = this.getBackup(backupId);
    if (!backup) return { success: 0, failed: 0, errors: ['备份点不存在: ' + backupId] };

    const backupPath = this._getBackupPath(backupId);
    let success = 0, failed = 0;
    const errors = [];
    const total = backup.files.length;
    const BATCH_SIZE = 20;

    for (let i = 0; i < backup.files.length; i += BATCH_SIZE) {
      const batch = backup.files.slice(i, i + BATCH_SIZE);

      for (const fileInfo of batch) {
        try {
          const originalPath = fileInfo.original_path;
          const sourcePath = path.join(backupPath, fileInfo.backup_path);

          if (!fs.existsSync(sourcePath)) {
            throw new Error('备份文件不存在: ' + sourcePath);
          }
          if (fs.existsSync(originalPath) && !overwrite) continue;
          if (dryRun) { success++; continue; }

          await fs.promises.mkdir(path.dirname(originalPath), { recursive: true });
          await fs.promises.copyFile(sourcePath, originalPath);
          success++;
        } catch (e) {
          failed++;
          errors.push(`恢复失败 ${fileInfo.original_path}: ${e.message}`);
        }
      }

      if (onProgress) {
        const completed = Math.min(i + BATCH_SIZE, total);
        onProgress(completed, total);
      }

      if (i + BATCH_SIZE < total) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    return { success, failed, errors };
  }

  getBackupDetail(backupId) {
    const backup = this.getBackup(backupId);
    if (!backup) return null;

    const backupPath = this._getBackupPath(backupId);
    const parser = new DDSParser();
    const files = [];

    for (const fileInfo of backup.files) {
      const originalPath = fileInfo.original_path;
      const backupFilePath = path.join(backupPath, fileInfo.backup_path);

      const backupInfo = {
        size: fileInfo.size,
        size_formatted: BackupManager.formatSize(fileInfo.size),
        width: 0, height: 0, format: 'UNKNOWN',
      };
      try {
        if (fs.existsSync(backupFilePath)) {
          const info = parser.parse(backupFilePath);
          if (info) {
            backupInfo.width = info.width;
            backupInfo.height = info.height;
            backupInfo.format = info.format;
          }
        }
      } catch (e) {}

      const currentInfo = { exists: false, size: 0, size_formatted: '0 B', width: 0, height: 0, format: 'UNKNOWN' };
      try {
        if (fs.existsSync(originalPath)) {
          currentInfo.exists = true;
          const stat = fs.statSync(originalPath);
          currentInfo.size = stat.size;
          currentInfo.size_formatted = BackupManager.formatSize(stat.size);
          const info = parser.parse(originalPath);
          if (info) {
            currentInfo.width = info.width;
            currentInfo.height = info.height;
            currentInfo.format = info.format;
          }
        }
      } catch (e) {}

      const changed = currentInfo.exists && (
        currentInfo.size !== backupInfo.size ||
        currentInfo.width !== backupInfo.width ||
        currentInfo.height !== backupInfo.height
      );

      files.push({
        original_path: originalPath,
        relative_path: fileInfo.relative_path,
        name: path.basename(originalPath),
        backup: backupInfo,
        current: currentInfo,
        changed,
      });
    }

    return {
      id: backup.id,
      timestamp: backup.timestamp,
      description: backup.description,
      file_count: backup.file_count,
      total_size: backup.total_size,
      total_size_formatted: BackupManager.formatSize(backup.total_size),
      files,
    };
  }

  async rollbackFiles(backupId, filePaths, overwrite = true) {
    const backup = this.getBackup(backupId);
    if (!backup) return { success: 0, failed: 0, errors: ['备份点不存在: ' + backupId] };

    if (!filePaths || filePaths.length === 0) return { success: 0, failed: 0, errors: [] };

    const backupPath = this._getBackupPath(backupId);
    const pathSet = new Set(filePaths.map(p => path.resolve(p)));
    let success = 0, failed = 0;
    const errors = [];

    for (const fileInfo of backup.files) {
      if (!pathSet.has(path.resolve(fileInfo.original_path))) continue;

      try {
        const originalPath = fileInfo.original_path;
        const sourcePath = path.join(backupPath, fileInfo.backup_path);

        if (!fs.existsSync(sourcePath)) {
          throw new Error('备份文件不存在: ' + sourcePath);
        }
        if (fs.existsSync(originalPath) && !overwrite) continue;

        await fs.promises.mkdir(path.dirname(originalPath), { recursive: true });
        await fs.promises.copyFile(sourcePath, originalPath);
        success++;
      } catch (e) {
        failed++;
        errors.push(`恢复失败 ${fileInfo.original_path}: ${e.message}`);
      }
    }
    return { success, failed, errors };
  }

  deleteBackup(backupId) {
    const backupPath = this._getBackupPath(backupId);
    if (!fs.existsSync(backupPath)) return false;
    try {
      fs.rmSync(backupPath, { recursive: true, force: true });
      return true;
    } catch (e) {
      return false;
    }
  }

  cleanOldBackups(keepCount = 5) {
    const backups = this.listBackups();
    if (backups.length <= keepCount) return 0;
    let deleted = 0;
    for (const backup of backups.slice(keepCount)) {
      if (this.deleteBackup(backup.id)) deleted++;
    }
    return deleted;
  }

  getTotalSize() {
    let total = 0;
    if (!fs.existsSync(this.backupRoot)) return 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) walk(fullPath);
        else total += stat.size;
      }
    };
    try { walk(this.backupRoot); } catch (e) {}
    return total;
  }

  static formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

module.exports = { BackupManager, BACKUP_DIR_NAME };
