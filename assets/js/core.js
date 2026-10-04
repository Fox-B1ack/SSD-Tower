/* ============================================================
   core.js — 数据加载 / 格式化 / 对比篮 / 公共组件
   ============================================================ */

const DB = (() => {
  const cache = { meta: null, index: null, shards: new Map() };

  async function getJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('加载失败 ' + path + ' (' + res.status + ')');
    return res.json();
  }

  return {
    meta() {
      if (!cache.meta) cache.meta = getJSON('data/meta.json');
      return cache.meta;
    },
    index() {
      if (!cache.index) cache.index = getJSON('data/index.json');
      return cache.index;
    },
    ssd(id) {
      if (!cache.shards.has(id)) {
        cache.shards.set(id, getJSON('data/ssd/' + encodeURIComponent(id) + '.json'));
      }
      return cache.shards.get(id);
    },
    async many(ids) {
      return Promise.all(ids.map(id => DB.ssd(id)));
    },
    // 相对站点根目录解析数据路径（支持部署在子目录）
    base() {
      return document.body.dataset.base || '';
    }
  };
})();

/* ---------------- 格式化 ---------------- */

const Fmt = {
  n(v, d = 0) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  // 智能数值：MB/s 用整数，小数值保留更多小数
  auto(v) {
    if (v === null || v === undefined) return '—';
    const a = Math.abs(v);
    if (a >= 1000) return Fmt.n(v, 0);
    if (a >= 100) return Fmt.n(v, 1);
    if (a >= 1) return Fmt.n(v, 2);
    if (a === 0) return '0';
    return Fmt.n(v, 4);
  },
  score(v) {
    if (v === null || v === undefined) return '—';
    return Number(v).toFixed(3);
  },
  ms(v) {
    if (v === null || v === undefined) return '—';
    const a = Math.abs(v);
    if (a >= 10) return Fmt.n(v, 1);
    if (a >= 1) return Fmt.n(v, 2);
    return Fmt.n(v, 4);
  },
  iops(v) {
    if (v === null || v === undefined) return '—';
    return Fmt.n(v, 0);
  },
  // ---- 各跑分软件的小数位口径（与 tools/build_data.py 取整一致）----
  //  CDM      ：全部 1 位小数
  //  AS SSD   ：吞吐 2 位、延迟 3 位
  //  TX-Bench ：速度 / 延迟均 2 位小数
  cdm(v) { return Fmt.n(v, 1); },
  asssdSpeed(v) { return Fmt.n(v, 2); },
  asssdMs(v) { return Fmt.n(v, 3); },
  tx(v) { return Fmt.n(v, 2); },
  dash(v) { return (v === null || v === undefined || v === '') ? '—' : v; }
};

/* ---------------- 对比篮（localStorage） ---------------- */

const Basket = {
  KEY: 'ssddb:compare',
  MAX: 6,
  get() {
    try {
      const raw = localStorage.getItem(this.KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'number') : [];
    } catch (e) { return []; }
  },
  set(ids) {
    const kept = ids.slice(0, this.MAX);
    try { localStorage.setItem(this.KEY, JSON.stringify(kept)); } catch (e) {}
    UI.renderTray();
    // 广播篮子变化，让页面上的勾选框（data-pick）能同步状态（如托盘「清空」后取消勾选）
    document.dispatchEvent(new CustomEvent('basketchange', { detail: { ids: kept } }));
  },
  has(id) { return this.get().includes(id); },
  toggle(id) {
    const ids = this.get();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else {
      if (ids.length >= this.MAX) { UI.toast('最多同时对比 ' + this.MAX + ' 款硬盘'); return false; }
      ids.push(id);
    }
    this.set(ids);
    return i < 0;
  },
  add(id) {
    const ids = this.get();
    if (!ids.includes(id)) {
      if (ids.length >= this.MAX) { UI.toast('最多同时对比 ' + this.MAX + ' 款硬盘'); return false; }
      ids.push(id);
    }
    this.set(ids);
    return true;
  },
  remove(id) { this.set(this.get().filter(x => x !== id)); },
  clear() { this.set([]); },
  count() { return this.get().length; }
};

