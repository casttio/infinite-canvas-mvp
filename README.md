# Infinite Canvas MVP

一个功能丰富的无限画布编辑器，支持富文本编辑、图片插入、节点管理和多种导入格式。可作为 Web 应用或桌面应用（Windows/Linux）使用。

## 特性

- 🎨 **无限画布** - 自动扩展的编辑空间，随着内容增长而扩展
- 📝 **富文本编辑** - 支持段落、换行、粗体、斜体等格式（基于 TipTap）
- 🖼️ **图片支持** - 插入和管理图片资源
- 🔗 **多格式导入** - 支持 OneNote XML、HTML、纯文本导入
- 💾 **自定义格式** - `.icanvas.json` 格式保存文档
- 🖥️ **跨平台** - Web 应用和 Electron 桌面应用
- 📦 **节点管理** - 灵活的节点系统和关系管理

## 技术栈

- **前端框架**: React 19 + TypeScript
- **构建工具**: Vite 6
- **富文本编辑**: TipTap 3
- **图表/节点**: Cytoscape 3
- **桌面应用**: Electron 30
- **数据验证**: Zod 3

## 快速开始

### 环境要求

- Node.js 18+ (推荐 20+)
- npm 10+

### 安装依赖

```bash
npm install
```

### 开发模式

**Web 开发服务器**:
```bash
npm run dev
```
访问 http://localhost:5173

**Electron 开发**:
```bash
npm run electron:dev
```

### 构建

**Web 版本**:
```bash
npm run build
```

**桌面应用**:

Linux (AppImage):
```bash
npm run desktop:build
```

Windows (便携式):
```bash
npm run exe
```

快速构建（跳过 TypeScript 编译）:
```bash
npm run exe:fast
```

## 项目结构

```
infinite-canvas-mvp/
├── src/
│   ├── main.tsx           # React 应用入口
│   ├── styles.css         # 全局样式
│   ├── editor/            # 编辑器核心组件
│   ├── ui/                # UI 组件
│   ├── nodes/             # 节点类型定义
│   ├── model/             # 数据模型
│   └── file/              # 文件操作相关
├── electron/              # Electron 主进程代码
├── dist/                  # 构建输出
├── release/               # 应用发布包
├── scripts/               # 构建和开发脚本
├── sample/                # 示例文件
├── spec-v0.1.md          # 文件格式规范
└── vite.config.ts        # Vite 配置
```

## 文件格式

Infinite Canvas 使用自定义的 `.icanvas.json` 格式存储文档。

### 基本结构

```json
{
  "format": "icanvas",
  "version": 2,
  "meta": {
    "id": "doc_xxx",
    "createdAt": "2026-04-22T00:00:00.000Z",
    "updatedAt": "2026-04-22T00:00:00.000Z"
  },
  "nodes": [],
  "assets": {},
  "pageBounds": {
    "x": 0,
    "y": 0,
    "w": 1600,
    "h": 1200
  },
  "viewState": {
    "cameraX": 120,
    "cameraY": 80,
    "zoom": 1
  }
}
```

### 节点类型

- **text** - 结构化富文本节点，支持段落、换行、粗体、斜体
- **image** - 图片节点，通过 `assetId` 引用资源

详见 [spec-v0.1.md](./spec-v0.1.md)

## 导入支持

系统支持以下格式的导入：

- `.icanvas.json` - 原生格式
- `.icanvas.html` - 嵌入 JSON 的 HTML
- `NotebookSection XML` - OneNote 2016/2019/365 导出格式
- 通用 HTML
- 纯文本

## 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Web 开发服务器 |
| `npm run electron:dev` | 启动 Electron 开发应用 |
| `npm run build` | 构建 Web 版本 |
| `npm run desktop:build` | 构建 Linux AppImage |
| `npm run desktop:dir` | 构建 Linux 目录版本 |
| `npm run desktop:win` | 构建 Windows 便携式 |
| `npm run exe` | 快捷命令，等同于 `npm run desktop:win` |
| `npm run exe:fast` | 快速构建（跳过 TS 编译） |
| `npm run release:patch` | 发布补丁版本并构建 Windows 应用 |
| `npm run preview` | 预览已构建的应用 |

## 开发提示

### TypeScript 编译

项目使用了 TypeScript 项目引用来优化编译：

```bash
npm run build  # 完整构建，包括 TS 编译
```

### 样式

全局样式在 `src/styles.css` 中定义。

### 核心模块

- **editor/** - 画布编辑器核心实现
- **ui/** - React UI 组件
- **model/** - 数据模型和类型定义
- **nodes/** - 节点类型和处理逻辑
- **file/** - 文件导入导出和格式转换

## 许可证

TODO: 添加许可证信息

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**版本**: 0.1.1  
**最后更新**: 2026 年 4 月
