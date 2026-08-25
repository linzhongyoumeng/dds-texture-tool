# DDS Texture Tool - 通用 DDS 纹理批量处理工具

一个基于 Electron 的桌面 GUI 应用，用于批量处理 DDS 纹理文件，支持压缩、格式转换、备份回滚等功能。

## 功能特性

- **批量处理**：支持批量缩放 DDS 纹理，只处理大于目标尺寸的文件
- **命令模式**：支持自定义 texconv 命令参数，灵活处理各种格式转换
- **备份回滚**：自动备份处理前的文件，支持一键回滚
- **CPU/GPU 模式**：全局开关，支持 CPU 和 GPU 两种处理模式
- **多语言**：支持中文和英文界面
- **白天/黑夜模式**：支持主题切换
- **版本检查**：自动检查 GitHub 最新版本

## 系统要求

- Windows 10/11 x64
- 内置 texconv.exe（DirectXTex 纹理处理工具）

## 使用方法

1. 下载最新版本的 ZIP 包
2. 解压到任意目录
3. 运行 `DDS Texture Tool.exe`
4. 选择要处理的目录或文件
5. 设置处理参数
6. 点击开始处理

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式运行

```bash
npm start
```

### 打包

```bash
npm run build
```

打包后使用 rcedit 注入图标：

```bash
node_modules\rcedit\bin\rcedit-x64.exe "dist\win-unpacked\DDS Texture Tool.exe" --set-icon assets\icon.ico
```

## 项目结构

```
dds-gui/
├── main.js              # 主进程
├── preload.js           # 预加载脚本
├── index.html           # 主界面
├── style.css            # 样式
├── package.json         # 项目配置
├── js/                  # 前端逻辑
│   ├── state.js         # 状态管理
│   ├── main.js          # 主界面逻辑
│   ├── process.js       # 处理逻辑
│   ├── scan.js          # 扫描逻辑
│   ├── backup.js        # 备份逻辑
│   ├── info.js          # 文件信息
│   ├── log.js           # 日志
│   ├── i18n.js          # 国际化
│   ├── theme.js         # 主题
│   └── pro.js           # 专业模式
├── src/                 # 后端逻辑
│   ├── processor.js     # 处理器
│   ├── pro-processor.js # 专业模式处理器
│   ├── backup-manager.js # 备份管理
│   ├── dds-parser.js    # DDS解析器
│   └── file-scanner.js  # 文件扫描器
└── assets/              # 资源文件
    ├── icon.ico         # 应用图标
    ├── icon.png         # 应用图标(PNG)
    └── bin/
        └── texconv.exe  # 内置纹理处理工具
```

## 版本历史

- v2.9.0：修复 exe 图标显示问题，使用 rcedit 手动注入图标，外部 assets 目录存放图标资源
- v2.8.x：CPU/GPU 全局开关，UI 优化
- v2.7.x：命令模式，备份回滚优化
- v1.9.3：初始稳定版本

## 许可证

MIT
