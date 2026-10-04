/* ============================================================
   home.js — 首页：筛选 / 搜索 / 天梯图 / 列表
   ============================================================ */

const State = {
  meta: null,
  rows: [],
  view: 'ladder',
  sort: 'rank',
  metric: 'overall',
  page: 1,
  perPage: 60,
  filters: {},      // { key: Set(values) }
  query: ''
};

const FILTER_DEFS = [
  { key: 'brand',           label: '品牌',       field: 'brand',           search: true },
  { key: 'tier',            label: '定位',       field: 'tier' },
  { key: 'bus',             label: '总线类型',   field: 'bus' },
  { key: 'pcieGen',         label: 'PCIe 代际',  field: 'pcieGen' },
  { key: 'form',            label: '接口形态',   field: 'form' },
  { key: 'capacity',        label: '容量',       field: 'capacity' },
  { key: 'nandType',        label: '颗粒类型',   field: 'nandType' },
  { key: 'controllerBrand', label: '主控品牌',   field: 'controllerBrand', search: true }
];

const METRIC_ACCESS = {
  overall:     r => r.scores.overall,
  bandwidth:   r => r.scores.bandwidth,
  latency:     r => r.scores.latency,
  theoretical: r => r.scores.theoretical,
  cdmSeqR:     r => r.key.cdmSeqR,
  cdmSeqW:     r => r.key.cdmSeqW,
  cdm4kR:      r => r.key.cdm4kR,
  asssdSeqR:   r => r.key.asssdSeqR,
  accR:        r => r.key.accR,
  seqRead:     r => r.spec.seqRead,
  capacityGB:  r => r.capacityGB
};

const METRIC_LOW_IS_BETTER = { accR: true };

/* 天梯图副标题用的指标名（不再从下拉框取，避免「排序/指标」合并后文案不准） */
const METRIC_LABEL = {
  overall:     '综合评分',
  bandwidth:   '读写速度比',
  latency:     '响应速度比',
  theoretical: '理论性能比',
  cdmSeqR:     'CDM 顺序读取 (MB/s)',
  cdmSeqW:     'CDM 顺序写入 (MB/s)',
  cdm4kR:      'CDM 4K 随机读 (MB/s)',
  asssdSeqR:   'AS SSD 顺序读取 (MB/s)',
  accR:        'AS SSD 访问延迟·读 (ms, 越低越好)',
  seqRead:     '标称顺序读取 (MB/s)',
  capacityGB:  '容量 (GB)'
};

const METRIC_FORMAT = {
  overall:     v => Fmt.score(v),
  bandwidth:   v => Fmt.score(v),
  latency:     v => Fmt.score(v),
  theoretical: v => Fmt.score(v),
  cdmSeqR:     v => Fmt.cdm(v),
  cdmSeqW:     v => Fmt.cdm(v),
  cdm4kR:      v => Fmt.cdm(v),
  asssdSeqR:   v => Fmt.asssdSpeed(v),
  accR:        v => Fmt.asssdMs(v),
  seqRead:     v => Fmt.n(v, 0),
  capacityGB:  v => Fmt.n(v, 0)
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  UI.renderHeader('home');

  const q = UI.qs('q');
  if (q) {
    State.query = q;
    const gs = document.getElementById('globalSearch');
    if (gs) gs.value = q;
  }

  // 默认视图恒为天梯榜：只有地址栏显式写 view=table 才切到列表，
  // 也不做任何本地记忆，保证每次打开/从详情页返回都是天梯。
  State.view = UI.qs('view') === 'table' ? 'table' : 'ladder';
  syncViewSeg();

  try {
    const [meta, rows] = await Promise.all([DB.meta(), DB.index()]);
    State.meta = meta;
    State.rows = rows;
    DB.cacheIndex = rows;
  } catch (e) {
    document.getElementById('results').innerHTML =
      '<div class="empty"><h3>数据加载失败</h3><p>' + UI.esc(e.message) +
      '</p><p>请确认 <code>data/</code> 目录与页面在同一路径下。</p></div>';
    return;
  }

  buildFilters();
  bindToolbar();
  bindDrawer();
  updateFilterBadge();
  render();
}

