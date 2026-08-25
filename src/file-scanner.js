/**
 * 文件扫描器
 */

const fs = require('fs');
const path = require('path');
const { BACKUP_DIR_NAME } = require('./backup-manager');

class FileScanner {
  constructor() {}

  scan(config) {
    const inputDir = path.resolve(config.input_dir || '.');
    if (!fs.existsSync(inputDir)) return [];
    const files = [];
    const recursive = config.recursive !== false;
    const includePatterns = config.include_patterns || ['*.dds'];
    const excludePatterns = config.exclude_patterns || [];
    const minFileSize = config.min_file_size || 0;
    const maxFileSize = config.max_file_size || 0;
    const matchPattern = (filename, patterns) => {
      return patterns.some(p => {
        const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        return regex.test(filename);
      });
    };
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === BACKUP_DIR_NAME) continue;
          if (recursive) walk(fullPath);
        } else if (entry.isFile()) {
          if (includePatterns.length > 0 && !matchPattern(entry.name, includePatterns)) continue;
          if (excludePatterns.length > 0 && matchPattern(entry.name, excludePatterns)) continue;
          try {
            const size = fs.statSync(fullPath).size;
            if (minFileSize > 0 && size < minFileSize) continue;
            if (maxFileSize > 0 && size > maxFileSize) continue;
          } catch (e) { continue; }
          files.push(fullPath);
        }
      }
    };
    walk(inputDir);
    return files.sort();
  }
}

module.exports = { FileScanner };