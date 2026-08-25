/**
 * 全局状态模块
 * 所有跨模块共享的状态变量
 */

let currentConfig = {};
let isProcessing = false;
let processStartTime = 0;
let pendingProgress = null;
let progressRafPending = false;
const MAX_LOG_LINES = 300;
let scannedFiles = [];
let isScanning = false;
let currentDetailBackupId = null;
let currentDetailFiles = [];
let backupViewMode = 'folder';
let backupSearchQuery = '';
let expandedFolders = new Set();
let folderCheckboxStates = {};
let infoFiles = [];
let infoSortKey = 'name';
let infoSortAsc = true;
let infoSearchQuery = '';
const APP_VERSION = '1.9.3';
const GITHUB_REPO = 'linzhongyoumeng/dds-texture-tool';
let currentLang = 'zh';
let currentTheme = 'dark';