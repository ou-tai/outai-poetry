# 数据来源与许可

本站诗词数据来源于上游开源项目 **chinese-poetry**：

- 上游仓库：https://github.com/chinese-poetry/chinese-poetry
- 许可：MIT License，Copyright (c) 2016 JackeyGao
- 数据仓库（本站运行时读取原始分片的来源）：ou-tai/outai-poetry-data（上游数据的独立副本，
  默认分支 main；每日自动同步上游更新）

## 使用方式

- 本站不修改原始诗词内容，仅做分片索引与派生（`data/catalog.json`、
  `data/daily.json`、`data/authors.json`、`data/search-index/` 由
  `scripts/build-data.py` 从上游公开 raw 地址下载真实 JSON 后生成）。
- 网站运行时从数据仓库读取原始分片：优先 jsDelivr CDN
  `https://cdn.jsdelivr.net/gh/ou-tai/outai-poetry-data@main/<路径>`，
  失败时回退 `https://raw.githubusercontent.com/ou-tai/outai-poetry-data/main/<路径>`。
  不在用户访问时请求上游仓库。
- `data/shards/` 只是本地预览用的小镜像（每集首个分片 + 诗经/楚辞全量），
  生产环境不依赖它。

## 诚实说明

- 原始数据**没有注释、译文、赏析**。本站只展示数据确实有的字段
  （标题/词牌、作者、正文、诗经的篇/节、元曲的朝代等），不虚构任何
  注释、译文、作者生平或赏析；作者简介仅取自上游 authors 文件原文，缺失则留空。
- 索引覆盖范围见 `data/catalog.json` 的 notes：诗经、楚辞、元曲为全量；
  唐诗、宋诗、宋词各取前 20 个分片（合计约 60000 首已索引），
  上游其余分片暂未索引。如需扩大，调大 `--shards` 重新运行构建脚本即可。
