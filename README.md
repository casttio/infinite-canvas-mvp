# Infinite Canvas MVP

无限画布编辑器，支持富文本、图片、节点管理。Web 应用 + Electron 桌面版（Windows/Linux）。

## 快速开始

```bash
npm install
npm run dev          # Web 开发 http://localhost:5173
npm run electron:dev # Electron 开发
npm run build        # 构建 Web 版本
npm run exe          # 构建 Windows 便携版
```

## 技术栈

React 19 + TypeScript / Vite 6 / TipTap 3 / Cytoscape 3 / Electron 30

## 项目结构

```
src/
├── editor/   # 画布编辑器核心
├── ui/       # React UI 组件
├── nodes/    # 节点类型和逻辑
├── model/    # 数据模型
└── file/     # 导入导出
electron/     # Electron 主进程
```

## 导入支持

`.icanvas.json`（原生）、`.icanvas.html`、OneNote XML、HTML、纯文本

## 许可证

MIT
