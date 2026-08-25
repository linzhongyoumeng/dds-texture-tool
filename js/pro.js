// 专业模式前端逻辑
// 配置收集、处理控制、进度更新

let proIsProcessing = false;
let proProcessStartTime = 0;
let proProgressUnsubscribe = null;
let proStats = { total: 0, processed: 0, skipped: 0, failed: 0 };

/**
 * 选择专业模式输入目录
 */
async function selectProInputDir() {
  try {
    const result = await window.ddsTool.selectDirectory();
    if (result && typeof result === 'string') {
      document.getElementById('proInputDir').value = result;
      log(`专业模式 - 已选择输入目录: ${result}`, 'info');
    } else if (result && result.path) {
      document.getElementById('proInputDir').value = result.path;
      log(`专业模式 - 已选择输入目录: ${result.path}`, 'info');
    }
  } catch (e) {
    log(`选择目录失败: ${e.message}`, 'error');
  }
}

/**
 * 选择专业模式输入文件
 */
async function selectProInputFile() {
  try {
    const result = await window.ddsTool.selectFile();
    if (result && typeof result === 'string') {
      document.getElementById('proInputDir').value = result;
      log(`专业模式 - 已选择输入文件: ${result}`, 'info');
    } else if (result && result.path) {
      document.getElementById('proInputDir').value = result.path;
      log(`专业模式 - 已选择输入文件: ${result.path}`, 'info');
    }
  } catch (e) {
    log(`选择文件失败: ${e.message}`, 'error');
  }
}

/**
 * 选择专业模式输出目录
 */
async function selectProOutputDir() {
  try {
    const result = await window.ddsTool.selectDirectory();
    if (result && typeof result === 'string') {
      document.getElementById('proOutputDir').value = result;
      log(`专业模式 - 已选择输出目录: ${result}`, 'info');
    } else if (result && result.path) {
      document.getElementById('proOutputDir').value = result.path;
      log(`专业模式 - 已选择输出目录: ${result.path}`, 'info');
    }
  } catch (e) {
    log(`选择目录失败: ${e.message}`, 'error');
  }
}

/**
 * 打开输入文件夹
 */
function openProInputFolder() {
  const dir = document.getElementById('proInputDir').value.trim();
  if (dir) {
    window.ddsTool.openPath(dir);
  } else {
    log('请先选择输入目录', 'warning');
  }
}

/**
 * 收集专业模式配置
 */
function collectProConfig() {
  const width = parseInt(document.getElementById('proWidth').value) || 0;
  const height = parseInt(document.getElementById('proHeight').value) || 0;
  const scale = parseFloat(document.getElementById('proScale').value) || 1;
  
  // 处理模式（CPU/GPU）
  const processMode = document.getElementById('proProcessMode').value;
  const singleProc = document.getElementById('proSingleProc').checked;
  
  const config = {
    texconv_path: currentConfig.texconv_path || '',
    input_dir: document.getElementById('proInputDir').value.trim(),
    output_dir: document.getElementById('proOutputDir').value.trim() || null,
    input_format: document.getElementById('proInputFormat').value || 'all',
    target_format: document.getElementById('proFormat').value || null,
    target_width: width > 0 ? width : null,
    target_height: height > 0 ? height : null,
    scale: scale !== 1 ? scale : null,
    mipmap: document.getElementById('proMip').value,
    quality: document.getElementById('proQuality').value,
    filter: document.getElementById('proFilter').value,
    srgb: document.getElementById('proSrgb').value,
    alpha: document.getElementById('proAlpha').value,
    process_mode: processMode,
    single_proc: singleProc,
    backup: document.getElementById('proKeepOriginal').checked,
    recursive: document.getElementById('proRecursive').checked,
    dry_run: document.getElementById('proDryRun').checked,
    pro_mode: true,
  };
  
  return config;
}

/**
 * 开始专业模式处理
 */