/* ---------------- 筛选抽屉（仅窄屏） ----------------
   宽屏空间够，筛选栏常驻左侧，不需要、也不允许收起；
   只有 ≤1000px 的空间不够时才切成抽屉，由工具栏「筛选」拉出。 */

const NARROW_MQ = '(max-width: 1000px)';
// matchMedia 在个别嵌入环境/老内核里可能不存在，缺它就按宽屏处理（筛选常驻）
const isNarrow = () =>
  typeof window.matchMedia === 'function' && !!window.matchMedia(NARROW_MQ).matches;

function bindDrawer() {
  const layout = document.querySelector('.layout');
  const btn = document.getElementById('filterToggle');
  const closeBtn = document.getElementById('filterClose');
  const backdrop = document.getElementById('drawerBackdrop');
  if (!layout || !btn) return;

  const set = open => {
    // 宽屏永远保持常驻状态，抽屉状态一律清零
    const on = open && isNarrow();
    layout.classList.toggle('filters-open', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  btn.addEventListener('click', () => set(!layout.classList.contains('filters-open')));
  if (closeBtn) closeBtn.addEventListener('click', () => set(false));
  if (backdrop) backdrop.addEventListener('click', () => set(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  // 从窄屏拉回宽屏时清掉残留的抽屉状态
  window.addEventListener('resize', () => {
    if (!isNarrow() && layout.classList.contains('filters-open')) set(false);
  });

  set(false);   // 默认收起（只对窄屏生效；宽屏恒为常驻）
}

function updateFilterBadge() {
  const el = document.getElementById('filterBadge');
  if (!el) return;
  let n = 0;
  Object.values(State.filters).forEach(s => { n += s ? s.size : 0; });
  if (State.query) n += 1;
  el.textContent = n;
  el.hidden = n === 0;
}

/* ---------------- 筛选面板 ---------------- */

function buildFilters() {
  const host = document.getElementById('filterGroups');
  const facets = State.meta.facets || {};
  host.innerHTML = '';

  FILTER_DEFS.forEach(def => {
    const list = facets[def.key] || [];
    if (!list.length) return;
    State.filters[def.key] = new Set();

    const g = UI.el(`<div class="fgroup" data-key="${def.key}">
      <h3>${def.label}<span class="caret">▼</span></h3>
      <div class="fgroup-body"></div>
    </div>`);
    const body = g.querySelector('.fgroup-body');

    if (def.search && list.length > 12) {
      const s = UI.el('<input class="brand-search" placeholder="搜索…">');
      s.addEventListener('input', () => {
        const q = s.value.trim().toLowerCase();
        body.querySelectorAll('.fopt').forEach(o => {
          o.style.display = (!q || o.dataset.v.toLowerCase().includes(q)) ? '' : 'none';
        });
      });
      body.appendChild(s);
      body.classList.add('scroll');
    } else if (list.length > 10) {
      body.classList.add('scroll');
    }

    list.forEach(f => {
      const o = UI.el(`<label class="fopt" data-v="${UI.esc(f.value)}">
        <input type="checkbox" value="${UI.esc(f.value)}">
        <span>${UI.esc(f.value)}</span><span class="n">${f.count}</span>
      </label>`);
      o.querySelector('input').addEventListener('change', () => {
        const set = State.filters[def.key];
        if (o.querySelector('input').checked) set.add(f.value); else set.delete(f.value);
        State.page = 1;
        render();
      });
      body.appendChild(o);
    });

    g.querySelector('h3').addEventListener('click', () => g.classList.toggle('collapsed'));
    host.appendChild(g);
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    Object.values(State.filters).forEach(s => s.clear());
    document.querySelectorAll('#filterGroups input[type=checkbox]').forEach(c => c.checked = false);
    State.query = '';
    const gs = document.getElementById('globalSearch');
    if (gs) gs.value = '';
    State.page = 1;
    render();
  });
}

function bindToolbar() {
  // 「排序/指标」已合并为一个下拉：选哪个指标，就按哪个指标排序，天梯条也按它绘制
  document.getElementById('sortBy').addEventListener('change', e => {
    State.sort = e.target.value;
    State.metric = SORT_TO_METRIC[e.target.value] || e.target.value;
    State.page = 1; render();
  });
  document.querySelectorAll('#viewSeg button').forEach(b => {
    b.addEventListener('click', () => {
      State.view = b.dataset.view;
      syncViewSeg();
      render();
    });
  });

  // 从详情页按浏览器「后退」回来时，浏览器会直接恢复旧 DOM（bfcache），
  // 此前点过的「列表」状态会残留。这里强制回到天梯榜。
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    State.view = UI.qs('view') === 'table' ? 'table' : 'ladder';
    syncViewSeg();
    render();
  });
}

/** 让分段控件的选中态始终与 State.view 一致 */
function syncViewSeg() {
  document.querySelectorAll('#viewSeg button').forEach(b => {
    const on = b.dataset.view === State.view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/* ---------------- 过滤与排序 ---------------- */

function filtered() {
  let rows = State.rows;

  for (const def of FILTER_DEFS) {
    const set = State.filters[def.key];
    if (set && set.size) rows = rows.filter(r => set.has(r[def.field]));
  }

  if (State.query) {
    const q = State.query.toLowerCase();
    const parts = q.split(/\s+/).filter(Boolean);
    const norm = s => String(s).toLowerCase().replace(/[\s\-_/·（）()]+/g, '');
    rows = rows.filter(r => {
      const raw = [
        r.brand, r.brandEn, r.model, r.pn, r.controller, r.nand, r.dram,
        r.interface, r.capacity, r.tier
      ].filter(Boolean).join(' ');
      const hay = raw.toLowerCase();
      const hayN = norm(raw);
      // 用户可能输入 "980pro" 而数据是 "980 PRO"，因此再比对一份去掉分隔符的字符串
      return parts.every(p => hay.includes(p) || hayN.includes(norm(p)));
    });
  }
  return rows;
}

const SORT_ACCESS = {
  rank: r => (r.rank == null ? 99999 : r.rank),
  overall: r => -(r.scores.overall ?? -1),
  bandwidth: r => -(r.scores.bandwidth ?? -1),
  latency: r => -(r.scores.latency ?? -1),
  theoretical: r => -(r.scores.theoretical ?? -1),
  seqRead: r => -(r.spec.seqRead ?? -1),
  cdmSeqR: r => -(r.key.cdmSeqR ?? -1),
  cdmSeqW: r => -(r.key.cdmSeqW ?? -1),
  cdm4kR: r => -(r.key.cdm4kR ?? -1),
  asssdSeqR: r => -(r.key.asssdSeqR ?? -1),
  accR: r => (r.key.accR ?? Infinity),          // 延迟越低越好 → 升序
  capacityGB: r => -(r.capacityGB ?? -1)
};

/* 「排序/指标」合并后的映射：其余选项的排序键与指标键同名，只有综合排名例外 */
const SORT_TO_METRIC = { rank: 'overall' };

function sorted(rows) {
  const fn = SORT_ACCESS[State.sort] || SORT_ACCESS.rank;
  return rows.slice().sort((a, b) => {
    const d = fn(a) - fn(b);
    if (d !== 0) return d;
    return (a.rank ?? 99999) - (b.rank ?? 99999);
  });
}

/* ---------------- 渲染 ---------------- */

function render() {
  const rows = sorted(filtered());
  document.getElementById('countNum').textContent = rows.length;
  renderChips();
  updateFilterBadge();

  const host = document.getElementById('results');
  if (!rows.length) {
    host.innerHTML = `<div class="empty"><h3>没有符合条件的硬盘</h3>
      <p>试试减少筛选条件，或换一个关键词。</p>
      <p><button class="btn" onclick="document.getElementById('resetFilters').click()">重置筛选</button></p></div>`;
    document.getElementById('pager').innerHTML = '';
    return;
  }

  const total = Math.ceil(rows.length / State.perPage);
  if (State.page > total) State.page = total;
  const start = (State.page - 1) * State.perPage;
  const page = rows.slice(start, start + State.perPage);

  if (State.view === 'ladder') renderLadder(host, page, rows);
  else renderTable(host, page);

  renderPager(total);
}

function renderChips() {
  const host = document.getElementById('chips');
  const items = [];
  if (State.query) items.push({ type: 'q', value: State.query, label: '关键词：' + State.query });
  for (const def of FILTER_DEFS) {
    const set = State.filters[def.key];
    if (!set) continue;
    set.forEach(v => items.push({ type: def.key, value: v, label: v }));
  }
  if (!items.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
  host.style.display = 'flex';
  host.innerHTML = items.map((it, i) =>
    `<span class="chip">${UI.esc(it.label)}<button data-i="${i}" title="移除">×</button></span>`).join('');
  host.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const it = items[Number(b.dataset.i)];
      if (it.type === 'q') {
        State.query = '';
        const gs = document.getElementById('globalSearch');
        if (gs) gs.value = '';
      } else {
        State.filters[it.type].delete(it.value);
        const cb = document.querySelector(`#filterGroups .fgroup[data-key="${it.type}"] input[value="${cssEscape(it.value)}"]`);
        if (cb) cb.checked = false;
      }
      State.page = 1;
      render();
    };
  });
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function metricValue(r) {
  const fn = METRIC_ACCESS[State.metric];
  return fn ? fn(r) : null;
}

/** 当前指标下每款硬盘的全局名次（同值同名次；综合排名用源表的名次） */
function metricRankMap() {
  if (State.metric === 'overall') {
    const map = new Map();
    State.rows.forEach(r => map.set(r.id, r.rank ?? null));
    return map;
  }
  return computeRanks(State.rows, METRIC_ACCESS[State.metric], !!METRIC_LOW_IS_BETTER[State.metric]);
}

function renderLadder(host, page, allRows) {
  const lowBetter = METRIC_LOW_IS_BETTER[State.metric];
  const values = allRows.map(metricValue).filter(v => v != null && !isNaN(v));
  const max = Math.max(...values, 0) || 1;
  const picked = Basket.get();
  const metricLabel = METRIC_LABEL[State.metric] || State.metric;
  const ranks = metricRankMap();

  const html = `
    <div class="panel-head">
      <h2>性能天梯榜</h2>
      <span class="sub">按 ${UI.esc(metricLabel)} 绘制 · 当前显示 ${page.length} / ${allRows.length} 款</span>
      <span class="spacer"></span>
      <span class="sub">${lowBetter ? '数值越低越好' : '数值越高越好'}</span>
    </div>
    <div class="panel-body">
      <div class="ladder">
        ${page.map((r, i) => {
          const v = metricValue(r);
          const pct = (v == null || isNaN(v)) ? 0 : Math.min(100, (v / max) * 100);
          const globalIdx = (State.page - 1) * State.perPage + i;
          const rk = ranks.get(r.id);
          const rankCls = rk === 1 ? 'top1' : rk === 2 ? 'top2' : rk === 3 ? 'top3' : '';
          return `<div class="lrow ${rankCls}" data-id="${r.id}">
            <label class="pick" title="加入对比"><input type="checkbox" data-pick="${r.id}" ${picked.includes(r.id) ? 'checked' : ''}></label>
            <span class="rk">${rk ? '#' + rk : '—'}</span>
            <span class="mid">
              <span class="name" title="${UI.esc(r.brand + ' ' + r.model + (r.capacity ? ' ' + r.capacity : ''))}"><a href="detail.html?id=${r.id}">${UI.esc(r.brand)} ${UI.esc(r.model)}</a><span class="cap">${UI.esc(r.capacity || '')}</span></span>
              <span class="meta" title="${UI.esc([r.interface, r.controller || '未知主控', r.nandType].filter(Boolean).join(' · '))}">${UI.esc(r.interface || '')} · ${UI.esc(r.controller || '未知主控')} · ${UI.esc(r.nandType || '')}</span>
            </span>
            <span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>
            <span class="val">${v == null || isNaN(v) ? '—' : METRIC_FORMAT[State.metric](v)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  host.innerHTML = html;

  host.querySelectorAll('[data-pick]').forEach(cb => {
    cb.addEventListener('change', () => Basket.toggle(Number(cb.dataset.pick)));
  });
  host.querySelectorAll('.lrow').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('a') || e.target.closest('input')) return;
      location.href = 'detail.html?id=' + row.dataset.id;
    });
  });
}

