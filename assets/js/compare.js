/* ============================================================
   compare.js — 多盘对比：规格表 + 评分雷达 + 分组柱状 + 明细表
   ============================================================ */

let LIST = [];      // 完整记录
let IDX = [];
let META = null;
let onlyDiff = false;

/* 图表方式（分项 / 线性 / 对数）与详情页共用 core.js 里的 BENCH_MODES */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  UI.renderHeader('compare');
  initBenchMode();

  let ids = [];
  const q = UI.qs('ids');
  if (q) ids = q.split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n));
  if (!ids.length) ids = Basket.get();
  ids = [...new Set(ids)].slice(0, 6);

  if (!ids.length) {
    document.getElementById('content').innerHTML = `
      <div class="panel"><div class="empty">
        <h3>还没有选择要对比的硬盘</h3>
        <p>回到<a href="index.html">天梯榜</a>，勾选感兴趣的硬盘后再回到本页。</p>
        <p style="margin-top:14px"><a class="btn btn-primary" href="index.html">去挑选硬盘</a></p>
      </div></div>`;
    return;
  }

  try {
    const [list, idx, meta] = await Promise.all([DB.many(ids), DB.index(), DB.meta()]);
    LIST = list; IDX = idx; META = meta; DB.cacheIndex = idx;
    Basket.set(ids);
  } catch (e) {
    document.getElementById('content').innerHTML =
      '<div class="empty"><h3>加载失败</h3><p>' + UI.esc(e.message) + '</p></div>';
    return;
  }
  render();
}

const nameOf = r => `${r.brand} ${r.model}${r.capacity ? ' ' + r.capacity : ''}`;
const shortOf = r => `${r.brand} ${r.model}`;

function render() {
  const host = document.getElementById('content');

  host.innerHTML = `
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head">
        <h2>对比中的硬盘</h2>
        <span class="sub">最多 6 款</span>
        <span class="spacer"></span>
        <label class="field" style="font-size:12px">
          <input type="checkbox" id="onlyDiff" ${onlyDiff ? 'checked' : ''}> 仅显示有差异的规格项
        </label>
        <button class="btn btn-sm" id="clearAll">清空</button>
      </div>
      <div class="panel-body">
        <div class="cmp-columns">
          ${LIST.map((r, i) => `
            <div class="cmp-col" style="border-top:3px solid ${Chart.color(i)}">
              <div class="cname">${UI.esc(r.brand)} ${UI.esc(r.model)}</div>
              <div class="cmeta">${UI.esc(r.capacity || '')} · ${UI.esc(r.interface || '')}</div>
              <div class="cmeta">天梯 #${r.rank ?? '—'} · 综合 ${Fmt.score(r.scores.overall)}</div>
              <div class="actions">
                <a class="btn btn-sm" href="detail.html?id=${r.id}">详情</a>
                <button class="btn btn-sm" data-rm="${r.id}">移除</button>
              </div>
            </div>`).join('')}
          ${LIST.length < 6 ? `<div class="cmp-col" style="display:grid;place-items:center;background:var(--surface);border-style:dashed">
              <a class="btn btn-sm" href="index.html">+ 添加硬盘</a></div>` : ''}
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h2>性能总览对比</h2><span class="sub">评分越靠外越好，雷达图按组内最大值归一化</span></div>
      <div class="panel-body">
        <div class="cols2">
          <div>
            <p class="chart-title">四项评分雷达</p>
            <p class="chart-sub">综合 / 读写速度比 / 响应速度比 / 理论性能比</p>
            <div class="chart" id="cRadar"></div>
          </div>
          <div>
            <p class="chart-title">综合评分排序</p>
            <p class="chart-sub">天梯排序依据</p>
            <div class="chart" id="cOverall"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head">
        <h2>实测性能对比</h2>
        <span class="sub">速度与延迟永远分开成图</span>
        <span class="spacer"></span>
        <select class="control" id="benchSel">
          <option value="cdm">CrystalDiskMark</option>
          <option value="asssd">AS SSD</option>
          <option value="txSpeed">TX-Bench · 传输速度</option>
          <option value="txLat">TX-Bench · 响应延迟</option>
        </select>
      </div>
      <div class="panel-body">
        <div class="viewbar" id="modeBar"></div>
        <div class="chart" id="cBench"></div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h2>规格对比</h2></div>
      <div class="tablewrap"><table class="cmp" id="specTable"></table></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>跑分明细对比</h2><span class="sub">蓝色底纹为该行最优（延迟类取最小、吞吐类取最大）</span></div>
      <div class="panel-body">
        <div class="tablewrap"><table class="cmp" id="benchTable"></table></div>
        <p class="note" id="benchNote"></p>
      </div>
    </div>`;

  host.querySelector('#clearAll').onclick = () => { Basket.clear(); location.href = 'compare.html'; };
  host.querySelector('#onlyDiff').onchange = e => { onlyDiff = e.target.checked; renderSpecTable(); };
  host.querySelectorAll('[data-rm]').forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.rm);
      const rest = LIST.map(r => r.id).filter(x => x !== id);
      Basket.set(rest);
      location.href = 'compare.html?ids=' + rest.join(',');
    };
  });
  host.querySelector('#benchSel').onchange = renderBenchChart;
  renderModeBar(host.querySelector('#modeBar'), renderBenchChart);

  renderRadar();
  renderOverall();
  renderBenchChart();
  renderSpecTable();
  renderBenchTable();
}