/* ---------------- 指标排名（天梯榜 / 详情页共用） ---------------- */

/**
 * 竞赛排名：同值同名次（1,2,2,4…），取不到数值的不参与排名。
 * 返回 Map(id -> 名次|null)，rows 为全量数据以保证名次是全局的。
 */
function computeRanks(rows, get, lowBetter) {
  const map = new Map();
  const items = rows
    .map(r => ({ id: r.id, v: get(r) }))
    .filter(x => x.v != null && !isNaN(x.v));
  items.sort((a, b) => (lowBetter ? a.v - b.v : b.v - a.v));
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && items[i].v === items[i - 1].v) map.set(items[i].id, map.get(items[i - 1].id));
    else map.set(items[i].id, i + 1);
  }
  return map;
}

/* ---------------- 指标定义（详情页 / 对比页共用） ---------------- */

const METRICS = {
  asssd: [
    { k: 'seqR',  label: '顺序读取',      unit: 'MB/s', better: 'high' },
    { k: 'seqW',  label: '顺序写入',      unit: 'MB/s', better: 'high' },
    { k: 'r4k',   label: '4K 随机读取',   unit: 'MB/s', better: 'high' },
    { k: 'w4k',   label: '4K 随机写入',   unit: 'MB/s', better: 'high' },
    { k: 'r4k64', label: '4K-64Thrd 读取', unit: 'MB/s', better: 'high' },
    { k: 'w4k64', label: '4K-64Thrd 写入', unit: 'MB/s', better: 'high' },
    { k: 'accR',  label: '访问延迟 读',   unit: 'ms',   better: 'low' },
    { k: 'accW',  label: '访问延迟 写',   unit: 'ms',   better: 'low' }
  ],
  cdm: [
    { k: 'seqR',    label: '顺序读取 Q8T1',  unit: 'MB/s', better: 'high' },
    { k: 'seqW',    label: '顺序写入 Q8T1',  unit: 'MB/s', better: 'high' },
    { k: 'r4kq8t1', label: '随机读取 Q8T1',  unit: 'MB/s', better: 'high' },
    { k: 'w4kq8t1', label: '随机写入 Q8T1',  unit: 'MB/s', better: 'high' },
    { k: 'r4kq64t1',label: '随机读取 Q64T1', unit: 'MB/s', better: 'high' },
    { k: 'w4kq64t1',label: '随机写入 Q64T1', unit: 'MB/s', better: 'high' },
    { k: 'r4kq8t8', label: '随机读取 Q8T8',  unit: 'MB/s', better: 'high' },
    { k: 'w4kq8t8', label: '随机写入 Q8T8',  unit: 'MB/s', better: 'high' }
  ]
};

const TX_GROUPS = [
  { k: 'speedEmpty',   title: '空盘 · 传输速度', unit: 'MB/s', better: 'high' },
  { k: 'speedFull',    title: '85% 满盘 · 传输速度', unit: 'MB/s', better: 'high' },
  { k: 'latencyEmpty', title: '空盘 · 响应延迟', unit: 'ms', better: 'low' },
  { k: 'latencyFull',  title: '85% 满盘 · 响应延迟', unit: 'ms', better: 'low' }
];

const SCORE_DEFS = [
  { k: 'overall',     label: '综合评分',     desc: '读写速度比与响应速度比的加权综合，天梯排序依据' },
  { k: 'bandwidth',   label: '读写速度比',   desc: '相对基准盘的连续/随机吞吐表现，越高越好' },
  { k: 'latency',     label: '响应速度比',   desc: '相对基准盘的延迟表现，越高代表延迟越低' },
  { k: 'theoretical', label: '理论性能比',   desc: '厂商标称参数换算出的理论性能，仅供参考' }
];

/* ---------------- TX-Bench 取值 ---------------- */

