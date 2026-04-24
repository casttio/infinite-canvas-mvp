# Infinite Canvas 文件格式 v0.2

扩展名：`.icanvas.json`

## 顶层结构

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

- `pageBounds` 表示当前页面范围。页面不是无限大，只会在节点接近边界时自动扩展。

## 节点

- `text`：保存结构化富文本树，当前支持段落、换行、粗体、斜体。
- `image`：通过 `assetId` 引用顶层 `assets` 里的图片资源。

## 兼容策略

- 读取时保留未知字段。
- 遇到未来版本字段不主动删除。
- 保存时稳定序列化，避免无意义字段顺序波动。
- 打开文件时支持分层导入：
  - 原生 `.icanvas.json` 和内嵌 JSON 的 `.icanvas.html`
  - `onenote2xml` 导出的 `NotebookSection XML`
  - 通用 HTML 和纯文本，按外部导入处理

## 迁移

- 当前仅支持 `version = 1`。
- 当前保存输出 `version = 2`，但仍可读取 `version = 1` 并自动迁移。
- `migrateDocument` 作为统一入口，未来版本升级从这里接入。