/* ---------------- 图表 ---------------- */

function renderRadar() {
  const axes = SCORE_DEFS.map(s => s.label);
  const maxAll = Math.max(...LIST.flatMap(r => SCORE_DEFS.map(s => r.scores[s.k] ?? 0)));
  Chart.radar(document.getElementById('cRadar'), {
    axes,
    max: niceCeil(maxAll * 1.05),
    series: LIST.map((r, i) => ({
      name: shortOf(r), color: Chart.color(i),
      values: SCORE_DEFS.map(s => r.scores[s.k] ?? 0)
    }))
  });
}

function renderOverall() {
  const items = LIST.map((r, i) => ({
    label: shortOf(r) + (r.capacity ? ' ' + r.capacity : ''),
    sub: r.interface || '',
    value: r.scores.overall ?? 0,
    display: Fmt.score(r.scores.overall),
    color: Chart.color(i)
  }));
  Chart.hbar(document.getElementById('cOverall'), {
    items, rowH: 30, max: Math.max(...items.map(i => i.value)) * 1.15
  });
}

/* TX-Bench 六个混合负载场景。
   短标签必须写成人话：95R/5W 这种缩写只有看过测试软件的人才能懂。
   与 tools/build_data.py 里的 TX_SCENARIOS 保持一致（那份是权威来源）。 */
const TX_SCEN_FALLBACK = [
  { short: '95顺序读/5随机写', label: '95% 顺序读取 + 5% 随机写入' },
  { short: '95顺序写/5随机读', label: '95% 顺序写入 + 5% 随机读取' },
  { short: '50顺序读/50顺序写', label: '50% 顺序读取 + 50% 顺序写入' },
  { short: '50随机读/50随机写', label: '50% 随机读取 + 50% 随机写入' },
  { short: '80顺序写/20顺序读', label: '80% 顺序写入 + 20% 顺序读取' },
  { short: '60顺序写/40随机写', label: '60% 顺序写入 + 40% 随机写入' }
];
const TX_SCEN_NOTE =
  '顺序 = 连续大块数据；随机 = 4K 小块离散地址。百分比为该场景的读写占比';

function scenList() {
  return (META && META.txScenarios) || TX_SCEN_FALLBACK;
}
function scenNote() {
  return (META && META.txScenarioNote) || TX_SCEN_NOTE;
}

