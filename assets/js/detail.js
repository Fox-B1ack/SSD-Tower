/* ============================================================
   detail.js — 单盘详情页：规格 + AS SSD / CDM / TX-Bench 全量跑分
   ============================================================ */

let REC = null;
let IDX = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  UI.renderHeader('home');
  initBenchMode();
  const id = Number(UI.qs('id'));
  if (!id) {
    document.getElementById('content').innerHTML =
      '<div class="empty"><h3>缺少硬盘编号</h3><p><a href="index.html">返回天梯榜</a></p></div>';
    return;
  }
  try {
    const [rec, idx, meta] = await Promise.all([DB.ssd(id), DB.index(), DB.meta()]);
    REC = rec; IDX = idx; DB.cacheIndex = idx; DB._meta = meta; _scen = null;
  } catch (e) {
    document.getElementById('content').innerHTML =
      '<div class="empty"><h3>加载失败</h3><p>' + UI.esc(e.message) + '</p></div>';
    return;
  }
  document.title = `${REC.brand} ${REC.model} ${REC.capacity || ''} · SSD 规格数据库`;
  document.getElementById('crumb').textContent = `${REC.brand} ${REC.model}`;
  render();
}

/* 同接口样本不足这么多款时，逐级放宽口径（接口 → 总线 → 全库）。
   放宽必须在文案里说清楚，否则就会出现「U.2 PCIe 4.0 X4 共 183 款」这种明显不对的话。 */
const MIN_PEERS = 3;

/**
 * 「平均水平」的对比组。
 * 以前这里按 interface 过滤、样本不足就悄悄放宽到 bus（NVMe），
 * 但标题仍写着 interface 的名字 —— 于是 U.2 的盘显示成「U.2 PCIe 4.0 X4 共 183 款」。
 * 现在把真实口径一起返回，标题和副标题都按实际取到的样本来写。
 */
function peerPool() {
  const rec = REC;
  const byIface = IDX.filter(x => x.id !== rec.id && x.interface && x.interface === rec.interface);
  if (rec.interface && byIface.length >= MIN_PEERS) {
    return { pool: byIface, label: '同接口盘', scope: rec.interface, note: null };
  }
  const byBus = IDX.filter(x => x.id !== rec.id && x.bus && x.bus === rec.bus);
  if (rec.bus && byBus.length >= MIN_PEERS) {
    return {
      pool: byBus, label: '同总线盘', scope: rec.bus,
      note: `${rec.interface || '该接口'} 样本不足 ${MIN_PEERS} 款，已放宽到 ${rec.bus} 总线`
    };
  }
  const all = IDX.filter(x => x.id !== rec.id);
  return {
    pool: all, label: '全库盘', scope: '全部',
    note: '接口与总线样本都不足，已放宽到全库平均'
  };
}

/** 对比组文案：口径 + 样本数，放宽时把原因一并写出来 */
function peerSub(peer) {
  return `对比组：${peer.label} · ${peer.scope}（共 ${peer.pool.length} 款）` +
    (peer.note ? `；${peer.note}` : '');
}

