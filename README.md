# 库存分析看板

这是独立的 GitHub Pages 库存分析项目。页面代码和文件库在同一个仓库里，但不再随链接预置业务表格数据。

## 当前共享规则

- `data/kcfx-library/manifest.json` 默认保持空记录。
- 不提交解析后的事实表、维度表 JSON 数据。
- 同事打开链接后，需要在“库存数据文件”、“销售数据文件”和“维度表文件库”重新上传并应用最新 Excel。
- 各看板页面优先读取浏览器 IndexedDB 中当前已应用的文件库记录。
- 页面加载时会清理旧版本 GitHub 共享包留下的缓存记录，但不会清理用户自己上传的本地记录。

## 主要页面

- `receipt-summary.html`：供应链库存分析。
- `comparison.html`：表格对比分析。
- `fact-library.html`：库存数据文件。
- `sales-library.html`：销售数据文件。
- `file-library.html`：维度表文件库。
- `errors.html`：报错信息提示。

## 文件库口径

库存数据文件、销售数据文件和维度表文件都通过浏览器端 SheetJS 解析，并保存到 IndexedDB：

```text
IndexedDB: kcfx-inventory-analysis-file-library/files
```

同事替换文件时，上传后需要点击应用刷新；刷新页面后仍读取当前浏览器里最新应用的版本。

## 本地预览

```bash
python -m http.server 8080
```

然后访问：

```text
http://127.0.0.1:8080/
```

## 发布

代码推送到 GitHub 后由 GitHub Pages 发布。共享链接只发布页面框架和空文件库清单，不发布业务数据。
