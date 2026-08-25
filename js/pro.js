/**
 * 专业模式模块
 * 完整 texconv 功能支持，批量/单文件处理，CPU 模式
 */

// 专业模式状态
let proIsProcessing = false;
let proProcessStartTime = 0;
let proStats = { total: 0, processed: 0, skipped: 0, failed: 0 };
let proProgressUnsubscribe = null;

async function selectProInputDir() {
  try {
    const result = await window.ddsTool.selectDirectory();
    if (result) { document.getElementById('proInputDir').value = result; log(`专业模式 - 已选择输入目录: ${result}`, 'info'); }
  } catch (e) { log(`选择目录失败: ${e.message}`, 'error'); }
}

async function selectProInputFile() {
  try {
    const result = await window.ddsTool.selectDdsFile();
    if (result) { document.getElementById('proInputDir').value = result; log(`专业模式 - 已选择输入文件: ${result}`, 'info'); }
  } catch (e) { log(`选择文件失败: ${e.message}`, 'error'); }
}

function openProInputFolder() {
  const path = document.getElementById('proInputDir').value.trim();
  if (!path) { log('请先选择输入目录或文件', 'warning'); return; }
  window.ddsTool.openPath(path);
}

async function selectProOutputDir() {
  try {
    const result = await window.ddsTool.selectDirectory();
    if (result) { document.getElementById('proOutputDir').value = result; log(`专业模式 - 已选择输出目录: ${result}`, 'info'); }
  } catch (e) { log(`选择目录失败: ${e.message}`, 'error'); }
}

function collectProConfig() {
  const width = parseInt(document.getElementById('proWidth').value) || 0;
  const height = parseInt(document.getElementById('proHeight').value) || 0;
  const scale = parseFloat(document.getElementById('proScale').value) || 1;
  const cpuMode = document.getElementById('proCpuMode').value;
  const cpuCores = navigator.hardwareConcurrency || 4;
  let threads = 1;
  if (cpuMode === 'multi') threads = Math.max(2, Math.floor(cpuCores / 2));
  else if (cpuMode === 'all') threads = cpuCores;
  return {
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
    threads: threads,
    cpu_mode: cpuMode,
    backup: document.getElementById('proKeepOriginal').checked,
    recursive: document.getElementById('proRecursive').checked,
    dry_run: document.getElementById('proDryRun').checked,
    pro_mode: true,
  };
}

async function startProProcess() {
  if (proIsProcessing) return;
  const config = collectProConfig();
  if (!config.input_dir) { log('请选择输入目录或文件', 'error'); return; }
  proIsProcessing = true;
  proProcessStartTime = Date.now();
  proStats = { total: 0, processed: 0, skipped: 0, failed: 0 };
  proProgressUnsubscribe = window.ddsTool.onProcessProgress((data) => {
    if (!proIsProcessing || !data) return;
    if (data.completed !== undefined && data.total !== undefined) {
      proStats.total = data.total; proStats.processed = data.completed; updateProProgress();
    }
  });
  document.getElementById('btnProStart').style.display = 'none';
  document.getElementById('btnProCancel').style.display = 'inline-block';
  document.getElementById('proProgressSection').style.display = 'block';
  document.getElementById('proStats').style.display = 'grid';
  log('========== 专业模式开始处理 ==========', 'info');
  log(`输入: ${config.input_dir}`, 'info');
  if (config.output_dir) log(`输出: ${config.output_dir}`, 'info');
  if (config.target_format) log(`目标格式: ${config.target_format}`, 'info');
  if (config.target_width || config.target_height) log(`目标尺寸: ${config.target_width || '保持'}x${config.target_height || '保持'}`, 'info');
  if (config.scale) log(`缩放比例: ${config.scale}x`, 'info');
  log(`输入格式: ${config.input_format || 'all'}`, 'info');
  log(`CPU 模式: ${config.cpu_mode} (${config.threads} 线程)`, 'info');
  log(`预览模式: ${config.dry_run ? '是' : '否'}`, 'info');
  try {
    const result = await window.ddsTool.startProProcess(config);
    if (!result || !result.success) { log(`处理失败: ${result?.error || '未知错误'}`, 'error'); finishProProcess(); return; }
    const report = result.report;
    proStats.total = report.total || 0; proStats.processed = report.processed || 0;
    proStats.skipped = report.skipped || 0; proStats.failed = report.failed || 0;
    updateProProgress();
    if (config.dry_run && report.change_list && report.change_list.length > 0) {
      log('========== 预览 - 文件变更详情 ==========', 'info');
      let changeCount = 0;
      for (const change of report.change_list) {
        const sizeInfo = `${change.original.width}x${change.original.height} → ${change.target.width}x${change.target.height}`;
        const formatInfo = change.original.format !== change.target.format ? ` [${change.original.format} → ${change.target.format}]` : '';
        const fileSize = change.original.fileSize ? ` (${(change.original.fileSize / 1024 / 1024).toFixed(2)}MB)` : '';
        if (change.willChange) { changeCount++; log(`  [变更] ${change.filename}${fileSize}: ${sizeInfo}${formatInfo}`, 'info'); log(`         变更项: ${change.changes.join(', ')}`, 'debug'); }
        else { log(`  [保持] ${change.filename}${fileSize}: ${sizeInfo}${formatInfo} - 无变更`, 'debug'); }
      }
      log(`========== 预览完成: 共 ${report.change_list.length} 个文件，其中 ${changeCount} 个将被修改 ==========`, 'success');
    }
    const elapsed = ((Date.now() - proProcessStartTime) / 1000).toFixed(1);
    log('========== 专业模式处理完成 ==========', 'success');
    log(`总计: ${proStats.total}, 已处理: ${proStats.processed}, 已跳过: ${proStats.skipped}, 失败: ${proStats.failed}`, 'info');
    log(`耗时: ${elapsed} 秒`, 'info');
  } catch (e) { log(`处理出错: ${e.message}`, 'error'); proStats.failed++; updateProProgress(); }
  finally { finishProProcess(); }
}

async function cancelProProcess() {
  if (!proIsProcessing) return;
  try { await window.ddsTool.cancelProProcess(); log('用户取消处理', 'warning'); } catch (e) { log(`取消失败: ${e.message}`, 'error'); }
  finishProProcess();
}

function finishProProcess() {
  proIsProcessing = false;
  document.getElementById('btnProStart').style.display = 'inline-block';
  document.getElementById('btnProCancel').style.display = 'none';
  if (proProgressUnsubscribe) { proProgressUnsubscribe(); proProgressUnsubscribe = null; }
}

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
  document.getElementById('proCpuMode').value = 'single';
  document.getElementById('proKeepOriginal').checked = true;
  document.getElementById('proRecursive').checked = true;
  document.getElementById('proDryRun').checked = false;
  document.getElementById('proProgressSection').style.display = 'none';
  document.getElementById('proStats').style.display = 'none';
  proStats = { total: 0, processed: 0, skipped: 0, failed: 0 };
  log('专业模式表单已重置', 'info');
}

function updateProProgress() {
  const total = proStats.total || 0; const processed = proStats.processed || 0;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  document.getElementById('proProgressBar').style.width = percent + '%';
  document.getElementById('proProgressText').textContent = `${processed} / ${total} (${percent}%)`;
  document.getElementById('proStatTotal').textContent = proStats.total;
  document.getElementById('proStatProcessed').textContent = proStats.processed;
  document.getElementById('proStatSkipped').textContent = proStats.skipped;
  document.getElementById('proStatFailed').textContent = proStats.failed;
}