function avg(list, fn) {
  const v = list.map(fn).filter(x => x != null && !isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function render() {
  const r = REC;
  const picked = Basket.has(r.id);

  const head = `
    <div class="dhead">
      <div class="title">
        <h1>${UI.esc(r.brand)} ${UI.esc(r.model)}${r.capacity ? ' <span style="color:var(--muted);font-size:16px">' + UI.esc(r.capacity) + '</span>' : ''}</h1>
        <div class="brandline">
          ${r.brandEn ? UI.esc(r.brandEn) + ' · ' : ''}${UI.esc(r.tier || '未分类')} · ${UI.esc(r.interface || '—')}
          ${r.rank ? ' · 天梯排名 <b>#' + r.rank + '</b> / ' + IDX.length : ''}
        </div>
        <div class="pn">代号 / 料号：${UI.esc(r.pn || '—')}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm ${picked ? '' : 'btn-primary'}" id="btnCompare">${picked ? '已从对比中移除' : '加入对比'}</button>
          <a class="btn btn-sm" href="index.html?q=${encodeURIComponent(r.brand)}">查看同品牌</a>
          <a class="btn btn-sm" href="index.html">返回天梯榜</a>
        </div>
      </div>
      <div class="scorecards">
        ${SCORE_DEFS.map((s, i) => `
          <div class="scard ${i === 0 ? 'hero' : ''}" title="${UI.esc(s.desc)}">
            <div class="k">${s.label}</div>
            <div class="v">${Fmt.score(r.scores[s.k])}<small>${i === 0 ? '/ ' + IDX.length + ' 款中第 ' + (r.rank || '—') + ' 名' : ''}</small></div>
          </div>`).join('')}
      </div>
    </div>`;

  const spec = `
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h2>硬件规格</h2><span class="sub">厂商标称与拆解信息</span></div>
      <div class="panel-body">
        <div class="cols2">
          <table class="kv-table">
            <tr><th>品牌</th><td>${UI.esc(r.brand)}${r.brandEn ? '（' + UI.esc(r.brandEn) + '）' : ''}</td></tr>
            <tr><th>型号</th><td>${UI.esc(r.model)}</td></tr>
            <tr><th>代号 / 料号</th><td class="pn">${UI.esc(r.pn || '—')}</td></tr>
            <tr><th>容量</th><td>${UI.esc(r.capacity || '—')}</td></tr>
            <tr><th>定位</th><td><span class="tag ${r.tier === '企业' ? 'tag-ent' : 'tag-home'}">${UI.esc(r.tier || '—')}</span></td></tr>
            <tr><th>接口</th><td>${UI.esc(r.interface || '—')}</td></tr>
          </table>
          <table class="kv-table">
            <tr><th>主控</th><td>${UI.esc(r.controller || '—')}</td></tr>
            <tr><th>NAND 颗粒</th><td>${UI.esc(r.nand || '—')}</td></tr>
            <tr><th>DRAM 缓存</th><td>${UI.esc(r.dram || '无缓存（DRAM-less）')}</td></tr>
            <tr><th>标称顺序读取</th><td>${r.spec.seqRead != null ? Fmt.n(r.spec.seqRead, 0) + ' MB/s' : '—'}</td></tr>
            <tr><th>标称顺序写入</th><td>${r.spec.seqWrite != null ? Fmt.n(r.spec.seqWrite, 0) + ' MB/s' : '—'}</td></tr>
            <tr><th>标称随机 IOPS</th><td>${r.spec.randReadIOPS != null ? '读 ' + Fmt.iops(r.spec.randReadIOPS) + ' / 写 ' + Fmt.iops(r.spec.randWriteIOPS) : '—'}</td></tr>
          </table>
        </div>
      </div>
    </div>`;

  const tabs = `
    <div class="panel">
      <div class="viewbar" id="modeBar" style="margin:12px 16px 0"></div>
      <div class="tabs" id="tabs">
        <button class="on" data-tab="overview">总览</button>
        <button data-tab="asssd">AS SSD</button>
        <button data-tab="cdm">CrystalDiskMark</button>
        <button data-tab="tx">TX-Bench</button>
        <button data-tab="raw">全部原始数据</button>
      </div>
      <div id="panes">
        <div class="tabpane on" data-pane="overview"></div>
        <div class="tabpane" data-pane="asssd"></div>
        <div class="tabpane" data-pane="cdm"></div>
        <div class="tabpane" data-pane="tx"></div>
        <div class="tabpane" data-pane="raw"></div>
      </div>
    </div>`;

  document.getElementById('content').innerHTML = head + spec + tabs;

  document.getElementById('btnCompare').onclick = e => {
    Basket.toggle(r.id);
    const now = Basket.has(r.id);
    e.target.textContent = now ? '已从对比中移除' : '加入对比';
    e.target.classList.toggle('btn-primary', !now);
    UI.toast(now ? '已加入对比' : '已移出对比');
  };

  let activeTab = 'overview';
  const PANE_RENDER = {
    overview: renderOverview, asssd: renderAsssd, cdm: renderCdm, tx: renderTx
  };

  document.querySelectorAll('#tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
      // 只切换外层页签！TX-Bench 内部还有一层 .tabpane（速度/延迟），
      // 用 '.tabpane' 会连内层一起关掉，导致首次进入 TX 时内容空白
      document.querySelectorAll('#panes > .tabpane').forEach(p =>
        p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
      // 未激活页签里的图表当初是按默认宽度画的（clientWidth 为 0），
      // 这里按真实宽度重画一次，避免切换后尺寸和别的不一致
      activeTab = b.dataset.tab;
      const fn = PANE_RENDER[activeTab];
      if (fn) fn();
    };
  });

  // 窗口尺寸变了，图表宽度也要跟着变
  let _rz = null;
  window.addEventListener('resize', () => {
    clearTimeout(_rz);
    _rz = setTimeout(() => { const fn = PANE_RENDER[activeTab]; if (fn) fn(); }, 200);
  });

  renderModeBar(document.getElementById('modeBar'), redrawBench);

  renderOverview();
  renderAsssd();
  renderCdm();
  renderTx();
  renderRaw();
}

/** 切换「图表方式」后重画所有实测图（表格类内容不受影响） */
function redrawBench() {
  renderOverview();
  renderAsssd();
  renderCdm();
  renderTx();
}

/* ---------------- 总览 ---------------- */

function renderOverview() {
  const r = REC;
  const peer = peerPool();
  const pane = document.querySelector('[data-pane=overview]');
  const scen = State_meta_scenarios();

  const scoreItems = SCORE_DEFS.map((s, i) => ({
    label: s.label, sub: s.desc, value: r.scores[s.k] ?? 0,
    display: Fmt.score(r.scores[s.k]),
    color: ['#2563eb', '#0891b2', '#7c3aed', '#16a34a'][i]
  }));

  const peerCats = ['顺序读', '顺序写', '4K随机读 Q8T8', '4K随机写 Q8T8'];
  const mine = [r.cdm.seqR, r.cdm.seqW, r.cdm.r4kq8t8, r.cdm.w4kq8t8];
  const peerAvg = [
    avg(peer.pool, x => x.key.cdmSeqR), avg(peer.pool, x => x.key.cdmSeqW),
    avg(peer.pool, x => x.key.cdm4kR), avg(peer.pool, x => x.key.cdm4kW)
  ];

  const ag = asssdGroups(), cg = cdmGroups();

  /* 总览固定五张卡，顺序按用户约定：
     四项评分 → 同总线对比（CDM）→ CrystalDiskMark → AS SSD → TX-Bench 稳定性。
     AS SSD 与 CDM 在总览里只保留速度类指标（MB/s），用竖向柱状图；
     延迟、每行独立缩放的完整明细仍在各自页签里，这里只做摘要。 */
  const cards = [
    {
      title: '四项评分',
      sub: `基准盘 = 1.000，数值越高越好；排在 ${IDX.length} 款中的第 ${r.rank || '—'} 名`,
      shape: 'bar', key: 'scores',
      draw: el => Chart.hbar(el, {
        items: scoreItems, max: Math.max(...scoreItems.map(s => s.value), 1) * 1.1
      })
    },
    {
      title: `与${peer.label}的平均水平对比（CDM）`,
      sub: peerSub(peer),
      dir: 'high', shape: 'column', key: 'peer',
      draw: el => Chart.groupBar(el, {
        categories: peerCats,
        series: [
          { name: UI.esc(r.model), values: mine, color: '#2563eb' },
          { name: peer.label + '平均', values: peerAvg, color: '#cbd5e1' }
        ],
        logScale: benchMode === 'log',
        valueFormat: v => Fmt.n(v, 0)
      })
    },
    speedColumnCard('CrystalDiskMark 吞吐（MB/s）', cg[0].subs.flatMap(s => s.items), 'cdm'),
    speedColumnCard('AS SSD 吞吐（MB/s）', ag[0].subs.flatMap(s => s.items), 'asssd'),
    {
      title: 'TX-Bench 持续写入稳定性（MB/s）',
      sub: '六种混合负载，空盘 vs 85% 满盘，取主导方向吞吐',
      dir: 'high', shape: 'column', key: 'steady',
      draw: el => Chart.groupBar(el, {
        categories: scen.map(s => s.short),
        series: [
          { name: '空盘', values: r.txbench.speedEmpty.map(txPrimary), color: '#2563eb' },
          { name: '85% 满盘', values: r.txbench.speedFull.map(txPrimary), color: '#7c3aed' }
        ],
        logScale: benchMode === 'log',
        valueFormat: v => Fmt.n(v, 0)
      })
    }
  ];

  renderChartGrid(pane, cards);
}

/**
 * 总览用的「速度类」柱状卡：只取 MB/s 指标，竖向柱状图。
 * 顺序吞吐（几千 MB/s）与 4K（几十 MB/s）量级差两个数量级，
 * 线性坐标会把 4K 压成看不见的一根线 —— 所以分项/对数模式下这张卡用对数纵轴
 * （副标题会注明），只有用户明确选「合并·线性」时才用线性。
 */
function speedColumnCard(title, items, key) {
  const useLog = benchMode !== 'linear';
  return {
    title, key, dir: 'high', shape: 'column',
    sub: useLog
      ? '速度类指标 · 对数纵轴（4K 与顺序量级差两个数量级）'
      : '速度类指标 · 线性纵轴',
    draw: el => Chart.groupBar(el, {
      categories: items.map(i => i.label),
      series: [{ name: '本盘', values: items.map(i => i.value), color: '#2563eb' }],
      logScale: useLog,
      showValues: true,
      valueFormat: v => Fmt.auto(v)
    })
  };
}

/* TX-Bench 场景名。权威来源是 data/meta.json（由 build_data.py 生成），
   这里的兜底值必须与 tools/build_data.py 的 TX_SCENARIOS 一致。 */
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

let _scen = null;
function State_meta_scenarios() {
  if (_scen) return _scen;
  _scen = (DB._meta && DB._meta.txScenarios) || TX_SCEN_FALLBACK;
  return _scen;
}
function scenNote() {
  return (DB._meta && DB._meta.txScenarioNote) || TX_SCEN_NOTE;
}

/* ---------------- AS SSD ---------------- */

const _max1 = (items, floor) => Math.max(...items.map(i => Math.abs(i.value) || 0), floor) * 1.1;

/** AS SSD 的指标分组：吞吐 / 延迟两大组，吞吐内部再按量级拆成两个分项 */
function asssdGroups() {
  const r = REC;
  const it = (label, key, ms) => ({
    label, value: r.asssd[key],
    display: ms ? Fmt.ms(r.asssd[key]) : Fmt.auto(r.asssd[key])
  });
  const seqItems = [
    it('顺序读取', 'seqR'), it('顺序写入', 'seqW'),
    it('4K-64Thrd 读取', 'r4k64'), it('4K-64Thrd 写入', 'w4k64')
  ];
  const k4Items = [it('4K 随机读取', 'r4k'), it('4K 随机写入', 'w4k')];
  const latItems = [it('访问延迟 读', 'accR', true), it('访问延迟 写', 'accW', true)];
  const all = [...seqItems, ...k4Items];

  return [
    {
      title: 'AS SSD 吞吐', unit: 'MB/s', better: 'high',
      note: '5 GB 测试文件 · 4K 单队列与顺序/深队列量级差两个数量级',
      subs: [
        {
          title: '顺序与深队列吞吐', note: 'AS SSD Benchmark · 5G',
          items: seqItems, rowH: 28, max: _max1(seqItems, 1)
        },
        {
          title: '4K 单队列吞吐', note: '量级远小于上一组，单独缩放',
          items: k4Items, rowH: 28, barColor: '#7c3aed', max: _max1(k4Items, 1)
        }
      ],
      merged: {
        cats: all.map(i => i.label),
        series: [{ name: '本盘', values: all.map(i => i.value), color: '#2563eb' }]
      }
    },
    {
      title: 'AS SSD 访问延迟', unit: 'ms', better: 'low',
      note: 'Acc.time 读取 / 写入，不与吞吐共用坐标',
      subs: [{
        title: '访问延迟', items: latItems, rowH: 34, barColor: '#0891b2',
        max: _max1(latItems, 0.001)
      }],
      merged: {
        cats: latItems.map(i => i.label),
        series: [{ name: '本盘', values: latItems.map(i => i.value), color: '#0891b2' }]
      }
    }
  ];
}

function renderAsssd() {
  const r = REC;
  const pane = document.querySelector('[data-pane=asssd]');
  pane.innerHTML = `
    <div id="asssdBench"></div>
    <div style="margin-top:14px">
      <table class="kv-table">
        <thead><tr><th style="width:200px">测试项</th><th style="width:140px">结果</th><th>单位</th></tr></thead>
        <tbody>${METRICS.asssd.map(m => `<tr>
          <th>${m.label}</th>
          <td><b>${m.unit === 'ms' ? Fmt.ms(r.asssd[m.k]) : Fmt.auto(r.asssd[m.k])}</b></td>
          <td style="color:var(--muted)">${m.unit}</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="mini-note">注：AS SSD 的 4K 单项受 CPU 性能影响较大，本数据库的综合评分未采用该项，此处仅作参考。</p>
    </div>`;
  renderBenchGroups(document.getElementById('asssdBench'), asssdGroups());
}

/* ---------------- CrystalDiskMark ---------------- */

/** CrystalDiskMark 分组：顺序与 4K 随机量级差一个数量级，分项模式下分开缩放 */
function cdmGroups() {
  const r = REC;
  const seqItems = METRICS.cdm.slice(0, 2).map(m => ({
    label: m.label.replace(' Q8T1', ''), value: r.cdm[m.k], display: Fmt.auto(r.cdm[m.k])
  }));
  const randItems = METRICS.cdm.slice(2).map(m => ({
    label: m.label, value: r.cdm[m.k], display: Fmt.auto(r.cdm[m.k])
  }));
  const all = [...seqItems, ...randItems];
  return [{
    title: 'CrystalDiskMark 吞吐', unit: 'MB/s', better: 'high',
    note: '测试设置 16 GiB · 3 次 · 顺序为 Q8T1',
    subs: [
      {
        title: '顺序吞吐', note: 'Q8T1 连续大文件',
        items: seqItems, rowH: 26, max: _max1(seqItems, 1)
      },
      {
        title: '4K 随机吞吐', note: '与顺序吞吐分开缩放，避免被大值压平',
        items: randItems, rowH: 26, barColor: '#7c3aed', max: _max1(randItems, 1)
      }
    ],
    merged: {
      cats: all.map(i => i.label),
      series: [{ name: '本盘', values: all.map(i => i.value), color: '#2563eb' }]
    }
  }];
}

function renderCdm() {
  const r = REC;
  const pane = document.querySelector('[data-pane=cdm]');
  pane.innerHTML = `
    <div id="cdmCharts"></div>
    <div style="margin-top:14px">
      <table class="kv-table">
        <thead><tr><th style="width:200px">测试项</th><th style="width:140px">结果</th><th>说明</th></tr></thead>
        <tbody>${METRICS.cdm.map(m => `<tr>
          <th>${m.label}</th>
          <td><b>${Fmt.auto(r.cdm[m.k])} MB/s</b></td>
          <td style="color:var(--muted)">${cdmNote(m.k)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const cards = [];
  if (benchMode === 'rows') {
    cards.push({
      title: 'CrystalDiskMark', sub: '每行独立缩放；顺序与 4K 随机量级差一个数量级，分开归一',
      shape: 'bar', key: 'cdm', draw: el => Chart.multiHBar(el, { groups: toMultiGroups(cdmGroups()) })
    });
  } else {
    const c = benchGroupCard(cdmGroups()[0]);
    c.key = 'cdm';
    cards.push(c);
  }

  cards.push({
    title: '队列深度对随机性能的影响（MB/s）',
    sub: '4K 随机读 / 写在不同队列与线程下',
    dir: 'high', shape: 'column', key: 'queueDepth',
    // 以前漏了 logScale，切到「合并坐标 · 对数」时这张图纹丝不动
    draw: el => Chart.groupBar(el, {
      categories: ['读取', '写入'],
      series: [
        { name: 'Q8T1', values: [r.cdm.r4kq8t1, r.cdm.w4kq8t1], color: '#2563eb' },
        { name: 'Q64T1', values: [r.cdm.r4kq64t1, r.cdm.w4kq64t1], color: '#0891b2' },
        { name: 'Q8T8', values: [r.cdm.r4kq8t8, r.cdm.w4kq8t8], color: '#7c3aed' }
      ],
      logScale: benchMode === 'log',
      valueFormat: v => Fmt.n(v, 0)
    })
  });

  renderChartGrid(document.getElementById('cdmCharts'), cards);
}

function cdmNote(k) {
  return {
    seqR: '连续大文件读取', seqW: '连续大文件写入',
    r4kq8t1: '单队列单线程随机读', w4kq8t1: '单队列单线程随机写',
    r4kq64t1: '深队列单线程随机读', w4kq64t1: '深队列单线程随机写',
    r4kq8t8: '多线程随机读（接近满载）', w4kq8t8: '多线程随机写（接近满载）'
  }[k] || '';
}

/* ---------------- TX-Bench ---------------- */

function renderTx() {
  const r = REC;
  const pane = document.querySelector('[data-pane=tx]');
  const scen = State_meta_scenarios();
  pane.innerHTML = `
    <div class="tabs" id="txTabs" style="margin:-4px -0px 12px">
      <button class="on" data-tx="speed">传输速度</button>
      <button data-tx="latency">响应延迟</button>
    </div>
    <p class="chart-sub" style="margin-bottom:10px">${UI.esc(scenNote())}</p>
    <div id="txPanes">
      <div class="tabpane on" data-txp="speed">
        <div id="txSpeedBench"></div>
        <div id="txSpeedExtras" style="margin-top:8px"></div>
        ${txTable('speed')}
      </div>
      <div class="tabpane" data-txp="latency">
        <div id="txLatBench"></div>
        <div id="txLatExtras" style="margin-top:8px"></div>
        ${txTable('latency')}
      </div>
    </div>`;

  document.querySelectorAll('#txTabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#txTabs button').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('#txPanes .tabpane').forEach(p =>
        p.classList.toggle('on', p.dataset.txp === b.dataset.tx));
      // 隐藏的子页签里图表也是按默认宽度画的，切过来要按真实宽度重画
      redrawTxPane(b.dataset.tx);
    };
  });

  redrawTxPane('speed');
  // 延迟那一页此刻是隐藏的（clientWidth=0），先画个默认宽度的版本占位，
  // 用户切过去时会被 redrawTxPane 重画成正确尺寸
  redrawTxPane('latency');
}

/** 按当前宽度重画某个 TX 子页签里的图（保持率 + 读写拆分） */
function redrawTxPane(kind) {
  const isSpeed = kind === 'speed';
  renderBenchGroups(document.getElementById(isSpeed ? 'txSpeedBench' : 'txLatBench'), txGroups(kind));

  // 保持率是横向条形（高度随行数）→ 独占一行；
  // 读写拆分是柱状图 → 与空盘/满盘组同为柱状时会两两并列。
  renderChartGrid(document.getElementById(isSpeed ? 'txSpeedExtras' : 'txLatExtras'), [
    {
      title: isSpeed ? '满盘性能保持率' : '满盘延迟保持率',
      sub: isSpeed
        ? '满盘速度 ÷ 空盘速度；100% = 与空盘一致，低于 100% 即掉速'
        : '空盘延迟 ÷ 满盘延迟；100% = 与空盘一致，低于 100% 说明满盘延迟变长',
      shape: 'bar', key: 'keep',
      draw: el => drawRetention(el, kind)
    },
    {
      title: `各场景读写拆分（空盘，${isSpeed ? 'MB/s' : 'ms'}）`,
      sub: '同时给出读与写，便于看混合负载下两者的差距',
      dir: isSpeed ? 'high' : 'low', shape: 'column', key: 'rw',
      draw: el => drawTxRW(el, isSpeed ? REC.txbench.speedEmpty : REC.txbench.latencyEmpty, isSpeed)
    }
  ]);
}

/** TX-Bench 分组：空盘 / 85% 满盘 两个分项，合并模式下作为两条系列 */
function txGroups(kind) {
  const r = REC;
  const scen = State_meta_scenarios();
  const isSpeed = kind === 'speed';
  const empKey = isSpeed ? 'speedEmpty' : 'latencyEmpty';
  const fulKey = isSpeed ? 'speedFull' : 'latencyFull';
  const fmt = v => (isSpeed ? Fmt.auto(v) : Fmt.ms(v));
  const mk = arr => scen.map((s, i) => ({
    label: s.short,
    tip: s.label || s.short,
    value: txPrimary(arr[i]),
    display: fmt(txPrimary(arr[i])),
    sub: (s.label || s.short) + '：读 ' + fmt(arr[i] && arr[i].read) + ' / 写 ' + fmt(arr[i] && arr[i].write)
  }));
  const e = mk(r.txbench[empKey]);
  const f = mk(r.txbench[fulKey]);
  const floor = isSpeed ? 1 : 0.0001;

  return [{
    title: 'TX-Bench ' + (isSpeed ? '传输速度' : '响应延迟'),
    unit: isSpeed ? 'MB/s' : 'ms',
    better: isSpeed ? 'high' : 'low',
    note: scenNote() + '；' + (isSpeed
      ? '混合负载取读/写中较高者，即主导方向的吞吐'
      : '混合负载取读/写中较大者，即最差情况'),
    subs: [
      {
        title: '空盘', items: e, rowH: 26, barColor: isSpeed ? '#2563eb' : '#0891b2',
        max: _max1(e, floor)
      },
      {
        title: '85% 满盘', items: f, rowH: 26, barColor: isSpeed ? '#7c3aed' : '#db2777',
        max: _max1(f, floor)
      }
    ],
    merged: {
      cats: scen.map(s => s.short),
      series: [
          { name: '空盘', values: e.map(i => i.value), color: isSpeed ? '#2563eb' : '#0891b2' },
      { name: '85% 满盘', values: f.map(i => i.value), color: isSpeed ? '#7c3aed' : '#db2777' }
      ]
    }
  }];
}

/**
 * 空盘 → 85% 满盘 的性能保持率。
 * 速度：满盘 ÷ 空盘；延迟：空盘 ÷ 满盘（延迟变长会让比值下降）。
 * 统一口径：100% = 满盘与空盘一致，越接近 100% 越好；虚线为 100% 基准。
 */
function retentionItems(kind) {
  const r = REC;
  const scen = State_meta_scenarios();
  const isSpeed = kind === 'speed';
  const e = isSpeed ? r.txbench.speedEmpty : r.txbench.latencyEmpty;
  const f = isSpeed ? r.txbench.speedFull : r.txbench.latencyFull;
  return scen.map((s, i) => {
    const a = txPrimary(e[i]), b = txPrimary(f[i]);
    const pct = (a == null || b == null || !a) ? null
      : (isSpeed ? b / a : a / b) * 100;
    return {
      label: s.short,
      tip: (s.label || s.short) + ' 空盘 ' + (isSpeed ? Fmt.auto(a) : Fmt.ms(a)) +
           ' / 满盘 ' + (isSpeed ? Fmt.auto(b) : Fmt.ms(b)),
      value: pct,
      display: pct == null ? '—' : pct.toFixed(1) + '%'
    };
  });
}

function drawRetention(host, kind) {
  const items = retentionItems(kind);
  if (!host) return;
  const vals = items.map(i => i.value).filter(v => v != null && !isNaN(v));
  if (!vals.length) { host.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  Chart.hbar(host, {
    items, rowH: 26, barColor: '#16a34a',
    max: Math.max(105, Math.max(...vals) * 1.06),
    reference: 100, referenceLabel: '基准 100%',
    format: v => (v == null ? '—' : v.toFixed(1) + '%')
  });
}

/**
 * 各场景读 / 写拆分（分组柱状图）。
 * 以前这里没跟「图表方式」联动，切对数时 4K 随机那几根柱子被压得几乎看不见，
 * 现在一并接入 logScale。
 */
function drawTxRW(host, arr, speed) {
  if (!host) return;
  const scen = State_meta_scenarios();
  Chart.groupBar(host, {
    categories: scen.map(s => s.short),
    series: [
      { name: '读', values: arr.map(x => x.read), color: '#2563eb' },
      { name: '写', values: arr.map(x => x.write), color: '#ea580c' }
    ],
    logScale: benchMode === 'log',
    showValues: false,
    valueFormat: v => (speed ? Fmt.auto(v) : Fmt.ms(v))
  });
}

function txTable(kind) {
  const r = REC;
  const scen = State_meta_scenarios();
  const a = kind === 'speed' ? r.txbench.speedEmpty : r.txbench.latencyEmpty;
  const b = kind === 'speed' ? r.txbench.speedFull : r.txbench.latencyFull;
  const f = kind === 'speed' ? (v => Fmt.auto(v)) : (v => Fmt.ms(v));
  const keep = retentionItems(kind);
  return `<table class="grid" style="margin-top:14px">
    <thead><tr>
      <th>混合负载场景</th>
      <th class="num">空盘 · 读</th><th class="num">空盘 · 写</th>
      <th class="num">满盘 · 读</th><th class="num">满盘 · 写</th>
      <th class="num">满盘保持率</th>
    </tr></thead>
    <tbody>${scen.map((s, i) => `<tr>
      <td title="${UI.esc(s.label || s.short)}">${UI.esc(s.label || s.short)}</td>
      <td class="num">${f(a[i] && a[i].read)}</td><td class="num">${f(a[i] && a[i].write)}</td>
      <td class="num">${f(b[i] && b[i].read)}</td><td class="num">${f(b[i] && b[i].write)}</td>
      <td class="num"><b>${keep[i].display}</b></td>
    </tr>`).join('')}</tbody></table>`;
}

/* ---------------- 原始数据 ---------------- */

function renderRaw() {
  const r = REC;
  const pane = document.querySelector('[data-pane=raw]');
  const scen = State_meta_scenarios();
  let html = `<p class="mini-note" style="margin-bottom:10px">下表为该盘在数据库中的全部记录值，单位见列名。</p>`;
  html += `<div class="tablewrap"><table class="grid"><thead><tr><th>项目</th><th class="num">数值</th></tr></thead><tbody>`;

  const push = (group, label, unit, val, fmt) => {
    html += `<tr><td>${group} · ${label}${unit ? '（' + unit + '）' : ''}</td>
      <td class="num">${val == null ? '—' : fmt(val)}</td></tr>`;
  };

  ['seqRead', 'seqWrite'].forEach(k => push('标称', { seqRead: '顺序读取', seqWrite: '顺序写入' }[k], 'MB/s', r.spec[k], v => Fmt.n(v, 0)));
  ['randReadIOPS', 'randWriteIOPS'].forEach(k => push('标称', { randReadIOPS: '随机读 IOPS', randWriteIOPS: '随机写 IOPS' }[k], '', r.spec[k], Fmt.iops));
  METRICS.asssd.forEach(m => push('AS SSD', m.label, m.unit, r.asssd[m.k], m.unit === 'ms' ? Fmt.ms : Fmt.auto));
  METRICS.cdm.forEach(m => push('CDM', m.label, 'MB/s', r.cdm[m.k], Fmt.auto));
  TX_GROUPS.forEach(g => {
    const grp = r.txbench[g.k];
    scen.forEach((s, i) => {
      if (grp[i].read != null) push(g.title, s.short + ' · 读', g.unit, grp[i].read, g.unit === 'ms' ? Fmt.ms : Fmt.auto);
      if (grp[i].write != null) push(g.title, s.short + ' · 写', g.unit, grp[i].write, g.unit === 'ms' ? Fmt.ms : Fmt.auto);
    });
  });
  SCORE_DEFS.forEach(s => push('评分', s.label, '', r.scores[s.k], Fmt.score));

  html += `</tbody></table></div>`;
  pane.innerHTML = html;
}
