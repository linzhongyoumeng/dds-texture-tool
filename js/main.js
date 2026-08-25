/**
 * 主入口模块
 */

function showHelp() { const modal = document.getElementById('helpModal'); if (modal) modal.style.display = 'flex'; }
function closeHelp() { const modal = document.getElementById('helpModal'); if (modal) modal.style.display = 'none'; }

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(item => { item.classList.toggle('active', item.dataset.tab === tabName); });
  document.querySelectorAll('.tab-content').forEach(content => { content.classList.toggle('active', content.id === `tab-${tabName}`); });
}

async function initApp() {
  const savedLang = localStorage.getItem('dds_lang');
  if (savedLang) { currentLang = savedLang; const langSelect = document.getElementById('langSelect'); if (langSelect) langSelect.value = savedLang; }
  applyTranslations();
  const savedTheme = localStorage.getItem('dds_theme');
  if (savedTheme) currentTheme = savedTheme;
  applyTheme();
  try { currentConfig = await window.ddsTool.getConfig(); } catch (e) { console.error('加载配置失败:', e); currentConfig = {}; }
  restoreFormValues();
  updateTexconvStatus();
  document.querySelectorAll('.nav-item').forEach(item => { item.addEventListener('click', () => switchTab(item.dataset.tab)); });
  const btnHelp = document.getElementById('btnHelp');
  if (btnHelp) btnHelp.addEventListener('click', (e) => { e.preventDefault(); showHelp(); });
  const btnSelectTexconv = document.getElementById('btnSelectTexconv');
  if (btnSelectTexconv) btnSelectTexconv.addEventListener('click', selectTexconv);
  const btnChangeTexconv = document.getElementById('btnChangeTexconv');
  if (btnChangeTexconv) btnChangeTexconv.addEventListener('click', selectTexconv);
  window.ddsTool.onProcessProgress((data) => { updateProgress(data.completed, data.total, data.result); });
  window.ddsTool.onProcessLog((message, type) => { if (isProcessing && message.startsWith('[完成]')) return; log(message, type); });
  window.ddsTool.onScanProgress((data) => { updateScanProgress(data.completed, data.total); });
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  log(`DDS 纹理批量处理工具 v${APP_VERSION} 已启动`, 'success');
  if (currentConfig._using_bundled_texconv) log('已自动加载内置 texconv.exe，可直接使用', 'success');
  else if (!currentConfig.texconv_path) log('提示: 请先点击右上角"选择 texconv"按钮设置 texconv.exe 路径', 'warning');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();

document.addEventListener('click', (e) => { if (e.target.classList.contains('modal-overlay')) e.target.style.display = 'none'; });

function openAbout() { document.getElementById('aboutModal').style.display = 'flex'; }
function closeAbout() { document.getElementById('aboutModal').style.display = 'none'; }