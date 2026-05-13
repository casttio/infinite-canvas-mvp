# Infinite Canvas MVP

一个以 HTML 为核心文件格式的开源富文本无限画布笔记工具。

它不是把笔记锁进私有数据库，而是把完整画布保存成可打开、可预览、可恢复编辑的 `.icanvas.html` 文件：双击就是一份普通 HTML，放回应用里又是完整工程文件。

## 核心优势

- **HTML 即文件**：默认保存为 `.icanvas.html`，文件内同时包含可读预览和完整画布 JSON 数据，浏览器能看，应用能继续编辑。
- **开放格式**：原生 `.icanvas.json` 是结构化 JSON，文本节点、图片、附件、连线、时间线等数据都可被脚本读取、转换和版本管理。
- **富文本保真**：支持段落、标题、字体、字号、颜色、高亮、链接、表格、内联图片等富文本内容，适合从网页、OneNote、文档资料中整理复杂信息。
- **不依赖云端账号**：本地文件就是资料本体，方便同步盘、Git、备份系统或任意文件夹工作流管理。
- **面向迁移和归档**：支持导入 HTML、OneNote XML、纯文本和原生画布文件，避免资料长期困在单一笔记软件里。

普通无限画布能力也包含：文本节点、图片/HTML/PDF 资源预览、形状、连线、多页、搜索、时间线节点、Web 版和 Electron 桌面版。

## 为什么和常见笔记软件不同

很多笔记软件重视编辑体验，但数据最终落在私有数据库、云服务或难以人工检查的二进制格式里。Infinite Canvas MVP 的重点是：

- 笔记文件可以直接作为 HTML 分享或归档。
- 数据结构透明，适合开发者二次处理。
- 富文本和画布布局一起保存，不需要导出后丢失编辑能力。
- 文件可以进入 Git diff、脚本批处理、长期备份和跨工具迁移流程。

## 快速开始

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址即可使用 Web 版。

桌面版开发：

```bash
npm run electron:dev
```

构建：

```bash
npm run build
npm run exe
```

## 支持格式

- `.icanvas.html`：推荐格式，HTML 预览 + 内嵌完整画布数据。
- `.icanvas.json`：开放 JSON 工程文件。
- `.html` / `.htm`：作为 HTML 资料导入并在画布中预览。
- OneNote XML：用于从 OneNote 导出的结构化内容迁移。
- `.txt`：纯文本导入。

## 技术栈

React 19、TypeScript、Vite、TipTap、Cytoscape、Electron。

## 开源协议

MIT