/**
 * 把某个测试软件的数据切成若干个「同量纲、同好坏方向」的分组。
 * 关键约束：
 *   1. 速度（MB/s，越高越好）与延迟（ms，越低越好）绝不放在同一组
 *   2. 量级差距大的项目各自成组（顺序吞吐 vs 4K 随机吞吐）
 * 每个分组内部再用「每行独立缩放」彻底消除量级差异带来的压平问题。
 */
function buildBenchGroups(sel) {
  const scen = scenList();
  const mk = (label, get, fmt) => ({
    label,
    items: LIST.map((r, i) => ({ name: shortOf(r), color: Chart.color(i), value: get(r), display: fmt(get(r)) }))
  });

  if (sel === 'cdm') {
    return [{
      title: 'CrystalDiskMark 吞吐', unit: 'MB/s', better: 'high',
      note: '测试设置 16 GiB × 3 次；每一行为独立坐标，★ 标记该行最优',
      rows: METRICS.cdm.map(m => mk(m.label, r => r.cdm[m.k], v => Fmt.auto(v)))
    }];
  }

  if (sel === 'asssd') {
    const th = METRICS.asssd.slice(0, 6);   // 吞吐
    const lt = METRICS.asssd.slice(6);      // 延迟
    return [
      {
        title: 'AS SSD 吞吐', unit: 'MB/s', better: 'high',
        note: '5 GB 测试文件；4K 单队列与深队列量级不同，各自独立缩放',
        rows: th.map(m => mk(m.label, r => r.asssd[m.k], v => Fmt.auto(v)))
      },
      {
        title: 'AS SSD 访问延迟', unit: 'ms', better: 'low',
        note: '越低越好，单独成图，不与吞吐混在一起',
        rows: lt.map(m => mk(m.label, r => r.asssd[m.k], v => Fmt.ms(v)))
      }
    ];
  }

  const isLat = sel === 'txLat';
  const fmt = isLat ? (v => Fmt.ms(v)) : (v => Fmt.auto(v));
  const keys = isLat ? ['latencyEmpty', 'latencyFull'] : ['speedEmpty', 'speedFull'];
  const names = ['空盘', '85% 满盘'];
  return keys.map((k, gi) => ({
    title: 'TX-Bench ' + (isLat ? '响应延迟' : '传输速度') + ' · ' + names[gi],
    unit: isLat ? 'ms' : 'MB/s',
    better: isLat ? 'low' : 'high',
    note: scenNote() + '；' + (isLat
      ? '混合负载取读/写中较大者，即最差情况；越低越好'
      : '混合负载取读/写中较高者，即该场景主导方向的吞吐'),
    // 短标签画图，完整含义挂到悬停提示上
    rows: scen.map((s, si) => {
      const row = mk(s.short, r => txPrimary(r.txbench[k][si]), fmt);
      if (s.label && s.label !== s.short) row.tip = s.label;
      return row;
    })
  }));
}

function renderBenchChart() {
  const sel = document.getElementById('benchSel').value;
  const host = document.getElementById('cBench');
  const groups = buildBenchGroups(sel);

  if (benchMode === 'rows') {
    Chart.multiHBar(host, { groups });
    return;
  }

  // 合并坐标模式：每组一张分组柱状图，x 轴标签自动缩放/倾斜
  // 线性 or 对数由用户选择决定
  const log = benchMode === 'log';
  host.innerHTML = groups.map((g, i) => `
    <div style="margin-bottom:20px">
      <p class="chart-title">${UI.esc(g.title)}（${UI.esc(g.unit)}）
        <span style="font-size:11px;font-weight:600;color:${g.better === 'low' ? '#0369a1' : '#15803d'}">
          ${g.better === 'low' ? '↓ 越低越好' : '↑ 越高越好'}</span></p>
      ${g.note ? `<p class="chart-sub">${UI.esc(g.note)}</p>` : ''}
      <div class="chart" id="mb${i}"></div>
    </div>`).join('');

  groups.forEach((g, i) => {
    const series = LIST.map((r, si) => ({
      name: shortOf(r), color: Chart.color(si),
      values: g.rows.map(row => (row.items[si] ? row.items[si].value : null))
    }));
    Chart.groupBar(host.querySelector('#mb' + i), {
      categories: g.rows.map(r => r.label),
      series,
      logScale: log,
      showValues: LIST.length <= 2,
      valueFormat: (v) => (g.unit === 'ms' ? Fmt.ms(v) : Fmt.auto(v))
    });
  });
}

