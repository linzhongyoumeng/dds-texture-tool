# DDS Texture Tool

通用 DDS 纹理批量处理工具 - Electron 桌面版

## 功能特性

- **批量处理**：递归扫描目录，自动缩放超过目标尺寸的 DDS 纹理
- **保持原格式**：不转换格式，避免 NPC 变白等兼容性问题
- **内置 texconv**：开箱即用，无需额外配置
- **单文件处理**：支持选择单个 DDS 文件，避免误操作整个目录
- **选择性处理**：扫描预览后可勾选只处理部分文件
- **快速预设**：8K/4K/3K/2K/1K 一键设置目标尺寸
- **自动备份**：处理前只备份需要处理的文件，支持单文件回滚和全部回滚
- **文件夹视图**：备份详情按子文件夹分组，支持折叠展开和搜索过滤
- **文件信息批量查看**：统计汇总、可排序表格、搜索过滤、导出 CSV
- **白天/黑夜主题**：一键切换界面主题
- **多语言**：支持中文/英文界面
- **版本检查**：检查 GitHub 最新版本

## 系统要求

- Windows 10/11 x64
- 支持 DirectX 的显卡（texconv 依赖）

## 快速开始

1. 下载最新 release 的 ZIP 包
2. 解压到任意目录
3. 运行 `DDS Texture Tool.exe`
4. 选择输入目录或单个 DDS 文件
5. 设置目标尺寸（默认 3072x3072）
6. 点击"扫描预览"查看文件列表
7. 点击"开始处理"执行批量转换

## 从源码运行

```bash
# 安装依赖（生成 package-lock.json）
npm install

# 开发模式运行
npm start

# 打包
npm run build
```

### 源码运行注意事项

- **texconv.exe**：从源码运行时，需要手动将 `texconv.exe` 放到 `assets/bin/` 目录下。可从 [微软 DirectXTex releases](https://github.com/microsoft/DirectXTex/releases) 下载。
- **应用图标**：运行 `node generate-icon.js` 生成 `assets/icon.png`。
- **打包后**：texconv.exe 会被自动打包到 `resources/bin/` 目录，开箱即用。

## 项目结构

```
dds-gui/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本
├── index.html           # 界面
├── renderer.js          # 渲染进程逻辑
├── style.css            # 样式
├── package.json         # 项目配置
├── generate-icon.js     # 图标生成脚本
├── src/
│   ├── dds-parser.js    # DDS 文件解析
│   ├── backup-manager.js # 备份管理
│   ├── file-scanner.js  # 文件扫描
│   └── processor.js     # texconv 调用封装
└── assets/
    ├── icon.png         # 应用图标（运行 generate-icon.js 生成）
    └── bin/
        └── texconv.exe  # 内置 texconv 工具（需手动放置）
```

## 技术栈

- Electron 31.7.7
- Node.js 20+
- 原生 CSS（深色/浅色主题）
- texconv（DirectXTex 纹理转换工具）

## 许可证

MIT
