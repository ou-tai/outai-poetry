# OUTAI 诗词 · 东方诗词沉浸式阅读网站

中华古典诗词歌赋的独立数字阅读空间：唐诗、宋诗、宋词、诗经、楚辞、元曲。
东方诗意沉浸式设计（水墨山水、月色云雾、留白），纯静态、无后端、无数据库、无付费服务。

正式地址：**https://s.outaidage.xyz**

## 功能

- 首页每日一诗、每日一词（按年积日确定性选取，同一天所有人看到同一首）
- 随机发现 / 随机诗词
- 分类浏览：唐诗、宋诗、宋词、诗经、楚辞、元曲（以实际数据为准），每页 20 首
- 全文搜索：标题 / 作者 / 正文首句（本地分片索引），另有「全文深搜」逐分片扫描正文
- 按作者检索与作者作品集；题材按关键词检索（月、山水、思乡、送别、相思、田园、边塞、四季）
- 诗词详情：原文、作者、来源分片与出处；收藏、阅读历史（localStorage，本机保存）
- 夜间模式（跟随系统，可手动切换）、全屏 / 沉浸阅读、分享（Web Share API，失败时复制文本回退）
- 响应式（手机 / 平板 / 桌面）、动画克制并支持 `prefers-reduced-motion`
- 加载失败友好提示与重试；数据分片按需加载，绝不一次性加载几十万首

**不虚构内容**：原始数据没有注释、译文、赏析，本站只展示数据确实有的字段；
作者简介仅取自上游 authors 文件原文，缺失则留空。

## 数据来源与许可

数据来源于上游开源项目 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)
（MIT 许可，Copyright © 2016 JackeyGao）。本站运行时从数据仓库
`ou-tai/outai-poetry-data`（独立副本，每日自动同步，默认分支 main）读取原始分片，
优先 jsDelivr CDN，失败回退 `raw.githubusercontent.com`；不在用户访问时请求上游。
详见 [data/ATTRIBUTION.md](data/ATTRIBUTION.md)，覆盖范围见 `data/catalog.json` 的 notes。

**索引覆盖（本次构建实测）**：已索引 **71,438** 首——唐诗 20,011、宋诗 20,000、
宋词 20,000、诗经 305（全量）、楚辞 65（全量）、元曲 11,057（全量）；
每日一诗候选 40,316 首、每日一词候选 20,000 首；索引内作者 3,496 位。
唐诗、宋诗、宋词各取前 20 个分片，上游其余分片暂未索引。

## 本地预览

```bash
cd outai-poetry   # 网站仓库根目录
python3 -m http.server 8000
# 打开 http://localhost:8000/
```

> 不能直接双击打开 `index.html`：浏览器安全限制下 `fetch` 读不到本地数据文件。
> 本地预览时原始分片优先走 `data/shards/` 小镜像（每集首个分片 + 诗经/楚辞全量），
> 因此首页每日一诗/一词、诗经/楚辞浏览可完整验证；唐诗/宋诗/宋词超出首个分片的
> 内容在本地会显示加载失败——这是预期的，因为生产环境走 CDN/数据仓库，
> 本地镜像只是预览用的子集。

## 重新生成数据

```bash
python3 scripts/build-data.py            # 默认唐诗/宋诗/宋词各前 20 个分片
python3 scripts/build-data.py --shards 30  # 扩大覆盖（需同步对应分片到数据仓库）
```

仅用 Python 标准库；构建时从上游公开 raw 地址下载真实 JSON，生成
`data/catalog.json`、`data/daily.json`、`data/authors.json`、
`data/search-index/*.json` 与 `data/shards/` 预览镜像。

## 部署（GitHub Pages）

- 工作流：`.github/workflows/deploy.yml`，用官方 `actions/upload-pages-artifact` +
  `actions/deploy-pages` 从根目录部署（Pages source 选 **GitHub Actions**）。
- 自定义域名：仓库根目录已有 `CNAME` 文件，内容为 `s.outaidage.xyz`。
- 在仓库 Settings → Pages → Custom domain 填 `s.outaidage.xyz`，并开启 **Enforce HTTPS**。

## DNS 指引（需域名持有人在 DNS 服务商处操作，本仓库不改动任何 DNS）

域名 `s.outaidage.xyz` 需要一条 CNAME 记录：

| 类型 | 名称/主机记录 | 值 | TTL |
| --- | --- | --- | --- |
| CNAME | `s` | `ou-tai.github.io` | 自动/默认 |

- 不要改动 `outaidage.xyz` 主站或其他已有记录，只加这一条。
- 如 DNS 在 Cloudflare：该 CNAME 可保持代理（橙色云）以使用 Cloudflare CDN，
  也可以先设为仅 DNS（灰色云）验证通过后再开代理；GitHub Pages 侧仍需做
  自定义域名验证，证书由 GitHub Pages 自动签发。
- DNS 生效后访问 https://s.outaidage.xyz 验证：能打开且浏览器显示 HTTPS 锁形标志即正常；
  若提示证书错误，通常是 DNS 未生效或 Pages 自定义域名尚未验证通过，等待生效后重试。

## 目录结构

```
index.html                  单页应用入口（hash 路由）
assets/css/style.css        东方诗意样式（月色、远山、云雾、留白）
assets/js/app.js            全部前端逻辑（数据加载、搜索、收藏、历史、分享等）
data/catalog.json           文集清单、数量、覆盖说明
data/daily.json             366 首每日一诗 + 366 首每日一词（含全文与出处）
data/authors.json           热门作者（按已索引作品数）及真实简介
data/search-index/*.json    轻量搜索索引（[文件, 下标, 标题, 作者, 首句]）
data/shards/                本地预览用小镜像
data/ATTRIBUTION.md         数据来源、许可与诚实说明
scripts/build-data.py       数据构建脚本（标准库 only）
.github/workflows/deploy.yml  GitHub Pages 部署
CNAME                       s.outaidage.xyz
```