/* ---------------- 规格表 ---------------- */

function renderSpecTable() {
  const rows = [
    ['品牌', r => (r.brandEn ? `${r.brand}（${r.brandEn}）` : r.brand)],
    ['型号', r => r.model],
    ['代号 / 料号', r => r.pn],
    ['容量', r => r.capacity],
    ['定位', r => r.tier],
    ['接口', r => r.interface],
    ['总线', r => r.bus],
    ['PCIe 代际', r => r.pcieGen],
    ['通道数', r => r.lanes ? 'x' + r.lanes : null],
    ['主控', r => r.controller],
    ['NAND 颗粒', r => r.nand],
    ['颗粒类型', r => r.nandType],
    ['DRAM 缓存', r => r.dram || '无（DRAM-less）'],
    ['标称顺序读取 (MB/s)', r => r.spec.seqRead, 'num'],
    ['标称顺序写入 (MB/s)', r => r.spec.seqWrite, 'num'],
    ['标称随机读 (IOPS)', r => r.spec.randReadIOPS, 'num'],
    ['标称随机写 (IOPS)', r => r.spec.randWriteIOPS, 'num'],
    ['天梯排名', r => r.rank, 'num']
  ];

  const t = document.getElementById('specTable');
  const vals = rows.map(([label, fn]) => LIST.map(r => {
    const v = fn(r);
    return v == null ? '' : String(v);
  }));
  const show = rows.map((_, i) => !onlyDiff || new Set(vals[i]).size > 1);

  t.innerHTML = `<thead><tr><th class="metric">规格项</th>
      ${LIST.map((r, i) => `<th style="border-top:3px solid ${Chart.color(i)}">${UI.esc(shortOf(r))}
        <div style="font-weight:400;color:var(--muted)">${UI.esc(r.capacity || '')}</div></th>`).join('')}
    </tr></thead><tbody>
    ${rows.map(([label, fn, cls], i) => show[i] ? `<tr>
      <td class="metric" style="text-align:left">${UI.esc(label)}</td>
      ${LIST.map(r => {
        const v = fn(r);
        return `<td class="${cls === 'num' ? '' : ''}">${v == null ? '<span class="na">—</span>' : (cls === 'num' ? Fmt.n(v, 0) : UI.esc(v))}</td>`;
      }).join('')}
    </tr>` : '').join('')}
    </tbody>`;
}

/* ---------------- 跑分明细表 ---------------- */