/**
 * TX-Bench 每个混合负载场景同时给出读、写两个值，其中"主导方向"的才是该场景的
 * 代表性吞吐（例如 95% 顺序读 + 5% 随机写，读才是主体）。这里取两者较大值：
 *  - 速度图 → 主导方向的吞吐
 *  - 延迟图 → 读/写中的最差值（保守口径）
 */
function txPrimary(x) {
  if (!x) return null;
  const vals = [x.read, x.write].filter(v => v != null && !isNaN(v));
  return vals.length ? Math.max(...vals) : null;
}

/* ---------------- 图表方式（详情页 / 对比页共用） ---------------- */

/**
 * 实测图表有三种画法，由用户自己选。
 *  - rows   分项对比：把量级差异大的项目拆开、各自缩放，小值不会被压平
 *  - linear 合并坐标 · 线性：能看出真实倍数差距，小值会挤在底部
 *  - log    合并坐标 · 对数：60 与 7000 可同屏可读，但刻度非线性
 * 选择存在 localStorage 并写进 URL，两个页面共用同一份偏好。
 */
const BENCH_MODES = {
  rows: { label: '分项对比', hint: '把量级差异大的项目拆开、各自缩放，小值不会被压平。' },
  linear: { label: '合并坐标 · 线性', hint: '所有项目共用一条线性纵轴，看真实差距；小值会挤在底部。' },
  log: { label: '合并坐标 · 对数', hint: '量级悬殊时同屏可读（60 与 7000 都能看清），刻度非线性。' }
};
const MODE_KEY = 'ssddb.benchMode';
let benchMode = 'rows';

function initBenchMode() {
  const want = UI.qs('mode') || (() => {
    try { return localStorage.getItem(MODE_KEY); } catch (e) { return null; }
  })() || 'rows';
  benchMode = BENCH_MODES[want] ? want : 'rows';
}
function saveBenchMode(mode) {
  if (mode && BENCH_MODES[mode]) benchMode = mode;
  try { localStorage.setItem(MODE_KEY, benchMode); } catch (e) { /* 隐私模式忽略 */ }
  const u = new URL(location.href);
  u.searchParams.set('mode', benchMode);
  history.replaceState(null, '', u.toString());
}
/** 渲染「图表方式」切换条；onChange 由各页面传入（重绘图表用） */
function renderModeBar(host, onChange) {
  if (!host) return;
  host.innerHTML = `
    <span class="viewbar-label">图表方式</span>
    <div class="seg" id="benchMode">
      ${Object.keys(BENCH_MODES).map(k =>
        `<button type="button" data-mode="${k}">${BENCH_MODES[k].label}</button>`).join('')}
    </div>
    <span class="viewbar-hint" id="modeHint"></span>`;
  host.querySelectorAll('#benchMode button').forEach(b => {
    b.onclick = () => {
      saveBenchMode(b.dataset.mode);
      syncModeBar(host);
      if (onChange) onChange();
    };
  });
  syncModeBar(host);
}
function syncModeBar(host) {
  host.querySelectorAll('#benchMode button').forEach(b => {
    const on = b.dataset.mode === benchMode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const h = host.querySelector('#modeHint');
  if (h) h.textContent = (BENCH_MODES[benchMode] || {}).hint || '';
}
const dirTag = better => `<span style="font-size:11px;font-weight:600;color:${
  better === 'low' ? '#0369a1' : '#15803d'}">${better === 'low' ? '↓ 越低越好' : '↑ 越高越好'}</span>`;

/* ---------------- 图表卡片布局 ---------------- */

/**
 * 把若干「图表卡片」排进网格，并根据**图形类型**决定占几列：
 *
 *   shape:'bar'    横向条形 —— 高度 = 行数 × 行高，本来就该按内容排。
 *                  若强行拉高，图的上下会各留一大块空白；把它和柱状图并排时，
 *                  那份空白正好砸在同一行里（看起来就是条形图下面空了一截）。
 *                  所以条形图**必定独占一行**。
 *   shape:'column' 柱状图   —— 画布高度由 chart.js 按宽度算（约 0.46×W），
 *                  同一行的两张卡片等宽 → 画布等宽 → 等高 → 天然对齐。
 *                  因此允许两两并列；落单的那张自动占满整行，不会留出半边空。
 *
 * 窄屏（≤900px）由 CSS 统一降为单列，两种图都不再并列。
 *
 * cards: [{title, sub, dir:'high'|'low'|null, shape, key?, draw(hostEl)}]
 *        key 会写成 data-chart 属性，便于样式与测试稳定定位某张图。
 */
let _gridUid = 0;
function renderChartGrid(host, cards) {
  if (!host) return;
  const uid = 'cg' + (++_gridUid) + '_';

  // 相邻两张柱状图凑一对并排，其余（含落单的柱状图）一律独占一行
  const slots = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], nx = cards[i + 1];
    if (c.shape === 'column' && nx && nx.shape === 'column') {
      slots.push({ c, cls: '' }, { c: nx, cls: '' });
      i++;
    } else {
      slots.push({ c, cls: 'span-all' });
    }
  }

  host.innerHTML = '<div class="bench-grid">' + slots.map((x, k) => `
    <div class="${x.cls}" data-card="${uid}${k}">
      <p class="chart-title">${UI.esc(x.c.title)}${x.c.dir ? dirTag(x.c.dir) : ''}</p>
      ${x.c.sub ? `<p class="chart-sub">${x.c.sub}</p>` : ''}
      <div class="chart ${x.c.shape === 'column' ? 'is-column' : 'is-bar'}"
        ${x.c.key ? `data-chart="${x.c.key}"` : ''}></div>
    </div>`).join('') + '</div>';

  // 用 :scope 式的后代选择器按卡片定位，嵌套网格也不会串位
  slots.forEach((x, k) => {
    const el = host.querySelector(`[data-card="${uid}${k}"] > .chart`);
    if (el && x.c.draw) x.c.draw(el);
  });
}

