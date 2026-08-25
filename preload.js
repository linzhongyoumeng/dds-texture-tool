/**
 * 预加载脚本
 * 安全地暴露 IPC 接口给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ddsTool', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  selectTexconv: () => ipcRenderer.invoke('select-texconv'),
  selectDirectory: (title) => ipcRenderer.invoke('select-directory', title),
  selectDdsFile: () => ipcRenderer.invoke('select-dds-file'),
  checkTexconv: (path) => ipcRenderer.invoke('check-texconv', path),
  parseDds: (filepath) => ipcRenderer.invoke('parse-dds', filepath),
  scanFiles: (config) => ipcRenderer.invoke('scan-files', config),
  scanFilesWithInfo: (config) => ipcRenderer.invoke('scan-files-with-info', config),
  startProcess: (config) => ipcRenderer.invoke('start-process', config),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  onProcessProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('process-progress', listener);
    return () => ipcRenderer.removeListener('process-progress', listener);
  },
  onProcessLog: (callback) => {
    const listener = (event, message, type) => callback(message, type || 'info');
    ipcRenderer.on('process-log', listener);
    return () => ipcRenderer.removeListener('process-log', listener);
  },
  onScanProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('scan-progress', listener);
    return () => ipcRenderer.removeListener('scan-progress', listener);
  },
  listBackups: (baseDir, backupDir) => ipcRenderer.invoke('list-backups', baseDir, backupDir),
  getBackupDetail: (baseDir, backupDir, backupId) => ipcRenderer.invoke('get-backup-detail', baseDir, backupDir, backupId),
  rollback: (baseDir, backupDir, backupId, overwrite) => ipcRenderer.invoke('rollback', baseDir, backupDir, backupId, overwrite),
  rollbackFiles: (baseDir, backupDir, backupId, filePaths, overwrite) => ipcRenderer.invoke('rollback-files', baseDir, backupDir, backupId, filePaths, overwrite),
  deleteBackup: (baseDir, backupDir, backupId) => ipcRenderer.invoke('delete-backup', baseDir, backupDir, backupId),
  cleanBackups: (baseDir, backupDir, keepCount) => ipcRenderer.invoke('clean-backups', baseDir, backupDir, keepCount),
  createBackup: (config, description) => ipcRenderer.invoke('create-backup', config, description),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showInFolder: (filepath) => ipcRenderer.invoke('show-in-folder', filepath),
  openPath: (dirpath) => ipcRenderer.invoke('open-path', dirpath),
  checkUpdate: (currentVersion) => ipcRenderer.invoke('check-update', currentVersion),
  startProProcess: (config) => ipcRenderer.invoke('start-pro-process', config),
  cancelProProcess: () => ipcRenderer.invoke('cancel-pro-process'),
});