async function startProProcess() {
  if (proIsProcessing) return;
  
  const config = collectProConfig();
  
  // 验证输入
  if (!config.input_dir) {
    log('请选择输入目录或文件', 'error');
    return;
  }
  
  proIsProcessing = true;
  proProcessStartTime = Date.now();
  proStats = { total: 0, processed: 0, skipped: 0, failed: 0 };
  
  // 注册进度更新监听器
  proProgressUnsubscribe = window.ddsTool.onProcessProgress((data) => {
    if (!proIsProcessing || !data) return;
    if (data.completed !== undefined && data.total !== undefined) {
      proStats.total = data.total;
      proStats.processed = data.completed;
      updateProProgress();
    }
  });
  
  // 更新 UI
  document.getElementById('btnProStart').style.display = 'none';
  document.getElementById('btnProCancel').style.display = 'inline-flex';
  document.getElementById('proProgressSection').style.display = 'block';
  document.getElementById('proStats').style.display = 'grid';
  
  log(config.dry_run ? '[专业模式-预览] 开始预览处理...' : '[专业模式] 开始处理...');
  
  try {
    const result = await window.ddsTool.startProProcess(config);
    
    if (result.success) {
      const report = result.report;
      const dur = report.duration ? report.duration.toFixed(1) : '0';
      if (config.dry_run) {
        log(`[专业模式-预览] 完成 - 需处理 ${report.processed} 个，跳过 ${report.skipped} 个，失败 ${report.failed} 个，耗时 ${dur}s`, report.failed > 0 ? 'warning' : 'success');
      } else {
        log(`[专业模式] 完成 - 成功 ${report.processed}，跳过 ${report.skipped}，失败 ${report.failed}，耗时 ${dur}s`, report.failed > 0 ? 'warning' : 'success');
      }
      
      // 更新最终统计
      proStats.total = report.total || proStats.total;
      proStats.processed = report.processed;
      proStats.skipped = report.skipped;
      proStats.failed = report.failed;
      updateProProgress();
      
      if (report.backup_id) {
        log(`备份点 ID: ${report.backup_id}（可在"备份回滚"页面恢复）`, 'info');
      }
    } else {
      log(`专业模式处理失败: ${result.error}`, 'error');
    }
  } catch (e) {
    log(`专业模式处理异常: ${e.message}`, 'error');
  } finally {
    proIsProcessing = false;
    if (proProgressUnsubscribe) {
      proProgressUnsubscribe();
      proProgressUnsubscribe = null;
    }
    document.getElementById('btnProStart').style.display = 'inline-flex';
    document.getElementById('btnProCancel').style.display = 'none';
  }
}

/**
 * 取消专业模式处理
 */
async function cancelProProcess() {
  if (!proIsProcessing) return;
  log('正在取消专业模式处理...', 'warning');
  try {
    await window.ddsTool.cancelProProcess();
  } catch (e) {
    log(`取消失败: ${e.message}`, 'error');
  }
  await new Promise(r => setTimeout(r, 500));
  proIsProcessing = false;
  document.getElementById('btnProStart').style.display = 'inline-flex';
  document.getElementById('btnProCancel').style.display = 'none';
  log('专业模式处理已取消', 'warning');
}

/**
 * 更新专业模式进度
 */
function updateProProgress() {
  const { total, processed, skipped, failed } = proStats;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  
  document.getElementById('proProgressBar').style.width = `${percent}%`;
  document.getElementById('proProgressText').textContent = `${processed} / ${total}`;
  document.getElementById('proStatTotal').textContent = total;
  document.getElementById('proStatProcessed').textContent = processed;
  document.getElementById('proStatSkipped').textContent = skipped;
  document.getElementById('proStatFailed').textContent = failed;
}

/**
 * 重置专业模式表单
 */
function resetProForm() {
  document.getElementById('proInputDir').value = '';
  document.getElementById('proOutputDir').value = '';
  document.getElementById('proInputFormat').value = 'all';
  document.getElementById('proFormat').value = '';
  document.getElementById('proWidth').value = '0';
  document.getElementById('proHeight').value = '0';
  document.getElementById('proScale').value = '1';
  document.getElementById('proMip').value = 'auto';
  document.getElementById('proQuality').value = 'normal';
  document.getElementById('proFilter').value = 'LINEAR';
  document.getElementById('proSrgb').value = 'auto';
  document.getElementById('proAlpha').value = 'auto';
  document.getElementById('proProcessMode').value = 'auto';
  document.getElementById('proSingleProc').checked = false;
  document.getElementById('proKeepOriginal').checked = true;
  document.getElementById('proRecursive').checked = true;
  document.getElementById('proDryRun').checked = false;
  
  document.getElementById('proProgressSection').style.display = 'none';
  document.getElementById('proStats').style.display = 'none';
  proStats = { total: 0, processed: 0, skipped: 0, failed: 0 };
  
  log('专业模式表单已重置', 'info');
}