function renderTable(host, page) {
  const picked = Basket.get();
  const ranks = metricRankMap();
  const html = `
    <div class="panel-head"><h2>硬盘列表</h2><span class="sub">点击表头可排序</span></div>
    <div class="tablewrap">
    <table class="grid">
      <thead><tr>
        <th></th>
        <th class="num">#</th>
        <th>型号</th>
        <th>容量</th>
        <th>接口</th>
        <th>主控</th>
        <th>颗粒</th>
        <th>定位</th>
        <th class="num">综合</th>
        <th class="num">速度比</th>
        <th class="num">响应比</th>
        <th class="num">CDM 读</th>
        <th class="num">CDM 写</th>
      </tr></thead>
      <tbody>
        ${page.map(r => `<tr class="${picked.includes(r.id) ? 'picked' : ''}">
          <td><input type="checkbox" data-pick="${r.id}" ${picked.includes(r.id) ? 'checked' : ''}></td>
          <td class="num">${ranks.get(r.id) ?? '—'}</td>
          <td>
            <a class="cell-name" href="detail.html?id=${r.id}">${UI.esc(r.brand)} ${UI.esc(r.model)}</a>
            <div class="cell-sub">${UI.esc(r.pn || '')}</div>
          </td>
          <td>${UI.esc(r.capacity || '—')}</td>
          <td><span class="tag ${busTag(r.bus)}">${UI.esc(r.interface || '—')}</span></td>
          <td>${UI.esc(r.controller || '—')}</td>
          <td>${UI.esc(r.nandType || '—')}</td>
          <td><span class="tag ${r.tier === '企业' ? 'tag-ent' : 'tag-home'}">${UI.esc(r.tier || '—')}</span></td>
          <td class="num"><b>${Fmt.score(r.scores.overall)}</b></td>
          <td class="num">${Fmt.score(r.scores.bandwidth)}</td>
          <td class="num">${Fmt.score(r.scores.latency)}</td>
          <td class="num">${Fmt.cdm(r.key.cdmSeqR)}</td>
          <td class="num">${Fmt.cdm(r.key.cdmSeqW)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  host.innerHTML = html;
  host.querySelectorAll('[data-pick]').forEach(cb => {
    cb.addEventListener('change', () => {
      Basket.toggle(Number(cb.dataset.pick));
      cb.closest('tr').classList.toggle('picked', cb.checked);
    });
  });
}

function busTag(bus) {
  if (bus === 'NVMe') return 'tag-nvme';
  if (bus === 'SATA') return 'tag-sata';
  return 'tag-other';
}

function renderPager(total) {
  const host = document.getElementById('pager');
  if (total <= 1) { host.innerHTML = ''; return; }
  const p = State.page;
  let html = `<button class="btn btn-sm" ${p === 1 ? 'disabled' : ''} data-p="${p - 1}">上一页</button>`;
  html += `<span class="count">第 <b>${p}</b> / ${total} 页</span>`;
  html += `<button class="btn btn-sm" ${p === total ? 'disabled' : ''} data-p="${p + 1}">下一页</button>`;
  html += `<select class="control" id="perPage">
    ${[30, 60, 120, 0].map(n => `<option value="${n}" ${State.perPage === n ? 'selected' : ''}>${n ? n + ' 条/页' : '全部'}</option>`).join('')}
  </select>`;
  host.innerHTML = html;
  host.querySelectorAll('[data-p]').forEach(b => {
    b.onclick = () => { State.page = Number(b.dataset.p); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  });
  host.querySelector('#perPage').onchange = e => {
    State.perPage = Number(e.target.value) || 100000;
    State.page = 1; render();
  };
}

/* 篮子变化（托盘「清空」、托盘条目「×」移除等）时，同步本页所有勾选框，
   避免「清空选择后勾选仍在、要刷新才消失」的不同步 */
document.addEventListener('basketchange', e => {
  const ids = (e.detail && e.detail.ids) || [];
  document.querySelectorAll('[data-pick]').forEach(cb => {
    const on = ids.includes(Number(cb.dataset.pick));
    if (cb.checked !== on) cb.checked = on;
    const row = cb.closest('tr');
    if (row) row.classList.toggle('picked', on);
  });
});
