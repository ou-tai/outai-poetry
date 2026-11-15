#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OUTAI 诗词网站 — 数据构建脚本（仅标准库）

从上游公开仓库 chinese-poetry/chinese-poetry（MIT 许可，作者 JackeyGao）
的 raw 地址下载真实 JSON，生成网站所需的派生数据文件。

用法：
    python3 scripts/build-data.py [--out DIR] [--shards N]

本脚本只在构建时访问上游；网站运行时绝不请求上游仓库，
而是从 ou-tai/outai-poetry-data（jsDelivr / raw.githubusercontent.com）
读取原始分片，或从本站 data/ 读取派生文件。

覆盖范围（诚实说明，见 data/catalog.json 的 notes）：
  - 诗经、楚辞：全量
  - 元曲：全量（yuanqu.json，11057 首）
  - 唐诗：poet.tang.0 / 1000 / ... / 19000，共 20 个分片，约 20000 首
  - 宋诗：poet.song.0 / 1000 / ... / 19000，共 20 个分片，约 20000 首
  - 宋词：ci.song.0 / 1000 / ... / 19000，共 20 个分片，约 20000 首
  - 作者文件：authors.tang.json、authors.song.json、author.song.json 全量
上游全量远大于此（唐诗约 58 个分片、宋诗约 255 个分片），未索引的
部分不在搜索/浏览范围内；如需扩大覆盖，调大 --shards 后重新运行，
并同步把对应分片放进数据仓库 ou-tai/outai-poetry-data 即可。

生成物（均在网站仓库 data/ 内）：
  - catalog.json        各文集、文件清单、数量、作者数、覆盖说明
  - daily.json          366 首每日一诗候选 + 366 首每日一词候选（含全文与出处）
  - authors.json        热门作者（按已索引作品数）及真实作者简介
  - search-index/<集>.json  轻量搜索索引：[文件, 下标, 标题, 作者, 首句]
  - shards/             本地预览用小镜像（每集首个分片 + 诗经/楚辞全量），
                        仅在 localhost 预览时被优先使用；生产环境不用它
