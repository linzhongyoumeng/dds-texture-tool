/**
 * 主入口模块
 * 标签页切换、帮助弹窗、IPC 事件监听、初始化
 */

/**
 * 显示帮助弹窗
 */
function showHelp() {
  const modal = document.getElementById('helpModal');
  if (modal) modal.style.display = 'flex';
}

/**
 * 关闭帮助弹窗
 */
function closeHelp() {
  const modal = document.getElementById('helpModal');
  if (modal) modal.style.display = 'none';
}

/**
 * 切换标签页
 */
function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

/**
 * 初始化应用
 */
async function initApp() {
  // 恢复语言设置
  const savedLang = localStorage.getItem('dds_lang');
  if (savedLang) {
    currentLang = savedLang;
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = savedLang;
  }
  applyTranslations();

  // 恢复主题设置
  const savedTheme = localStorage.getItem('dds_theme');
  if (savedTheme) {
    currentTheme = savedTheme;
  }
  applyTheme();

  // 恢复全局CPU/GPU模式设置
  const savedProcessMode = localStorage.getItem('dds_global_process_mode');
  if (savedProcessMode) {
    globalProcessMode = savedProcessMode;
  }
  updateGlobalCpuGpuUI();

  // 加载配置
  try {
    currentConfig = await window.ddsTool.getConfig();
  } catch (e) {
    console.error('加载配置失败:', e);
    currentConfig = {};
  }

  // 恢复表单值
  restoreFormValues();
  
  // 初始化命令模式预览
  if (typeof updateCmdPreview === 'function') {
    updateCmdPreview();
  }
  
  // 初始化命令模式（加载保存的配置、绑定自动保存）
  if (typeof initCmdMode === 'function') {
    initCmdMode();
  }
  
  // 更新 texconv 状态
  updateTexconvStatus();

  // 绑定标签页切换
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  // 绑定帮助按钮
  const btnHelp = document.getElementById('btnHelp');
  if (btnHelp) {
    btnHelp.addEventListener('click', (e) => {
      e.preventDefault();
      showHelp();
    });
  }

  // 绑定 texconv 选择按钮
  const btnSelectTexconv = document.getElementById('btnSelectTexconv');
  if (btnSelectTexconv) btnSelectTexconv.addEventListener('click', selectTexconv);
  const btnChangeTexconv = document.getElementById('btnChangeTexconv');
  if (btnChangeTexconv) btnChangeTexconv.addEventListener('click', selectTexconv);

  // 监听处理进度
  window.ddsTool.onProcessProgress((data) => {
    updateProgress(data.completed, data.total, data.result);
  });

  // 监听处理日志
  window.ddsTool.onProcessLog((message, type) => {
    // 性能优化：处理过程中只输出失败/警告，不输出每个文件的[完成]
    if (isProcessing && message.startsWith('[完成]')) return;
    log(message, type);
  });

  // 监听扫描进度
  window.ddsTool.onScanProgress((data) => {
    updateScanProgress(data.completed, data.total);
  });

  // 版本信息
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  log(`DDS 纹理批量处理工具 v${APP_VERSION} 已启动`, 'success');

  if (currentConfig._using_bundled_texconv) {
    log('已自动加载内置 texconv.exe，可直接使用', 'success');
  } else if (!currentConfig.texconv_path) {
    log('提示: 请先点击右上角"选择 texconv"按钮设置 texconv.exe 路径', 'warning');
  }
}

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// 点击遮罩关闭弹窗
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});


/**
 * 打开关于弹窗
 */
function openAbout() {
  document.getElementById('aboutModal').style.display = 'flex';
}

/**
 * 关闭关于弹窗
 */
function closeAbout() {
  document.getElementById('aboutModal').style.display = 'none';
}

/**
 * 切换全局CPU/GPU模式
 * 批量模式和命令模式共用此设置
 */
function toggleGlobalCpuGpu() {
  if (globalProcessMode === 'auto') {
    globalProcessMode = 'cpu';
  } else {
    globalProcessMode = 'auto';
  }
  localStorage.setItem('dds_global_process_mode', globalProcessMode);
  updateGlobalCpuGpuUI();
  
  const modeText = globalProcessMode === 'cpu' ? 'CPU模式（全局）' : 'GPU模式（全局）';
  log(`已切换到${modeText}，批量模式和命令模式将使用此设置`, 'info');
}

/**
 * 更新全局CPU/GPU模式UI显示
 */
function updateGlobalCpuGpuUI() {
  const label = document.getElementById('globalCpuGpuLabel');
  const btn = document.getElementById('btnGlobalCpuGpu');
  
  if (label) {
    label.textContent = globalProcessMode === 'cpu' ? 'CPU' : 'GPU';
  }
  
  if (btn) {
    if (globalProcessMode === 'cpu') {
      btn.classList.add('cpu-mode-active');
      btn.title = '当前：CPU模式（全局）- 点击切换到GPU模式';
    } else {
      btn.classList.remove('cpu-mode-active');
      btn.title = '当前：GPU模式（全局）- 点击切换到CPU模式';
    }
  }
}