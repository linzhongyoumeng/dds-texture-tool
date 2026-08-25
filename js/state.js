/**
 * 全局状态模块
 * 所有跨模块共享的状态变量
 */

// 配置
let currentConfig = {};

// 处理状态
let isProcessing = false;
let processStartTime = 0;
let progressUnsubscribe = null; // 进度监听器取消函数

// 性能优化：进度更新节流
let pendingProgress = null;
let progressRafPending = false;
const MAX_LOG_LINES = 300;

// 扫描预览状态
let scannedFiles = [];
let isScanning = false;

// 备份回滚状态
let currentDetailBackupId = null;
let currentDetailFiles = [];
let backupViewMode = 'folder'; // 'flat' 或 'folder'
let backupSearchQuery = '';
let expandedFolders = new Set();
let folderCheckboxStates = {};

// 文件信息状态
let infoFiles = [];
let infoSortKey = 'name';
let infoSortAsc = true;
let infoSearchQuery = '';

// 版本信息
const APP_VERSION = '2.8.1';
const GITHUB_REPO = 'linzhongyoumeng/dds-texture-tool';

// 语言和主题
let currentLang = 'zh';
let currentTheme = 'dark';

// 全局CPU/GPU模式（批量模式和命令模式共用）
// 'auto' = GPU优先（默认），'cpu' = 强制CPU模式
let globalProcessMode = 'auto';