function renderBenchTable() {
  const scen = scenList();

  const sections = [];
  sections.push({
    title: '评分', rows: SCORE_DEFS.map(s => ({
      label: s.label, better: 'high', fmt: Fmt.score, word: 'score', get: r => r.scores[s.k]
    }))
  });
  sections.push({
    title: 'AS SSD Benchmark（5G）',
    rows: METRICS.asssd.map(m => ({
      label: m.label + '（' + m.unit + '）', better: m.better,
      fmt: m.unit === 'ms' ? Fmt.ms : Fmt.auto, get: r => r.asssd[m.k]
    }))
  });
  sections.push({
    title: 'CrystalDiskMark（16G · 3 次）',
    rows: METRICS.cdm.map(m => ({
      label: m.label + '（MB/s）', better: 'high', fmt: Fmt.auto, get: r => r.cdm[m.k]
    }))
  });
  TX_GROUPS.forEach(g => {
    sections.push({
      title: 'TX-Bench · ' + g.title + '（' + g.unit + '）',
      rows: scen.flatMap((s, i) => {
        const isLat = g.k.startsWith('latency');
        const fmt = isLat ? Fmt.ms : Fmt.auto;
        return [
          { label: s.short + ' · 读', tip: s.label, better: g.better, fmt, get: r => r.txbench[g.k][i].read },
          { label: s.short + ' · 写', tip: s.label, better: g.better, fmt, get: r => r.txbench[g.k][i].write }
        ];
      })
    });
  });

  // 只对比两款时，多给一列「百分比差异」：以第一块为基准，看第二块快/慢多少
  const two = LIST.length === 2;
  const A = LIST[0], B = LIST[1];
  const span = LIST.length + (two ? 2 : 1);

  const t = document.getElementById('benchTable');
  let html = `<thead><tr><th class="metric">测试项</th>
    ${LIST.map((r, i) => `<th style="border-top:3px solid ${Chart.color(i)}">${UI.esc(shortOf(r))}</th>`).join('')}
    ${two ? `<th class="delta-head">差异（B 相对 A）</th>` : ''}
  </tr></thead><tbody>`;

  sections.forEach(sec => {
    html += `<tr class="section"><td colspan="${span}">${UI.esc(sec.title)}</td></tr>`;
    sec.rows.forEach(row => {
      const vals = LIST.map(r => row.get(r));
      const nums = vals.filter(v => v != null && !isNaN(v));
      let bestIdx = -1;
      if (nums.length > 1) {
        const target = row.better === 'low' ? Math.min(...nums) : Math.max(...nums);
        bestIdx = vals.findIndex(v => v === target);
      }
      const tip = row.tip ? ` title="${UI.esc(row.tip)}"` : '';
      html += `<tr><td class="metric" style="text-align:left"${tip}>${UI.esc(row.label)}</td>
        ${vals.map((v, i) => `<td class="${i === bestIdx ? 'best' : ''}">${v == null ? '<span class="na">—</span>' : row.fmt(v)}</td>`).join('')}
        ${two ? `<td class="delta">${deltaCell(row.get(A), row.get(B), row.better, row.word)}</td>` : ''}
      </tr>`;
    });
  });
  html += '</tbody>';
  t.innerHTML = html;

  const note = document.getElementById('benchNote');
  if (note) {
    note.textContent = two
      ? `「差异」列以 ${shortOf(A)} 为基准，看 ${shortOf(B)} 相差百分之几。`
        + '绿色 = 第二块更优（吞吐更高 / 延迟更低），红色 = 第二块更差。'
      : scenNote() + '。鼠标悬停在测试项上可看完整说明。';
  }
}

/**
 * 两款对比时的百分比差异格。
 * word 决定用"高/低"还是"快/慢"措辞；方向由 better 决定，
 * 绿色 = 第二块更优，红色 = 第二块更差（与涨跌无关，纯粹是好坏）。
 */
function deltaCell(a, b, better, word) {
  const w = word || 'fast';
  if (a == null || b == null || isNaN(a) || isNaN(b) || a === 0) {
    return '<span class="na">—</span>';
  }
  const pct = (b - a) / Math.abs(a) * 100;
  const isBetter = better === 'low' ? pct < 0 : pct > 0;
  const abs = Math.abs(pct);
  if (abs < 0.05) return '<span class="dflat">持平</span>';
  const up = pct > 0;
  const verb = w === 'score'
    ? (up ? '高' : '低')
    : (better === 'low' ? (up ? '慢' : '快') : (up ? '快' : '慢'));
  return `<span class="dpill ${isBetter ? 'dg' : 'dr'}">${verb} ${abs.toFixed(1)}%</span>`;
}
