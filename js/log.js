/**
 * 日志和辅助函数模块
 */

function log(message, type = 'info', detail = null) {
  const container = document.getElementById('logContent');
  if (!container) return;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  if (detail) {
    line.style.cursor = 'pointer';
    const summary = document.createElement('div');
    summary.className = 'log-summary';
    summary.innerHTML = `<span class="log-time">[${time}]</span>${escapeHtml(message)} <span class="log-expand-hint">▸</span>`;
    const detailDiv = document.createElement('div');
    detailDiv.className = 'log-detail';
    detailDiv.style.display = 'none';
    let detailHtml = '';
    if (detail.filepath) detailHtml += `<div><b>文件:</b> ${escapeHtml(detail.filepath)}</div>`;
    if (detail.error) detailHtml += `<div><b>错误:</b> ${escapeHtml(detail.error)}</div>`;
    if (detail.original_size) detailHtml += `<div><b>原始尺寸:</b> ${detail.original_size.width}x${detail.original_size.height}</div>`;
    if (detail.new_size) detailHtml += `<div><b>新尺寸:</b> ${detail.new_size.width}x${detail.new_size.height}</div>`;
    if (detail.new_format) detailHtml += `<div><b>格式:</b> ${escapeHtml(detail.new_format)}</div>`;
    for (const key in detail) {
      if (!['filepath', 'error', 'original_size', 'new_size', 'new_format'].includes(key)) {
        detailHtml += `<div><b>${escapeHtml(key)}:</b> ${escapeHtml(String(detail[key]))}</div>`;
      }
    }
    detailDiv.innerHTML = detailHtml;
    summary.addEventListener('click', () => {
      const isOpen = detailDiv.style.display === 'block';
      detailDiv.style.display = isOpen ? 'none' : 'block';
      summary.querySelector('.log-expand-hint').textContent = isOpen ? '▸' : '▾';
    });
    line.appendChild(summary);
    line.appendChild(detailDiv);
  } else {
    line.innerHTML = `<span class="log-time">[${time}]</span>${escapeHtml(message)}`;
  }
  container.appendChild(line);
  while (container.children.length > MAX_LOG_LINES) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

function clearLog() {
  const container = document.getElementById('logContent');
  if (container) container.innerHTML = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function estimateBytesPerPixel(format) {
  if (!format) return 1;
  const fmt = format.toUpperCase();
  if (fmt.includes('BC1') || fmt.includes('BC4')) return 0.5;
  if (fmt.includes('BC2') || fmt.includes('BC3') || fmt.includes('BC5') || fmt.includes('BC6') || fmt.includes('BC7')) return 1;
  if (fmt.includes('R8G8B8A8') || fmt.includes('B8G8R8A8')) return 4;
  if (fmt.includes('R16G16B16A16')) return 8;
  if (fmt.includes('R32G32B32A32')) return 16;
  return 1;
}