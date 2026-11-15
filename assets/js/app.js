/* OUTAI 诗词 — 纯静态单页应用（无构建、无后端）
   数据流：
   - catalog / daily / authors / search-index：本站 data/ 直接提供，随页面同源加载。
   - 原始诗词分片：优先 jsDelivr CDN（ou-tai/outai-poetry-data@main），
     失败回退 raw.githubusercontent.com；localhost 预览时优先 data/shards/ 本地镜像。
   - 运行时绝不请求上游 chinese-poetry 仓库。
   - 原始数据没有注释 / 译文 / 赏析，本站只展示数据确实有的字段，绝不虚构。 */
(function () {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/gh/ou-tai/outai-poetry-data@main/';
  var RAW = 'https://raw.githubusercontent.com/ou-tai/outai-poetry-data/main/';
  var IS_LOCAL = ['localhost', '127.0.0.1', ''].indexOf(location.hostname) !== -1;
  var PAGE_SIZE = 20;

  var THEMES = [
    { id: 'moon', name: '月', words: ['月'] },
    { id: 'mountain-water', name: '山水', words: ['山', '水', '江', '湖', '溪'] },
    { id: 'homesick', name: '思乡', words: ['乡', '故乡', '归', '思乡'] },
    { id: 'farewell', name: '送别', words: ['送', '别', '赠', '离别'] },
    { id: 'love', name: '相思', words: ['相思', '情', '思君'] },
    { id: 'pastoral', name: '田园', words: ['田园', '农', '村', '桑麻'] },
    { id: 'frontier', name: '边塞', words: ['塞', '边关', '征', '战', '胡'] },
    { id: 'seasons', name: '四季', words: ['春', '夏', '秋', '冬'] }
  ];

  var app = document.getElementById('app');
  var cache = { catalog: null, daily: null, authors: null, index: {}, shard: {} };
  var currentRoute = null;

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function encPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }
  function fetchJSON(url, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' · ' + url);
      return r.json();
    }).catch(function (e) {
      clearTimeout(timer);
      throw e;
    });
  }
  function loadLocal(rel) { return fetchJSON(rel); }

  /* 原始分片：CDN -> raw 回退；本地预览时先试 data/shards/ 镜像 */
  function shardBases() {
    if (IS_LOCAL) return ['data/shards/', CDN, RAW];
    return [CDN, RAW];
  }
  function loadShard(col, file) {
    var key = col.id + '/' + file;
    if (cache.shard[key]) return Promise.resolve(cache.shard[key]);
    var rel = col.dir + '/' + file;
    var bases = shardBases();
    var chain = Promise.reject(new Error('start'));
    bases.forEach(function (base) {
      chain = chain.catch(function () { return fetchJSON(base + encPath(rel)); });
    });
    return chain.then(function (data) {
      cache.shard[key] = data;
      return data;
    });
  }
  function loadIndex(colId, onProgress) {
    if (cache.index[colId]) return Promise.resolve(cache.index[colId]);
    if (onProgress) onProgress('正在加载' + colName(colId) + '索引……');
    return loadLocal('data/search-index/' + colId + '.json').then(function (idx) {
      cache.index[colId] = idx;
      return idx;
    });
  }
  function loadAllIndexes(onProgress) {
    var ids = ['tang', 'song', 'ci', 'shijing', 'chuci', 'yuanqu'];
    var chain = Promise.resolve();
    var out = {};
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return loadIndex(id, onProgress).then(function (idx) { out[id] = idx; });
      });
    });
    return chain.then(function () { return out; });
  }
  function getCatalog() {
    return cache.catalog ? Promise.resolve(cache.catalog)
      : loadLocal('data/catalog.json').then(function (c) { cache.catalog = c; return c; });
  }
  function getDaily() {
    return cache.daily ? Promise.resolve(cache.daily)
      : loadLocal('data/daily.json').then(function (d) { cache.daily = d; return d; });
  }
  function getAuthors() {
    return cache.authors ? Promise.resolve(cache.authors)
      : loadLocal('data/authors.json').then(function (a) { cache.authors = a; return a; });
  }
  function colById(id) {
    return (cache.catalog.collections || []).filter(function (c) { return c.id === id; })[0] || null;
  }
  function colName(id) {
    var c = cache.catalog && colById(id);
    return c ? c.name : id;
  }
  function dayOfYear(d) {
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }
  function normalizeItem(colId, item) {
    return {
      collection: colId,
      title: item.title || item.rhythmic || '',
      author: item.author || '',
      lines: item.paragraphs || item.content || [],
      extra: { rhythmic: item.rhythmic, chapter: item.chapter, section: item.section, dynasty: item.dynasty }
    };
  }
  function poemUrl(ref) {
    return '#/poem/' + ref.collection + '/' + encodeURIComponent(ref.file) + '/' + ref.index;
  }
  function authorUrl(name) { return '#/author/' + encodeURIComponent(name); }

  /* ---------- 收藏 / 历史（localStorage） ---------- */
  function store(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }
  function saveStore(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) { /* 存储满则静默失败 */ }
  }
  function favKey(ref) { return ref.collection + '|' + ref.file + '|' + ref.index; }
  function isFav(ref) {
    return store('outai-poetry-favs').some(function (f) { return f.key === favKey(ref); });
  }
  function toggleFav(ref) {
    var list = store('outai-poetry-favs');
    var k = favKey(ref);
    var i = list.findIndex(function (f) { return f.key === k; });
    if (i >= 0) { list.splice(i, 1); toast('已取消收藏'); }
    else {
      list.unshift({ key: k, collection: ref.collection, file: ref.file, index: ref.index,
        title: ref.title || '', author: ref.author || '', first: (ref.lines && ref.lines[0]) || '' });
      toast('已收藏');
    }
    saveStore('outai-poetry-favs', list.slice(0, 500));
    return i < 0;
  }
  function recordHistory(ref) {
    var list = store('outai-poetry-history');
    var k = favKey(ref);
    list = list.filter(function (h) { return h.key !== k; });
    list.unshift({ key: k, collection: ref.collection, file: ref.file, index: ref.index,
      title: ref.title || '', author: ref.author || '', first: (ref.lines && ref.lines[0]) || '',
      at: new Date().toISOString() });
    saveStore('outai-poetry-history', list.slice(0, 50));
  }

  /* ---------- 通用渲染 ---------- */
  function setHTML(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function errorBox(title, detail) {
    return '<div class="error-box"><h3>' + esc(title) + '</h3><p>' + esc(detail) + '</p>' +
      '<p class="note">可能原因：网络不通、数据仓库尚未同步完成，或 CDN 暂时不可用。' +
      '数据不会因此丢失，稍后可重试。</p>' +
      '<button class="btn primary" data-action="retry">重新加载</button> ' +
      '<a class="btn" href="#/">返回首页</a></div>';
  }
  function pagerHTML(total, page, baseHash) {
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    page = Math.min(Math.max(1, page), pages);
    var q = function (p) { return baseHash + (baseHash.indexOf('?') >= 0 ? '&' : '?') + 'page=' + p; };
    return '<div class="pager">' +
      (page > 1 ? '<a class="btn small" href="' + q(page - 1) + '">上一页</a>' : '<button class="btn small" disabled>上一页</button>') +
      '<span class="info">第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 首</span>' +
      (page < pages ? '<a class="btn small" href="' + q(page + 1) + '">下一页</a>' : '<button class="btn small" disabled>下一页</button>') +
      '</div>';
  }
  function listHTML(refs, page, baseHash) {
    var total = refs.length;
    var slice = refs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!total) return '<p class="empty">没有找到符合条件的作品。</p>';
    var html = '<ul class="list">' + slice.map(function (r) {
      return '<li><a href="' + poemUrl(r) + '"><span class="t">' + esc(r.title || '（无题）') + '</span>' +
        (r.author ? '<span class="a">' + esc(r.author) + '</span>' : '') +
        (r.first ? '<div class="l">' + esc(r.first) + '</div>' : '') + '</a></li>';
    }).join('') + '</ul>';
    return html + pagerHTML(total, page, baseHash);
  }
  function refFromIndex(colId, entry) {
    return { collection: colId, file: entry[0], index: entry[1], title: entry[2], author: entry[3], first: entry[4] };
  }

  /* ---------- 各页面 ---------- */
  function renderHome() {
    return Promise.all([getCatalog(), getDaily(), getAuthors()]).then(function (res) {
      var catalog = res[0], daily = res[1], authors = res[2];
      var doy = dayOfYear(new Date());
      var poem = daily.poems[(doy - 1) % daily.poems.length];
      var ci = daily.cis[(doy - 1) % daily.cis.length];
      var total = catalog.collections.reduce(function (s, c) { return s + c.indexed_count; }, 0);
      var today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
      var dailyCard = function (label, item) {
        return '<div class="card daily-card"><h3>' + label + ' · ' + esc(today) + '</h3>' +
          '<div class="t">' + esc(item.title || '（无题）') + '</div>' +
          '<div class="a">' + esc(item.author || '') + ' · ' + esc(colName(item.collection)) + '</div>' +
          '<div class="l">' + item.lines.slice(0, 2).map(esc).join('<br>') + '</div>' +
          '<a class="btn small" href="' + poemUrl(item) + '">读全文</a></div>';
      };
      var cols = catalog.collections.map(function (c) {
        return '<a class="col-card" href="#/browse/' + c.id + '"><span class="n">' + esc(c.name) + '</span>' +
          '<span class="c">' + esc(c.dynasty) + ' · 已索引 ' + c.indexed_count.toLocaleString() + ' 首</span></a>';
      }).join('');
      var chips = THEMES.map(function (t) {
        return '<a class="chip" href="#/search?theme=' + t.id + '">' + esc(t.name) + '</a>';
      }).join('');
      setHTML(
        '<section class="card hero"><h1>OUTAI 诗词</h1>' +
        '<p class="sub">月色 · 云雾 · 远山 · 江河</p>' +
        '<p class="verse">“海上生明月，天涯共此时。”</p>' +
        '<div class="hero-actions"><button class="btn primary" data-action="random">随机发现一首</button>' +
        '<a class="btn" href="#/browse/tang">读唐诗</a><a class="btn" href="#/browse/ci">读宋词</a></div></section>' +
        '<div class="daily-grid">' + dailyCard('每日一诗', poem) + dailyCard('每日一词', ci) + '</div>' +
        '<h2 class="section-title">文集 <small>按朝代与文集分片 · 点开再加载 · 已索引 ' + total.toLocaleString() + ' 首 · 作者 ' + authors.total_authors_indexed + ' 位</small></h2>' +
        '<div class="grid">' + cols + '</div>' +
        '<h2 class="section-title">题材</h2><div class="chips">' + chips + '</div>' +
        '<p class="note" style="margin-top:16px">题材按关键词检索标题与正文首句。原始数据没有题材标签，' +
        '本站不做虚构分类；想查正文任意位置，可在搜索结果页使用「全文深搜」。</p>'
      );
    });
  }

  function renderBrowse(colId, page, authorFilter) {
    var col = colById(colId);
    if (!col) { setHTML(errorBox('没有这个文集', '文集 id 为 ' + colId + '，请从首页重新选择。')); return Promise.resolve(); }
    setHTML('<p class="loading">正在加载' + esc(col.name) + '索引……</p>');
    return loadIndex(colId).then(function (idx) {
      var refs = idx.map(function (e) { return refFromIndex(colId, e); });
      if (authorFilter) refs = refs.filter(function (r) { return r.author === authorFilter; });
      var base = '#/browse/' + colId + (authorFilter ? '?author=' + encodeURIComponent(authorFilter) : '');
      setHTML('<h2 class="section-title">' + esc(col.name) +
        ' <small>' + esc(col.dynasty) + ' · 已索引 ' + idx.length.toLocaleString() + ' 首' +
        (authorFilter ? ' · 作者：' + esc(authorFilter) + '（<a href="#/browse/' + colId + '">清除</a>）' : '') + '</small></h2>' +
        '<p class="note">' + esc(col.note || '') + ' 每页 20 首，点击标题读全文。</p>' +
        listHTML(refs, page, base));
    });
  }

  function renderDetail(colId, file, idx) {
    var col = colById(colId);
    if (!col) { setHTML(errorBox('没有这个文集', '文集 id 为 ' + colId)); return Promise.resolve(); }
    setHTML('<p class="loading">正在取诗……</p>');
    return loadShard(col, file).then(function (items) {
      var item = items[idx];
      if (!item) throw new Error('该分片中没有第 ' + idx + ' 首');
      var poem = normalizeItem(colId, item);
      poem.file = file; poem.index = idx;
      recordHistory(poem);
      var extra = [];
      if (poem.extra.rhythmic) extra.push('词牌：' + poem.extra.rhythmic);
      if (poem.extra.chapter) extra.push('篇：' + poem.extra.chapter);
      if (poem.extra.section) extra.push('节：' + poem.extra.section);
      if (poem.extra.dynasty) extra.push('朝代：' + poem.extra.dynasty);
      var fav = isFav(poem);
      setHTML('<article class="card reader" id="reader">' +
        '<p class="small"><a href="#/">首页</a> / <a href="#/browse/' + colId + '">' + esc(col.name) + '</a></p>' +
        '<h2 class="poem-title">' + esc(poem.title || '（无题）') + '</h2>' +
        '<p class="poem-meta">' + (poem.author ? '<a href="' + authorUrl(poem.author) + '">' + esc(poem.author) + '</a> · ' : '') +
        esc(col.name) + (extra.length ? ' · ' + esc(extra.join(' · ')) : '') + '</p>' +
        '<div class="poem-body">' + poem.lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>' +
        '<p class="small">来源：' + esc(col.dir + '/' + file) + ' 第 ' + (idx + 1) + ' 首 · 数据：chinese-poetry（MIT）</p>' +
        '<p class="note">原始数据不含注释、译文与赏析；此处仅展示原文，不作虚构补充。</p>' +
        '<div class="toolbar">' +
        '<button class="btn" data-action="fav" data-fav="' + (fav ? '1' : '0') + '">' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>' +
        '<button class="btn" data-action="share">分享</button>' +
        '<button class="btn" data-action="copy-text">复制全文</button>' +
        '<button class="btn" data-action="fullscreen">全屏阅读</button>' +
        (poem.author ? '<a class="btn" href="' + authorUrl(poem.author) + '">作者作品集</a>' : '') +
        '</div></article>');
      currentRoute.poem = poem;
    });
  }

  function renderAuthor(name, page) {
    setHTML('<p class="loading">正在查找 ' + esc(name) + ' 的作品……</p>');
    return Promise.all([getAuthors(), loadAllIndexes()]).then(function (res) {
      var authors = res[0], allIdx = res[1];
      var info = (authors.authors || []).filter(function (a) { return a.name === name; })[0];
      var refs = [];
      Object.keys(allIdx).forEach(function (cid) {
        allIdx[cid].forEach(function (e) {
          if (e[3] === name) refs.push(refFromIndex(cid, e));
        });
      });
      var desc = info && (info.desc || info.short)
        ? '<div class="author-desc">' + esc(info.desc || info.short) + '</div><p class="small">简介来源：上游 ' + esc(info.desc_source || 'authors 文件') + '原文；未提供时留空。</p>'
        : '<p class="note">上游 authors 文件未提供该作者的简介，本站不虚构生平。</p>';
      setHTML('<h2 class="section-title">' + esc(name) + ' <small>已索引作品 ' + refs.length + ' 首（仅限已索引范围）</small></h2>' +
        '<div class="card">' + desc + '</div>' +
        listHTML(refs, page, '#/author/' + encodeURIComponent(name)));
    });
  }

  function renderAuthors() {
    return getAuthors().then(function (a) {
      var rows = (a.authors || []).map(function (x) {
        return '<li data-name="' + esc(x.name) + '"><a href="' + authorUrl(x.name) + '"><span class="t">' + esc(x.name) + '</span>' +
          '<span class="a">已索引 ' + x.works_indexed + ' 首</span>' +
          (x.short ? '<div class="l">' + esc(x.short.slice(0, 60)) + '……</div>' : '') + '</a></li>';
      }).join('');
      setHTML('<h2 class="section-title">作者 <small>按已索引作品数排序的前 120 位 · 共 ' + a.total_authors_indexed + ' 位作者在索引中</small></h2>' +
        '<p class="note">在下方输入框中筛选作者；简介仅取自上游 authors 文件原文。</p>' +
        '<div class="searchbar" style="margin:0 0 12px; padding:0"><form id="authorFilterForm">' +
        '<input id="authorFilter" type="search" placeholder="筛选作者，如：李白" aria-label="筛选作者"></form></div>' +
        '<ul class="list" id="authorList">' + rows + '</ul>');
      var input = document.getElementById('authorFilter');
      var list = document.getElementById('authorList');
      input.addEventListener('input', function () {
        var q = input.value.trim();
        Array.prototype.forEach.call(list.children, function (li) {
          li.style.display = !q || li.getAttribute('data-name').indexOf(q) >= 0 ? '' : 'none';
        });
      });
      document.getElementById('authorFilterForm').addEventListener('submit', function (e) { e.preventDefault(); });
    });
  }

  function doSearch(q, scope, themeId, page) {
    var theme = themeId ? THEMES.filter(function (t) { return t.id === themeId; })[0] : null;
    var label = theme ? '题材「' + theme.name + '」' : '“' + q + '”';
    var scopeIds = scope === 'all' ? ['tang', 'song', 'ci', 'shijing', 'chuci', 'yuanqu'] : [scope];
    setHTML('<p class="loading">正在搜索' + esc(label) + '……</p>');
    var chain = Promise.resolve();
    var refs = [];
    scopeIds.forEach(function (id) {
      chain = chain.then(function () {
        setHTML('<p class="loading">正在加载' + esc(colName(id)) + '索引并搜索' + esc(label) + '……</p>');
        return loadIndex(id).then(function (idx) {
          idx.forEach(function (e) {
            var hit;
            if (theme) {
              hit = theme.words.some(function (w) {
                return (e[2] + ' ' + e[3] + ' ' + e[4]).indexOf(w) >= 0;
              });
            } else {
              var hay = (e[2] + ' ' + e[3] + ' ' + e[4]).toLowerCase();
              hit = hay.indexOf(q.toLowerCase()) >= 0;
            }
            if (hit) refs.push(refFromIndex(id, e));
          });
        });
      });
    });
    return chain.then(function () {
      var base = '#/search?' + (theme ? 'theme=' + theme.id : 'q=' + encodeURIComponent(q)) + '&c=' + scope;
      var deepBtn = (!theme && scope !== 'all')
        ? '<p><button class="btn" data-action="deep-search" data-q="' + esc(q) + '" data-scope="' + esc(scope) + '">全文深搜：在正文任意位置查找（需加载该文集已索引的全部正文分片，较慢）</button></p>'
        : '<p class="note">全文深搜需指定单一文集（全部文集范围太大）；请先选一个文集再深搜。</p>';
      setHTML('<h2 class="section-title">搜索 ' + esc(label) + ' <small>' + esc(scope === 'all' ? '全部文集' : colName(scope)) + ' · 命中 ' + refs.length + ' 首（标题 / 作者 / 首句）</small></h2>' +
        deepBtn + '<div id="deepResult"></div>' + listHTML(refs, page, base));
      currentRoute.search = { q: q, scope: scope, theme: themeId, refs: refs };
    });
  }

  function deepSearch(q, scope) {
    var col = colById(scope);
    var box = document.getElementById('deepResult');
    if (!box || !col) return Promise.resolve();
    box.innerHTML = '<div class="progress"><div style="width:4%"></div></div><p class="loading">正在逐分片扫描正文……</p>';
    var files = col.files;
    var hits = [];
    var chain = Promise.resolve();
    files.forEach(function (file, fi) {
      chain = chain.then(function () {
        box.querySelector('.progress > div').style.width = Math.round((fi / files.length) * 100) + '%';
        return loadShard(col, file).then(function (items) {
          items.forEach(function (item, idx) {
            var poem = normalizeItem(scope, item);
            var text = poem.lines.join('\n');
            if (text.indexOf(q) < 0) return;
            var line = poem.lines.filter(function (l) { return l.indexOf(q) >= 0; })[0] || poem.lines[0] || '';
            hits.push({ collection: scope, file: file, index: idx, title: poem.title, author: poem.author, first: line });
          });
        }).catch(function () { /* 单个分片失败则跳过，继续其余分片 */ });
      });
    });
    return chain.then(function () {
      box.innerHTML = '<h3 class="section-title">全文深搜结果 <small>命中 ' + hits.length + ' 首（正文任意位置）</small></h3>' +
        listHTML(hits.slice(0, 200), 1, '#/search?q=' + encodeURIComponent(q) + '&c=' + scope) +
        (hits.length > 200 ? '<p class="note">仅显示前 200 首。</p>' : '');
      toast('全文深搜完成，命中 ' + hits.length + ' 首');
    });
  }

  function renderSimpleList(title, items, emptyText, actions) {
    var html = '<h2 class="section-title">' + esc(title) + ' <small>保存在本机浏览器中</small></h2>';
    if (actions) html += '<div class="toolbar">' + actions + '</div>';
    if (!items.length) return html + '<p class="empty">' + esc(emptyText) + '</p>';
    html += '<ul class="list">' + items.map(function (r) {
      return '<li><a href="' + poemUrl(r) + '"><span class="t">' + esc(r.title || '（无题）') + '</span>' +
        (r.author ? '<span class="a">' + esc(r.author) + '</span>' : '') +
        '<div class="l">' + esc(r.first || '') + '</div>' +
        (r.at ? '<div class="small">' + esc(new Date(r.at).toLocaleString('zh-CN')) + '</div>' : '') +
        '</a></li>';
    }).join('') + '</ul>';
    return html;
  }

  function randomPoem() {
    var ids = ['tang', 'song', 'ci', 'shijing', 'chuci', 'yuanqu'];
    var id = ids[Math.floor(Math.random() * ids.length)];
    toast('正在为你取一首' + colName(id) + '……');
    return loadIndex(id).then(function (idx) {
      var e = idx[Math.floor(Math.random() * idx.length)];
      location.hash = poemUrl(refFromIndex(id, e));
    });
  }

  /* ---------- 路由 ---------- */
  function parseHash() {
    var raw = location.hash.replace(/^#/, '');
    var parts = raw.split('?');
    var path = parts[0] || '/';
    var query = new URLSearchParams(parts[1] || '');
    return { path: path, query: query };
  }
  function setActiveNav(path) {
    Array.prototype.forEach.call(document.querySelectorAll('.nav a'), function (a) {
      var href = a.getAttribute('href');
      a.classList.toggle('active', href === '#' + (path === '/' ? '/' : path.split('/').slice(0, 3).join('/')) ||
        (path === '/' && href === '#/'));
    });
  }
  function route() {
    document.body.classList.remove('reading');
    var r = parseHash();
    currentRoute = { path: r.path };
    setActiveNav(r.path);
    var seg = r.path.split('/').filter(Boolean);
    var page = Math.max(1, parseInt(r.query.get('page') || '1', 10) || 1);
    var job;
    if (seg.length === 0) job = renderHome();
    else if (seg[0] === 'browse' && seg[1]) job = renderBrowse(seg[1], page, r.query.get('author') || '');
    else if (seg[0] === 'poem' && seg[2] !== undefined) job = renderDetail(seg[1], decodeURIComponent(seg[2]), parseInt(seg[3], 10) || 0);
    else if (seg[0] === 'author' && seg[1]) job = renderAuthor(decodeURIComponent(seg[1]), page);
    else if (seg[0] === 'authors') job = renderAuthors();
    else if (seg[0] === 'search') job = doSearch(r.query.get('q') || '', r.query.get('c') || 'all', r.query.get('theme') || '', page);
    else if (seg[0] === 'favorites') { setHTML(renderSimpleList('我的收藏', store('outai-poetry-favs'), '还没有收藏。读到喜欢的诗，点详情页的「收藏」即可。')); job = Promise.resolve(); }
    else if (seg[0] === 'history') {
      setHTML(renderSimpleList('阅读历史', store('outai-poetry-history'), '还没有阅读记录。',
        '<button class="btn small" data-action="clear-history">清空历史</button>'));
      job = Promise.resolve();
    }
    else { setHTML(errorBox('找不到这个页面', '地址为 ' + r.path)); job = Promise.resolve(); }
    Promise.resolve(job).catch(function (e) {
      setHTML(errorBox('加载失败', (e && e.message) || '未知错误'));
    });
  }

  /* ---------- 全局事件 ---------- */
  document.getElementById('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('searchInput').value.trim();
    var c = document.getElementById('searchScope').value;
    if (!q) { toast('请先输入要搜索的内容'); return; }
    location.hash = '#/search?q=' + encodeURIComponent(q) + '&c=' + c;
  });
  document.getElementById('menuToggle').addEventListener('click', function () {
    document.getElementById('nav').classList.toggle('open');
  });
  document.getElementById('nav').addEventListener('click', function () {
    document.getElementById('nav').classList.remove('open');
  });
  var themeBtn = document.getElementById('themeToggle');
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    try { localStorage.setItem('outai-poetry-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('outai-poetry-theme'); } catch (e) {}
  applyTheme(savedTheme ? savedTheme === 'dark' : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
  themeBtn.addEventListener('click', function () {
    applyTheme(!document.body.classList.contains('dark'));
    toast(document.body.classList.contains('dark') ? '已切换到夜间模式' : '已切换到日间模式');
  });

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (action === 'retry') { route(); }
    else if (action === 'random') { randomPoem().catch(function (err) { setHTML(errorBox('随机取诗失败', err.message)); }); }
    else if (action === 'fav' && currentRoute.poem) {
      var nowFav = toggleFav(currentRoute.poem);
      el.textContent = nowFav ? '★ 已收藏' : '☆ 收藏';
      el.setAttribute('data-fav', nowFav ? '1' : '0');
    }
    else if (action === 'share' && currentRoute.poem) {
      var p = currentRoute.poem;
      var text = (p.title ? '《' + p.title + '》' : '') + (p.author ? ' · ' + p.author : '') + '\n' + p.lines.join('\n');
      var url = location.href;
      if (navigator.share) {
        navigator.share({ title: 'OUTAI 诗词', text: text, url: url }).catch(function () { /* 用户取消分享 */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text + '\n' + url).then(function () { toast('已复制诗词与链接'); }, function () { toast('复制失败，请手动复制'); });
      } else { toast('此浏览器不支持分享，请手动复制地址栏链接'); }
    }
    else if (action === 'copy-text' && currentRoute.poem) {
      var p2 = currentRoute.poem;
      var t2 = (p2.title ? '《' + p2.title + '》' : '') + (p2.author ? ' · ' + p2.author : '') + '\n' + p2.lines.join('\n');
      if (navigator.clipboard) navigator.clipboard.writeText(t2).then(function () { toast('全文已复制'); });
      else toast('此浏览器不支持复制');
    }
    else if (action === 'fullscreen') {
      document.body.classList.add('reading');
      var de = document.documentElement;
      if (de.requestFullscreen) de.requestFullscreen().catch(function () { toast('已进入沉浸阅读（浏览器未允许全屏）'); });
      else toast('已进入沉浸阅读');
    }
    else if (action === 'deep-search') {
      el.disabled = true;
      deepSearch(el.getAttribute('data-q'), el.getAttribute('data-scope')).catch(function (err) {
        toast('全文深搜失败：' + err.message);
      });
    }
    else if (action === 'clear-history') {
      saveStore('outai-poetry-history', []);
      toast('历史已清空');
      route();
    }
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) document.body.classList.remove('reading');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.body.classList.remove('reading');
  });

  window.addEventListener('hashchange', route);
  getCatalog().then(function () { route(); }).catch(function (e) {
    setHTML(errorBox('网站数据加载失败', (e && e.message) || '无法读取 data/catalog.json') +
      '<p class="note">本地预览请用 <code>python3 -m http.server</code> 在网站根目录启动，直接双击打开文件会因浏览器安全限制读不到数据文件。</p>');
  });
})();