"""
import argparse
import datetime
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UPSTREAM_RAW = "https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/"
UPSTREAM_REPO = "https://github.com/chinese-poetry/chinese-poetry"
DATA_REPO_CDN = "https://cdn.jsdelivr.net/gh/ou-tai/outai-poetry-data@main/"
DATA_REPO_RAW = "https://raw.githubusercontent.com/ou-tai/outai-poetry-data/main/"

# 上游分片编号步长为 1000（poet.tang.0 / poet.tang.1000 / ...）
SHARD_STEPS = list(range(0, 20000, 1000))  # 默认 20 个分片

COLLECTIONS = [
    {
        "id": "tang", "name": "唐诗", "dynasty": "唐", "kind": "poem",
        "dir": "全唐诗", "prefix": "poet.tang.", "files": None,  # 按步长生成
        "upstream_files": 58, "upstream_poems": 58000,
        "note": "全唐诗。字段：author / title / paragraphs / id。",
    },
    {
        "id": "song", "name": "宋诗", "dynasty": "宋", "kind": "poem",
        "dir": "全唐诗", "prefix": "poet.song.", "files": None,
        "upstream_files": 255, "upstream_poems": 255000,
        "note": "全宋诗。字段：author / title / paragraphs / id。",
    },
    {
        "id": "ci", "name": "宋词", "dynasty": "宋", "kind": "ci",
        "dir": "宋词", "prefix": "ci.song.", "files": None,
        "upstream_files": 22, "upstream_poems": 21000,
        "note": "宋词。字段：author / paragraphs / rhythmic（词牌名，无 title）。"
                 "另有 ci.song.2019y.json 未纳入本次索引。",
    },
    {
        "id": "shijing", "name": "诗经", "dynasty": "先秦", "kind": "shijing",
        "dir": "诗经", "prefix": None, "files": ["shijing.json"],
        "upstream_files": 1, "upstream_poems": 305,
        "note": "诗经全量 305 篇。字段：title / chapter / section / content。",
    },
    {
        "id": "chuci", "name": "楚辞", "dynasty": "先秦", "kind": "chuci",
        "dir": "楚辞", "prefix": None, "files": ["chuci.json"],
        "upstream_files": 1, "upstream_poems": 65,
        "note": "楚辞全量 65 篇。字段：title / section / author / content。",
    },
    {
        "id": "yuanqu", "name": "元曲", "dynasty": "元", "kind": "yuanqu",
        "dir": "元曲", "prefix": None, "files": ["yuanqu.json"],
        "upstream_files": 1, "upstream_poems": 11057,
        "note": "元曲全量 11057 首。字段：dynasty / author / paragraphs / title。",
    },
]

AUTHOR_FILES = [
    ("全唐诗/authors.tang.json", "tang"),
    ("全唐诗/authors.song.json", "song"),
    ("宋词/author.song.json", "ci"),
]

MIRROR_FILES = [  # 本地预览用小镜像：每集首个分片 + 诗经/楚辞全量
    ("tang", "全唐诗/poet.tang.0.json"),
    ("song", "全唐诗/poet.song.0.json"),
    ("ci", "宋词/ci.song.0.json"),
    ("shijing", "诗经/shijing.json"),
    ("chuci", "楚辞/chuci.json"),
]


def fetch_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "outai-poetry-build/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - 网络重试，记录后继续
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"下载失败 {url}: {last}")


def fetch_bytes(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "outai-poetry-build/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"下载失败 {url}: {last}")


def upstream_path(collection, filename):
    return UPSTREAM_RAW + urllib.parse.quote(f"{collection['dir']}/{filename}")


def normalize(collection_id, item):
    """把各文集的不同字段统一成 {title, author, lines, extra}；缺失留空，绝不编造。"""
    lines = item.get("paragraphs") or item.get("content") or []
    if isinstance(lines, str):
        lines = [lines]
    title = item.get("title") or item.get("rhythmic") or ""
    extra = {}
    for k in ("rhythmic", "chapter", "section", "dynasty"):
        if item.get(k):
            extra[k] = item[k]
    if item.get("id"):
        extra["upstream_id"] = item["id"]
    return {
        "collection": collection_id,
        "title": title,
        "author": item.get("author") or "",
        "lines": [str(x) for x in lines],
        "extra": extra,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="网站根目录（默认：脚本所在目录的上级）")
    ap.add_argument("--shards", type=int, default=20, help="唐诗/宋诗/宋词各取前 N 个分片")
    args = ap.parse_args()
    root = args.out or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(root, "data")
    index_dir = os.path.join(data_dir, "search-index")
    shards_dir = os.path.join(data_dir, "shards")
    os.makedirs(index_dir, exist_ok=True)
    os.makedirs(shards_dir, exist_ok=True)

    steps = SHARD_STEPS[: args.shards]
    catalog_collections = []
    author_counts = {}
    author_desc = {}   # name -> {desc, source}
    poem_pool = []     # 每日一诗候选：唐诗 + 宋诗 + 诗经（全文）
    ci_pool = []       # 每日一词候选：宋词（全文）
    failures = []

    for col in COLLECTIONS:
        if col["prefix"]:
            files = [f"{col['prefix']}{n}.json" for n in steps]
        else:
            files = list(col["files"])
        index = []  # [file, idx, title, author, first_line]
        total = 0
        got_files = []
        for fname in files:
            url = upstream_path(col, fname)
            try:
                items = fetch_json(url)
            except Exception as e:  # noqa: BLE001
                failures.append(f"{col['id']}/{fname}: {e}")
                print(f"  [跳过] {col['id']}/{fname} 下载失败：{e}", file=sys.stderr)
                continue
            if not isinstance(items, list):
                failures.append(f"{col['id']}/{fname}: 非数组")
                continue
            got_files.append(fname)
            for idx, item in enumerate(items):
                norm = normalize(col["id"], item)
                norm["file"] = fname
                norm["index"] = idx
                first = norm["lines"][0] if norm["lines"] else ""
                index.append([fname, idx, norm["title"], norm["author"], first])
                if norm["author"]:
                    author_counts[norm["author"]] = author_counts.get(norm["author"], 0) + 1
                if col["id"] in ("tang", "song", "shijing"):
                    poem_pool.append(norm)
                elif col["id"] == "ci":
                    ci_pool.append(norm)
            total += len(items)
            print(f"  {col['id']}/{fname}: {len(items)} 首")
        with open(os.path.join(index_dir, f"{col['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
        catalog_collections.append({
            "id": col["id"], "name": col["name"], "dynasty": col["dynasty"],
            "kind": col["kind"], "dir": col["dir"],
            "files": got_files, "indexed_count": total,
            "upstream_files": col["upstream_files"],
            "upstream_poems_approx": col["upstream_poems"],
            "note": col["note"],
        })
        print(f"[{col['id']}] 索引 {total} 首，文件 {len(got_files)}/{len(files)}")

    # 作者简介（只取上游文件确实有的 desc / description / short_description）
    for path, _src in AUTHOR_FILES:
        try:
            items = fetch_json(UPSTREAM_RAW + urllib.parse.quote(path))
        except Exception as e:  # noqa: BLE001
            failures.append(f"作者文件 {path}: {e}")
            print(f"  [跳过] 作者文件 {path}：{e}", file=sys.stderr)
            continue
        for a in items:
            name = a.get("name")
            if not name:
                continue
            desc = a.get("desc") or a.get("description") or ""
            short = a.get("short_description") or ""
            if name not in author_desc and (desc or short):
                author_desc[name] = {
                    "desc": (desc or "")[:1200],
                    "short": (short or "")[:600],
                    "source": path,
                }
        print(f"[作者] {path}: {len(items)} 条")

    top_authors = sorted(author_counts.items(), key=lambda kv: -kv[1])[:120]
    authors_out = []
    for name, count in top_authors:
        info = author_desc.get(name, {})
        authors_out.append({
            "name": name, "works_indexed": count,
            "desc": info.get("desc", ""),
            "short": info.get("short", ""),
            "desc_source": info.get("source", ""),
        })
    with open(os.path.join(data_dir, "authors.json"), "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "scope": "按已索引作品数排序的前 120 位作者；简介仅取自上游 authors 文件原文，缺失则留空。",
            "total_authors_indexed": len(author_counts),
            "authors": authors_out,
        }, f, ensure_ascii=False, indent=2)

    # 每日一诗 / 每日一词：固定种子洗牌，同一天所有人看到同一首
    rng = random.Random(20261115)
    rng.shuffle(poem_pool)
    rng.shuffle(ci_pool)

    def daily_entry(day, norm):
        return {
            "day": day,
            "collection": norm["collection"],
            "file": norm["file"],
            "index": norm["index"],
            "title": norm["title"],
            "author": norm["author"],
            "lines": norm["lines"],
            "extra": norm["extra"],
            "source": f"{norm['collection']}/{norm['file']}#{norm['index']}",
        }

    daily = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "method": "固定种子 20261115 洗牌后按年积日取第 N 首（闰年 366 天循环），"
                  "同一天所有人看到同一首；候选均来自真实数据，全文附出处。",
        "poem_pool_size": len(poem_pool),
        "ci_pool_size": len(ci_pool),
        "poems": [daily_entry(i + 1, poem_pool[i % len(poem_pool)]) for i in range(366)],
        "cis": [daily_entry(i + 1, ci_pool[i % len(ci_pool)]) for i in range(366)],
    }
    with open(os.path.join(data_dir, "daily.json"), "w", encoding="utf-8") as f:
        json.dump(daily, f, ensure_ascii=False, indent=2)

    # 本地预览用小镜像
    mirror_ok = []
    for _cid, path in MIRROR_FILES:
        try:
            raw = fetch_bytes(UPSTREAM_RAW + urllib.parse.quote(path))
            dest = os.path.join(shards_dir, path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(raw)
            mirror_ok.append(path)
        except Exception as e:  # noqa: BLE001
            failures.append(f"镜像 {path}: {e}")
    print(f"[镜像] {len(mirror_ok)} 个文件写入 data/shards/")

    catalog = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": {
            "repo": UPSTREAM_REPO,
            "license": "MIT",
            "copyright": "Copyright (c) 2016 JackeyGao（上游 chinese-poetry）",
            "note": "数据来源于上游 chinese-poetry；本站不修改原始诗词内容，"
                    "仅做分片索引与派生。运行时网站从数据仓库读取原始分片，"
                    "不直接请求上游。",
        },
        "runtime_data": {
            "cdn": DATA_REPO_CDN,
            "raw_fallback": DATA_REPO_RAW,
            "data_repo": "ou-tai/outai-poetry-data（默认分支 main）",
            "note": "原始分片优先走 jsDelivr CDN，失败回退 raw.githubusercontent.com；"
                    "catalog / daily / authors / search-index 由本站 data/ 直接提供。",
        },
        "page_size": 20,
        "collections": catalog_collections,
        "notes": [
            "索引覆盖范围（诚实口径）：诗经、楚辞、元曲为全量；"
            "唐诗、宋诗、宋词各取前 20 个分片（每分片约 1000 首），"
            "合计约 60000 首已索引；上游唐诗约 58000 首、宋诗约 255000 首、"
            "宋词约 21000 首，未索引部分暂不在浏览与搜索范围内。",
            "如需扩大覆盖：调大 --shards 重新运行本脚本，并确保对应分片"
            "已同步到数据仓库 ou-tai/outai-poetry-data。",
            "原始数据没有注释、译文、赏析；网站只展示数据确实有的字段，"
            "不虚构任何注释、译文、作者生平或赏析。",
            "作者简介仅取自上游 authors.tang.json / authors.song.json / "
            "author.song.json 的原文，缺失时留空。",
        ],
        "failures": failures,
    }
    with open(os.path.join(data_dir, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print("完成。")
    print(f"  已索引总数：{sum(c['indexed_count'] for c in catalog_collections)}")
    print(f"  每日一诗候选：{len(poem_pool)}，每日一词候选：{len(ci_pool)}")
    print(f"  作者数（已索引）：{len(author_counts)}")
    if failures:
        print(f"  警告：{len(failures)} 项失败，见 catalog.json failures", file=sys.stderr)


if __name__ == "__main__":
    main()