/** 把一个「分组定义」转成柱状图卡片（合并坐标模式用；log 模式共用一条对数纵轴） */
function benchGroupCard(g) {
  return {
    title: `${g.title}（${g.unit}）`, sub: g.note, dir: g.better, shape: 'column',
    draw: el => {
      const m = g.merged || {
        cats: g.subs.flatMap(s => s.items.map(i => i.label)),
        series: [{ name: '本盘', values: g.subs.flatMap(s => s.items.map(i => i.value)), color: '#2563eb' }]
      };
      Chart.groupBar(el, {
        categories: m.cats, series: m.series, logScale: benchMode === 'log',
        showValues: m.series.length <= 2,
        valueFormat: g.fmt || (v => (g.unit === 'ms' ? Fmt.ms(v) : Fmt.auto(v)))
      });
    }
  };
}

/**
 * 把「一组指标」按当前图表方式画出来。卡片排布交给 renderChartGrid：
 * 分项模式产出若干条形图（各占整行），合并模式产出柱状图（两两并列）。
 *
 * groups: [{
 *   title, unit, better: 'high'|'low', note,
 *   subs:   [{title, note, items:[{label, value, display, sub}], barColor, rowH, max}],  // 分项模式用
 *   merged: {cats:[...], series:[{name, values, color}]}                                 // 合并模式用（可选，默认由 subs 拼出）
 * }]
 */
function renderBenchGroups(host, groups) {
  if (!host) return;

  if (benchMode === 'rows') {
    const cards = [];
    groups.forEach(g => {
      g.subs.forEach(s => {
        cards.push({
          title: s.title, sub: s.note, dir: g.better, shape: 'bar',
          draw: el => Chart.hbar(el, {
            items: s.items, rowH: s.rowH || 26, barColor: s.barColor,
            max: s.max, format: g.fmt || (g.unit === 'ms' ? Fmt.ms : Fmt.auto)
          })
        });
      });
    });
    renderChartGrid(host, cards);
    return;
  }

  // 合并模式：每组一张分组柱状图，速度/延迟依旧分开
  renderChartGrid(host, groups.map(benchGroupCard));
}

