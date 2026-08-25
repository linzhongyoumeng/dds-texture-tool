/**
 * 主题切换模块
 */

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme();
  localStorage.setItem('dds_theme', currentTheme);
  log(`已切换到${currentTheme === 'dark' ? '黑夜' : '白天'}主题`, 'info');
}

function applyTheme() {
  const themeIcon = document.getElementById('themeIcon');
  if (currentTheme === 'light') {
    document.body.classList.add('theme-light');
    if (themeIcon) themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    document.body.classList.remove('theme-light');
    if (themeIcon) themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
}

async function checkUpdate() {
  log('正在检查更新...', 'info');
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!response.ok) { log('检查更新失败（可能尚未发布 Release）', 'warning'); return; }
    const data = await response.json();
    const latestVersion = data.tag_name?.replace(/^v/, '') || data.name?.replace(/^v/, '');
    if (!latestVersion) { log('未找到最新版本信息', 'warning'); return; }
    const current = APP_VERSION.split('.').map(Number);
    const latest = latestVersion.split('.').map(Number);
    let hasUpdate = false;
    for (let i = 0; i < Math.max(current.length, latest.length); i++) {
      if ((latest[i] || 0) > (current[i] || 0)) { hasUpdate = true; break; }
      if ((latest[i] || 0) < (current[i] || 0)) break;
    }
    if (hasUpdate) { log(`发现新版本 v${latestVersion}！当前版本 v${APP_VERSION}`, 'success'); log(`下载地址: ${data.html_url}`, 'info'); }
    else { log(`当前已是最新版本 v${APP_VERSION}`, 'success'); }
  } catch (e) { log(`检查更新失败: ${e.message}`, 'error'); }
}