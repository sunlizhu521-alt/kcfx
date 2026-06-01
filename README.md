# 库存分析看板

库存分析看板是一个独立的 GitHub Pages 静态看板项目，用于供应链维护更新与关账后库存的财务口径分析。项目不依赖本地路径、不需要后端服务，浏览器端使用 SheetJS 读取 Excel，并把文件数据保存到 IndexedDB。

## 页面结构

```text
kcfx/
├── index.html              # 库存分析看板
├── fact-library.html       # 备货事实表库
├── file-library.html       # 维度表文件库
├── storage.js              # IndexedDB 与 Excel 解析
├── shared-library.js       # 共享数据包同步与导出
├── dashboard.js            # 库存宽表 Join 与看板渲染
├── library-page.js         # 文件库页面逻辑
├── styles.css              # 统一样式
└── data/
    └── shared-library.json # 给同事打开 GitHub Pages 时自动加载的数据包
```

## 文件库

### 备货事实表库

- `关账后库存事实表`
- 典型文件：`4月底物料收发汇总表`
- 第 1 行作为真实表头读取

### 维度表文件库

- `Dim-YL医疗器械商品分类-2026年整理版`
- `Dim-仓库_金蝶、旺店通、领星-2026年整理版`
- `Dim-仓库与物料对照表-2026年整理版`

## 核心关联逻辑

事业部关联使用三元联合键：

```text
联合Key = 库存组织 + 仓库名称 + 物料编码
```

商品维度按 `物料编码` 匹配：

- SKU
- 金蝶名称
- 销售产品线
- 销售系列
- 采购分组
- 财务加权平均价
- 结算价

财务估值：

```text
单价估值 = 财务加权平均价；若为 0，则使用结算价兜底
库存价值 = (结存)数量（库存） × 单价估值
```

## 本地预览

直接打开 `index.html` 即可。为了模拟 GitHub Pages 的 `data/shared-library.json` 加载，也可以开一个静态服务：

```bash
python -m http.server 8080
```

访问：

```text
http://127.0.0.1:8080
```

## 发布共享数据包

1. 打开 `fact-library.html` 和 `file-library.html` 上传 4 张 Excel。
2. 点击 `导出共享数据包`，得到 `shared-library.json`。
3. 用导出的文件替换仓库里的 `data/shared-library.json`。
4. 提交并推送到 GitHub。
5. 同事打开 GitHub Pages 链接时，页面会自动同步共享数据到浏览器 IndexedDB。

## 部署到 GitHub Pages

1. 创建 GitHub 仓库 `kcfx`。
2. 推送本项目代码到 `main`。
3. 在 GitHub 仓库设置中启用 Pages：
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
4. Pages 地址通常为：

```text
https://你的用户名.github.io/kcfx/
```

## 数据安全

`data/shared-library.json` 会包含解析后的业务数据。若包含库存、价格、仓库、事业部等敏感信息，请使用私有仓库或确认数据允许分享后再发布。