/**
 * 把「分组定义」转成 multiHBar 的行式结构：每行独立缩放，
 * 顺序读写几千 MB/s 与 4K 随机几十 MB/s 不会被压平。
 * 分项模式下用它替代多张零散的条形图，一个跑分项只占一张卡。
 */
function toMultiGroups(groups) {
  return groups.map(g => ({
    title: g.title, unit: g.unit, better: g.better, note: g.note,
    rows: g.subs.map(s => ({
      label: s.title,
      tip: s.note || s.title,
      items: s.items.map(i => ({
        name: i.label, value: i.value, display: i.display,
        color: s.barColor || '#2563eb'
      }))
    }))
  }));
}

/* ---------------- 通用 UI ---------------- */

const UI = {
  el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  },
  esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  qs(name) {
    return new URLSearchParams(location.search).get(name);
  },
  toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);' +
        'background:#1b2027;color:#fff;padding:8px 16px;border-radius:999px;' +
        'font-size:13px;z-index:200;opacity:0;transition:opacity .2s;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; }, 2000);
  },

  /* 顶部导航 */
  renderHeader(active) {
    const navs = [
      ['index.html', '天梯榜', 'home'],
      ['compare.html', '硬盘对比', 'compare'],
      ['about.html', '测试方法', 'about']
    ];
    document.querySelectorAll('[data-header]').forEach(host => {
      host.innerHTML = `
        <div class="container">
          <a class="logo" href="index.html">
            <span class="logo-mark">SSD</span>
            <span>SSD 规格数据库</span>
          </a>
          <nav class="nav">
            ${navs.map(([href, label, key]) =>
              `<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`).join('')}
          </nav>
          <div class="header-search">
            <span class="icon">⌕</span>
            <input id="globalSearch" type="search" placeholder="搜索型号 / 代号 / 控制器 / 颗粒…" autocomplete="off">
          </div>
          <div class="header-actions">
            <a class="btn btn-sm" href="compare.html">对比
              <span class="badge-count" id="navCount">0</span></a>
          </div>
        </div>`;
      const input = host.querySelector('#globalSearch');
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const q = input.value.trim();
          location.href = 'index.html' + (q ? '?q=' + encodeURIComponent(q) : '');
        }
      });
    });
  },

  /* 对比托盘 */
  renderTray() {
    const ids = Basket.get();
    document.querySelectorAll('#navCount').forEach(e => e.textContent = ids.length);
    let tray = document.getElementById('tray');
    if (!tray) {
      tray = document.createElement('div');
      tray.id = 'tray';
      tray.className = 'tray';
      tray.innerHTML = `<div class="container">
        <div class="tray-items" id="trayItems"></div>
        <button class="btn btn-sm" id="trayClear">清空</button>
        <a class="btn btn-sm btn-primary" id="trayGo">开始对比</a>
      </div>`;
      document.body.appendChild(tray);
      tray.querySelector('#trayClear').onclick = () => { Basket.clear(); };
    }
    const items = tray.querySelector('#trayItems');
    if (!ids.length) {
      items.innerHTML = '<span class="tray-empty">勾选硬盘后可进行多盘对比（最多 6 款）</span>';
    } else {
      items.innerHTML = ids.map(id => {
        const rec = DB.cacheIndex ? DB.cacheIndex.find(x => x.id === id) : null;
        const name = rec ? (rec.brand + ' ' + rec.model + (rec.capacity ? ' ' + rec.capacity : '')) : ('#' + id);
        return `<span class="tray-item">${UI.esc(name)}
          <button data-rm="${id}" title="移除">×</button></span>`;
      }).join('');
      items.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = () => Basket.remove(Number(b.dataset.rm));
      });
      if (!DB.cacheIndex) {
        DB.index().then(idx => { DB.cacheIndex = idx; UI.renderTray(); }).catch(() => {});
      }
    }
    tray.querySelector('#trayGo').href = 'compare.html?ids=' + ids.join(',');
    tray.classList.toggle('show', ids.length > 0);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  UI.renderTray();
  document.addEventListener('click', e => {
    if (e.target.closest('[data-rm]')) { /* handled inline */ }
  });
});
