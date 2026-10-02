/**
 * 图表回归测试：验证本次修复的三个问题
 *   1. 分项对比图按指标分行，每行独立缩放（量级差异不再压平）
 *   2. 速度与延迟分成不同组，且方向标注相反
 *   3. x 轴标签自适应字号 / 倾斜，不再重叠
 *   4. 合并坐标模式使用对数轴
 *
 * 用法: node tools/test-charts.js http://127.0.0.1:8899
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = process.argv[2] || 'http://127.0.0.1:8899';

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')); }
};

async function open(url, wait = 2500, beforeParse) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = await JSDOM.fromURL(BASE + url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (i, o) => fetch(new URL(String(i), BASE + '/').href, o);
      if (beforeParse) beforeParse(w);
    }
  });
  await new Promise(r => setTimeout(r, wait));
  return { dom, doc: dom.window.document, win: dom.window, errs };
}

(async () => {
  // ---------------- 对比页：分项模式 ----------------
  console.log('\n[1] 对比页 · 分项对比（默认）');
  let { doc, win, errs } = await open('/compare.html?ids=88,160,206,249');
  ok(errs.length === 0, '无 JS 运行时错误', errs[0]);

  const svg = doc.querySelector('#cBench svg');
  ok(!!svg, '分项对比图已渲染');

  const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
  ok(texts.some(t => t.includes('↑ 越高越好')), '存在「越高越好」方向标注');
  ok(texts.some(t => t.includes('独立坐标') || t.includes('独立缩放')), '图表说明了独立缩放口径');

  // 每行独立缩放：取 CDM 图里"顺序读取"行（几千 MB/s）与"随机写入 Q8T1"行（几百 MB/s），
  // 两条各自的最优条都应该是满宽
  const rects = [...svg.querySelectorAll('rect')].filter(r => +r.getAttribute('width') > 2);
  const widths = rects.map(r => +r.getAttribute('width'));
  const full = Math.max(...widths);
  const nearlyFull = widths.filter(w => w > full * 0.985).length;
  ok(nearlyFull >= 2, '量级差异大的多行里，每行的最优条都能接近满宽（未被压平）',
    '满宽条数=' + nearlyFull);
  ok(Math.min(...widths) < full * 0.6, '同一图内仍保留盘与盘之间的差异（有短条）');

  // ---------------- 对比页：AS SSD 速度与延迟分离 ----------------
  console.log('\n[2] 对比页 · AS SSD（速度 / 延迟必须分开）');
  const sel = doc.querySelector('#benchSel');
  sel.value = 'asssd';
  sel.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 300));
  const svg2 = doc.querySelector('#cBench svg');
  const t2 = [...svg2.querySelectorAll('text')].map(t => t.textContent).join(' | ');
  ok(t2.includes('AS SSD 吞吐') && t2.includes('AS SSD 访问延迟'), '吞吐与延迟分成两个分组');
  ok(t2.includes('↓ 越低越好'), '延迟组标注「越低越好」');

  // 两组的标题都要出现，且延迟组标题里带 ms
  const groupTitles = [...svg2.querySelectorAll('text')].filter(t => t.textContent.includes('AS SSD'));
  ok(groupTitles.length >= 2, '两组标题均在图中', groupTitles.map(t => t.textContent.trim()).join(' / '));

  // ---------------- 对比页：三种图表方式可选 ----------------
  console.log('\n[3] 对比页 · 图表方式三选一（分项 / 线性 / 对数）');
  const modeBtns = [...doc.querySelectorAll('#benchMode button')].map(b => b.dataset.mode);
  ok(modeBtns.join(',') === 'rows,linear,log', '提供三种图表方式', modeBtns.join(','));
  ok(!!doc.querySelector('#modeHint').textContent.trim(), '当前方式带说明文字');

  doc.querySelector('#benchMode button[data-mode=log]').click();
  await new Promise(r => setTimeout(r, 300));
  ok(doc.querySelector('#benchMode button[data-mode=log]').classList.contains('on'), '对数按钮高亮');
  ok(doc.querySelector('#cBench').innerHTML.includes('对数刻度'), '对数模式纵轴标注对数刻度');
  ok(win.location.search.includes('mode=log'), '选择写入 URL，便于分享', win.location.search);
  ok(win.localStorage.getItem('ssddb.benchMode') === 'log', '选择被记住（localStorage）');

  const svg3 = doc.querySelector('#cBench svg');
  const rotated = [...svg3.querySelectorAll('text')].filter(t => (t.getAttribute('transform') || '').includes('rotate')).length;
  const fsList = [...svg3.querySelectorAll('text')].map(t => parseFloat(t.getAttribute('font-size'))).filter(n => !isNaN(n));
  ok(Math.min(...fsList) >= 7.9, 'x 轴字号不会缩小到不可读', 'min=' + Math.min(...fsList));
  ok(rotated > 0 || Math.max(...fsList) <= 11.01, '标签要么倾斜要么按槽位缩放字号',
    'rotate=' + rotated);

  doc.querySelector('#benchMode button[data-mode=linear]').click();
  await new Promise(r => setTimeout(r, 300));
  ok(!doc.querySelector('#cBench').innerHTML.includes('对数刻度'), '线性模式不标注对数');
  const svgLin = doc.querySelector('#cBench svg');
  const tickTxt = [...svgLin.querySelectorAll('text')].filter(t => t.getAttribute('text-anchor') === 'end')
    .map(t => t.textContent.trim());
  ok(tickTxt.some(t => /^[0-9,.]+$/.test(t)), '线性模式纵轴为常规数值刻度', tickTxt.slice(0, 4).join('/'));

  // ---------------- 对比页：TX-Bench 场景命名 ----------------
  console.log('\n[4] 对比页 · TX-Bench 场景命名与方向');
  doc.querySelector('#benchMode button[data-mode=rows]').click();

  const sel2 = doc.querySelector('#benchSel');
  sel2.value = 'txLat';
  sel2.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 300));
  const t4 = doc.querySelector('#cBench svg').textContent;
  ok(t4.includes('响应延迟') && t4.includes('越低越好'), 'TX 延迟图方向正确');
  sel2.value = 'txSpeed';
  sel2.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 300));
  const t5 = doc.querySelector('#cBench svg').textContent;
  ok(t5.includes('传输速度') && t5.includes('越高越好'), 'TX 速度图方向正确');

  // 场景名必须写成人话：不能出现 95R/5W 这类只有内行才懂的缩写
  ok(/\d+顺序(读|写)/.test(t5) && /\d+随机(读|写)/.test(t5),
    'TX 场景名使用「数字+顺序/随机读/随机写」', t5.slice(0, 80));
  ok(!/\d+[rR]?\s*\/\s*\d+[rR]?[wW]/.test(t5), '不再出现 R/W 缩写式场景名');
  ok(t5.includes('顺序 = 连续大块数据'), '图表内给出顺序/随机的口径说明');

  // ---------------- 对比页：两款时的百分比差异列 ----------------
  console.log('\n[5] 对比页 · 两款对比时的百分比差异列');
  const two = await open('/compare.html?ids=88,160');
  const head2 = [...two.doc.querySelectorAll('#benchTable thead th')].map(t => t.textContent.trim());
  ok(head2.some(t => t.includes('差异')), '两款时多出「差异」列', head2.join(' | '));
  const pills = two.doc.querySelectorAll('#benchTable td.delta .dpill');
  ok(pills.length > 10, '差异列渲染出百分比标记', 'count=' + pills.length);
  ok([...pills].every(p => /^(快|慢|高|低) \d+(\.\d+)?%$/.test(p.textContent.trim())),
    '差异文案为「快/慢/高/低 + 百分比」', pills[0] && pills[0].textContent.trim());
  ok(two.doc.querySelectorAll('#benchTable td.delta .dpill.dg').length > 0 &&
     two.doc.querySelectorAll('#benchTable td.delta .dpill.dr').length > 0,
    '同时存在更优（绿）与更差（红）两种判定');
  ok(two.doc.querySelector('#benchNote').textContent.includes('为基准'), '差异列给了口径说明');

  const three = await open('/compare.html?ids=88,160,206');
  const head3 = [...three.doc.querySelectorAll('#benchTable thead th')].map(t => t.textContent.trim());
  ok(!head3.some(t => t.includes('差异')), '超过两款时不显示差异列（避免歧义）');

  // ---------------- 详情页 ----------------
  console.log('\n[6] 详情页 · 分项/合并切换 + 顺序随机分离');
  const d = await open('/detail.html?id=88');
  ok(d.errs.length === 0, '详情页无 JS 错误', d.errs[0]);

  const dModes = [...d.doc.querySelectorAll('#modeBar #benchMode button')].map(b => b.dataset.mode);
  ok(dModes.join(',') === 'rows,linear,log', '详情页同样提供三种图表方式', dModes.join(','));

  // 分项模式：AS SSD 顺序/深队列 / 4K / 延迟 三张图
  const asssdPane = d.doc.querySelector('[data-pane=asssd]');
  ok(asssdPane.querySelectorAll('#asssdBench .chart svg').length === 3,
    '分项模式下 AS SSD 拆成 3 张图（顺序深队列 / 4K / 延迟）',
    'n=' + asssdPane.querySelectorAll('#asssdBench .chart svg').length);
  ok(asssdPane.textContent.includes('↓ 越低越好'), '延迟图标注越低越好');
  const cdmPane = d.doc.querySelector('[data-pane=cdm]');
  ok(cdmPane.querySelectorAll('#cdmCharts .chart svg').length === 2,
    '分项模式下 CDM 页两张图（行式分项 + 队列深度）',
    'n=' + cdmPane.querySelectorAll('#cdmCharts .chart svg').length);

  // 合并模式：同一组指标合成一张图，可选线性 / 对数
  d.doc.querySelector('#modeBar button[data-mode=log]').click();
  await new Promise(r => setTimeout(r, 400));
  ok(d.doc.querySelector('[data-pane=asssd]').innerHTML.includes('对数刻度'),
    '详情页对数模式生效（合并成对数坐标）');
  ok(d.doc.querySelectorAll('[data-pane=asssd] #asssdBench .chart svg').length === 2,
    '对数模式下 AS SSD 合并为吞吐 + 延迟两张图');
  ok([...d.doc.querySelectorAll('[data-pane=asssd] #asssdBench .bench-grid > div')]
      .every(x => !x.classList.contains('span-all')),
    'AS SSD 合并模式下两张柱状图两张并列（都不占整行）');
  // 队列深度图以前漏了 logScale，切对数纹丝不动
  ok(d.doc.querySelector('[data-pane=cdm] [data-chart=queueDepth]').innerHTML.includes('对数刻度'),
    'CDM「队列深度」图跟随对数模式');
  ok(d.doc.querySelector('[data-pane=tx] [data-txp=speed] [data-chart=rw]').innerHTML.includes('对数刻度'),
    'TX「各场景读写拆分」图跟随对数模式');
  d.doc.querySelector('#modeBar button[data-mode=linear]').click();
  await new Promise(r => setTimeout(r, 400));
  ok(!d.doc.querySelector('[data-pane=cdm]').innerHTML.includes('对数刻度'),
    '详情页线性模式不标注对数');
  d.doc.querySelector('#modeBar button[data-mode=rows]').click();
  await new Promise(r => setTimeout(r, 400));

  // ---------------- 详情页：TX-Bench 首次进入即显示（回归 bug） ----------------
  console.log('\n[7] 详情页 · TX-Bench 首屏与满盘保持率');
  const txTabBtn = [...d.doc.querySelectorAll('#tabs button')].find(b => b.dataset.tab === 'tx');
  txTabBtn.click();
  await new Promise(r => setTimeout(r, 400));
  const speedPane = d.doc.querySelector('#txPanes .tabpane[data-txp=speed]');
  ok(speedPane.classList.contains('on'),
    '首次点开 TX-Bench 时「传输速度」页就是可见的（不再需要点一下延迟才出来）');
  ok(speedPane.querySelectorAll('svg').length >= 2,
    '首屏即有图表', 'svg=' + speedPane.querySelectorAll('svg').length);

  const txPane = d.doc.querySelector('[data-pane=tx]');
  const txTxt = txPane.textContent;
  ok(/顺序(读|写)/.test(txTxt) && /随机(读|写)/.test(txTxt), '详情页 TX 场景名是中文全称');
  ok(!/\d+\s*[rR]\s*\/\s*\d+/.test(txTxt), '详情页不再出现 R/W 缩写');
  ok(speedPane.textContent.includes('满盘性能保持率'), '提供满盘性能保持率图');
  const keepSvg = txPane.querySelector('[data-txp=speed] [data-chart=keep] svg');
  ok(!!keepSvg, '保持率图已渲染');
  ok([...keepSvg.querySelectorAll('text')].some(t => t.textContent.includes('基准 100%')),
    '保持率图画了 100% 基准线');
  ok([...keepSvg.querySelectorAll('text')].some(t => /%$/.test(t.textContent.trim())),
    '保持率以百分比显示');
  ok(txPane.querySelector('[data-txp=latency] [data-chart=keep] svg'), '延迟也有保持率图');
  ok(txPane.querySelector('[data-txp=speed] [data-chart=rw] svg') &&
     txPane.querySelector('[data-txp=latency] [data-chart=rw] svg'),
    'TX 各场景读写拆分图');
  ok(txPane.querySelectorAll('table th').length >= 6 &&
     txPane.textContent.includes('满盘保持率'), 'TX 表格增加保持率列');

  // 场景名变长后，左侧标签区必须自动加宽，不能压到条形上
  const txBar = txPane.querySelector('#txSpeedBench svg');
  const labelXs = [...txBar.querySelectorAll('text')].map(t => +t.getAttribute('x'));
  const rectXs = [...txBar.querySelectorAll('rect')].map(r => +r.getAttribute('x'));
  ok(Math.min(...rectXs) >= Math.max(...labelXs.filter(x => x < 300)),
    '横条起点在标签右侧（标签区已自适应加宽）');

  // ---------------- 首页：默认视图与行布局 ----------------
  console.log('\n[6] 首页 · 默认天梯榜 + 行布局统一');
  const h = await open('/index.html');
  ok(h.errs.length === 0, '首页无 JS 错误', h.errs[0]);
  const segOn = [...h.doc.querySelectorAll('#viewSeg button')].filter(b => b.classList.contains('on'));
  ok(segOn.length === 1 && segOn[0].dataset.view === 'ladder', '默认选中「天梯图」');
  ok(!!h.doc.querySelector('.ladder') && !h.doc.querySelector('.tablewrap'),
    '默认渲染天梯榜而不是列表');
  const ht = await open('/index.html?view=table');
  ok(!!ht.doc.querySelector('.tablewrap') && !ht.doc.querySelector('.ladder'),
    'view=table 时才显示列表');

  // 行布局：宽屏一行、窄屏两行，且全表一致（靠 flex 而非行内流保证）
  const cs = h.win.getComputedStyle(h.doc.querySelector('.lrow .mid'));
  ok(cs.display === 'flex' && (cs.flexDirection || 'row') === 'row',
    '宽屏：型号与规格同属一个 flex 行容器', cs.display + '/' + cs.flexDirection);
  const nameCs = h.win.getComputedStyle(h.doc.querySelector('.lrow .name'));
  const metaCs = h.win.getComputedStyle(h.doc.querySelector('.lrow .meta'));
  ok(nameCs.display === 'block' && metaCs.display === 'block',
    '型号与规格都是块级（不会被行内流挤到下一行）',
    nameCs.display + '/' + metaCs.display);
  ok(nameCs.whiteSpace === 'nowrap' && metaCs.whiteSpace === 'nowrap',
    '两段文字都禁止换行，超长只截断', nameCs.whiteSpace);
  ok(!!h.doc.querySelector('.lrow .name').getAttribute('title'),
    '型号带悬停全文');

  // 勾选框必须是正常栅格列，不能用绝对定位（否则拉宽窗口会飘走）
  const pickCs = h.win.getComputedStyle(h.doc.querySelector('.lrow .pick'));
  ok((pickCs.position || 'static') === 'static',
    '勾选框未使用绝对定位', pickCs.position);
  ok(/^22px/.test(h.win.getComputedStyle(h.doc.querySelector('.lrow')).gridTemplateColumns || ''),
    '勾选框占天梯行的第一列',
    h.win.getComputedStyle(h.doc.querySelector('.lrow')).gridTemplateColumns);

  // ---------------- 筛选：宽屏常驻 / 窄屏抽屉 ----------------
  console.log('\n[7] 首页 · 筛选：宽屏常驻、窄屏才是抽屉');
  const layoutEl = h.doc.querySelector('.layout');
  const asideEl = h.doc.querySelector('.layout > aside');
  const toggleBtn = h.doc.getElementById('filterToggle');
  const sleep = (ms = 60) => new Promise(r => setTimeout(r, ms));

  // 宽屏：空间够，筛选栏必须一直在，且不提供收起
  ok(!!toggleBtn, '工具栏保留「筛选」按钮（窄屏用）');
  ok(h.win.getComputedStyle(asideEl).display !== 'none', '宽屏：筛选栏常驻可见',
    h.win.getComputedStyle(asideEl).display);
  ok(!layoutEl.classList.contains('filters-open'), '宽屏：不带抽屉状态类');
  ok(!!asideEl.querySelector('#filterGroups .fgroup'), '宽屏：筛选项已渲染出来');
  const wideCols = (h.win.getComputedStyle(layoutEl).gridTemplateColumns || '').trim();
  ok(!/^0(px)?\b/.test(wideCols) && wideCols.split(/\s+(?![^(]*\))/).length >= 2,
    '宽屏：第一列不是 0 宽（天梯不会被压没）', wideCols);
  toggleBtn.click();
  await sleep();
  ok(!layoutEl.classList.contains('filters-open'), '宽屏：点「筛选」不会把侧栏收起');
  ok(h.win.getComputedStyle(asideEl).display !== 'none', '宽屏：点完之后依然常驻');

  // CSS 层面的回归防线：不许再把主区塞进 0 宽的列
  const cssText = await (await fetch(BASE + '/assets/css/style.css')).text();
  ok(!/\.layout\s*\{[^}]*grid-template-columns:\s*0\s/.test(cssText),
    'style.css 里不再出现 "0 1fr" 这种会把主区压成 0 宽的写法');
  ok(/\.layout\s*\{[^}]*grid-template-columns:\s*260px/.test(cssText),
    '宽屏首列固定为筛选栏宽度（aside 真的占位）');

  // 窄屏：用假的 matchMedia 模拟 ≤1000px，抽屉行为才生效
  const nw = await open('/index.html', 2500, w => {
    w.matchMedia = q => ({
      media: String(q),
      matches: /max-width:\s*1000px/.test(String(q)),
      onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      dispatchEvent() { return false; }
    });
  });
  const nLayout = nw.doc.querySelector('.layout');
  const nBtn = nw.doc.getElementById('filterToggle');
  ok(!nLayout.classList.contains('filters-open'), '窄屏：默认收起，先给天梯');
  ok(nBtn.getAttribute('aria-expanded') === 'false', '窄屏：aria-expanded 初始为 false');
  nBtn.click();
  await sleep();
  ok(nLayout.classList.contains('filters-open'), '窄屏：点「筛选」拉出抽屉');
  ok(nBtn.getAttribute('aria-expanded') === 'true', '窄屏：展开后 aria-expanded 同步');
  ok(!!nw.doc.getElementById('filterClose'), '窄屏：抽屉内有「收起」按钮');
  nw.doc.getElementById('filterClose').click();
  await sleep();
  ok(!nLayout.classList.contains('filters-open'), '窄屏：点收起按钮可关闭');
  nBtn.click();
  await sleep();
  nw.doc.dispatchEvent(new nw.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep();
  ok(!nLayout.classList.contains('filters-open'), '窄屏：按 Esc 可关闭');

  // 有筛选条件时按钮上要出现计数徽标
  const cb = h.doc.querySelector('#filterGroups input[type=checkbox]');
  cb.checked = true;
  cb.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const badge = h.doc.getElementById('filterBadge');
  ok(!badge.hidden && badge.textContent === '1', '勾选后徽标显示已生效条件数',
    badge.textContent + '/' + badge.hidden);

  // ---------------- 保持率基准线不再压在条形背后 ----------------
  console.log('\n[8] 保持率图 · 基准线不与条形重叠');
  const keepSvgEl = txPane.querySelector('[data-txp=speed] [data-chart=keep] svg');
  const keepLabel = [...keepSvgEl.querySelectorAll('text')].find(t => t.textContent.includes('基准 100%'));
  const firstBar = [...keepSvgEl.querySelectorAll('rect')][0];
  ok(!!keepLabel, '基准标签存在');
  ok(+keepLabel.getAttribute('y') < +firstBar.getAttribute('y'),
    '基准标签位于第一根条形上方（顶部单独留白带）',
    'labelY=' + keepLabel.getAttribute('y') + ' barY=' + firstBar.getAttribute('y'));
  ok(keepSvgEl.lastElementChild.tagName === 'line',
    '基准线最后绘制，压在条形之上而不是藏在背后');

  // ---------------- 说明页：去重 ----------------
  console.log('\n[9] 说明页 · 测试原则与测试平台不再重复');
  const ab = await open('/about.html');
  ok(ab.errs.length === 0, '说明页无 JS 错误', ab.errs[0]);
  const hs = [...ab.doc.querySelectorAll('#content h2')];
  const pHead = hs.find(h => h.textContent.trim() === '测试原则');
  const principleP = pHead && pHead.nextElementSibling;
  ok(!!principleP && principleP.tagName === 'P', '测试原则正文存在');
  ok(!principleP.textContent.includes('测试原则'), '正文里不再重复「测试原则：」标题');
  ok(!/测试平台[一二]/.test(principleP.textContent),
    '正文里不再夹杂「测试平台一/二」表头', principleP.textContent.slice(-30));

  const platHead = hs.find(h => h.textContent.trim() === '测试平台');
  const platTable = platHead && platHead.nextElementSibling;
  ok(!!platTable && platTable.tagName === 'TABLE', '测试平台表格存在');
  const platBodyRows = [...platTable.querySelectorAll('tbody tr')];
  ok(platBodyRows.length === 7, '平台表只有 7 行规格（职责行已移出）', 'rows=' + platBodyRows.length);
  ok(!platTable.textContent.includes('负责'), '表格里不再出现「负责…」那一行');
  ok([...platTable.querySelectorAll('thead th')].map(t => t.textContent.trim()).join(',') === '项目,测试平台一,测试平台二',
    '表头取源表里的平台名');
  const metaJson = await (await fetch(BASE + '/data/meta.json')).json();
  const srcNotes = metaJson.notes || {};
  const scopeNoteEl = platTable.nextElementSibling;
  const scope = srcNotes.platformScope || [];
  ok(scopeNoteEl && scopeNoteEl.classList.contains('mini-note'), '表格下方有脚注');
  ok(!scope.length || scopeNoteEl.textContent.includes(scope[0].slice(0, 6)),
    '脚注取的是源表里的职责行原文（不再用硬编码兜底文案）',
    scopeNoteEl.textContent.slice(0, 40));

  // 说明区块完全由 Excel 驱动，表里增删区块页面要跟着变
  const titles = [...ab.doc.querySelectorAll('#content h2')].map(h => h.textContent.trim());
  const srcTitles = (srcNotes.sections || []).map(s => s.title).filter(Boolean);
  ok(srcTitles.every(t => titles.includes(t)),
    '源表里每个说明区块都渲染出来了', '页面=' + titles.join('/') + ' 源表=' + srcTitles.join('/'));
  ok(!titles.includes('更新记录'), '「更新记录」锚点本身不会被当成正文区块');

  // ---------------- 对比页：按钮对齐 + 雷达图刻度 ----------------
  console.log('\n[10] 对比页 · 操作按钮对齐 / 雷达图刻度');
  const cmp = await open('/compare.html?ids=88,160');
  ok(cmp.errs.length === 0, '对比页无 JS 错误', cmp.errs[0]);
  const firstCol = cmp.doc.querySelector('.cmp-col');
  const btnRow = firstCol.querySelector('.actions');
  ok(!!btnRow, '「详情 / 移除」放在同一个 .actions 容器里');
  const detailBtn = btnRow.querySelector('a.btn');
  const rmBtn = btnRow.querySelector('button.btn');
  const mtA = cmp.win.getComputedStyle(detailBtn).marginTop;
  const mtB = cmp.win.getComputedStyle(rmBtn).marginTop;
  ok(mtA === mtB, '两个按钮的上外边距一致（不再一个高一个低）', mtA + ' vs ' + mtB);
  ok(cmp.win.getComputedStyle(detailBtn).display === cmp.win.getComputedStyle(rmBtn).display,
    '两个按钮的 display 一致',
    cmp.win.getComputedStyle(detailBtn).display + ' vs ' + cmp.win.getComputedStyle(rmBtn).display);
  ok(!/\.cmp-col\s+button\s*\{[^}]*margin-top/.test(cssText),
    '不再用「.cmp-col button」这种只挑 button 的规则加间距');

  const radarSvg = cmp.doc.querySelector('#cRadar svg');
  const rvb = radarSvg.getAttribute('viewBox').split(' ').map(Number);
  const rcx = rvb[2] / 2, rcy = rvb[3] / 2 + 4;
  const floating = [...radarSvg.querySelectorAll('text')].filter(t => {
    const x = +t.getAttribute('x'), y = +t.getAttribute('y');
    // 顶部正中、且内容只有一个数字 —— 就是以前那个孤零零的上限值
    return Math.abs(x - rcx) < 2 && y < rcy - 40 && /^[\d.,]+$/.test(t.textContent.trim());
  });
  ok(floating.length === 0,
    '雷达图不再把坐标轴上限单独画在顶部正中（综合评分下方那个孤零零的数字）',
    floating.map(t => t.textContent).join(','));
  const ticks = [...radarSvg.querySelectorAll('text')]
    .filter(t => t.getAttribute('text-anchor') === 'end' && Math.abs(+t.getAttribute('x') - (rcx - 5)) < 1);
  ok(ticks.length === 4, '改为沿顶部纵轴标出 4 档刻度', 'n=' + ticks.length);
  ok(ticks.every(t => /^[\d.,]+$/.test(t.textContent.trim())),
    '刻度内容是数值', ticks.map(t => t.textContent.trim()).join('/'));

  // ---------------- 详情页：总览排布规则 ----------------
  console.log('\n[11] 详情页 · 总览「条形独占一行 / 柱状两两并列」');
  const dd = await open('/detail.html?id=88');
  ok(dd.errs.length === 0, '详情页无 JS 错误', dd.errs[0]);
  const ovPane = dd.doc.querySelector('[data-pane=overview]');
  ok(ovPane.querySelectorAll('.bench-grid').length === 1,
    '总览只有一个网格（不再嵌套小网格把图缩成一半）',
    'grids=' + ovPane.querySelectorAll('.bench-grid').length);

  const cardTitle = c => c.querySelector('.chart-title').textContent.trim();
  const ovTitles0 = [...ovPane.querySelectorAll('.bench-grid > div')].map(cardTitle);
  ok(ovTitles0.length === 5, '总览固定五张卡', ovTitles0.join(' | '));
  // 用户约定的顺序：评分 → 同总线对比（CDM）→ CDM → AS SSD → TX-Bench
  ok(ovTitles0[0].includes('四项评分'), '第 1 张：四项评分');
  ok(ovTitles0[1].includes('平均水平对比') && ovTitles0[1].includes('CDM'), '第 2 张：同总线对比（CDM）', ovTitles0[1]);
  ok(ovTitles0[2].includes('CrystalDiskMark'), '第 3 张：CrystalDiskMark');
  ok(ovTitles0[3].includes('AS SSD'), '第 4 张：AS SSD');
  ok(ovTitles0[4].includes('稳定性') && ovTitles0[4].includes('TX-Bench'), '第 5 张：TX-Bench 稳定性', ovTitles0[4]);

  // 总览里 AS SSD / CDM 只保留速度数据、用竖向柱状图（所有图表方式都一样）
  const ovCards0 = [...ovPane.querySelectorAll('.bench-grid > div')];
  const bars0 = ovCards0.filter(c => c.querySelector('.chart.is-bar'));
  const cols0 = ovCards0.filter(c => c.querySelector('.chart.is-column'));
  ok(bars0.length === 1, '分项模式总览只有四项评分一张条形图（AS SSD/CDM 已改柱状）', 'n=' + bars0.length);
  ok(cols0.length === 4 && cols0.every(c => !c.classList.contains('span-all')),
    '四张柱状图两两并列成两行（对比+CDM / AS SSD+TX）', 'n=' + cols0.length);
  const cdmCard = ovCards0.find(c => cardTitle(c).includes('CrystalDiskMark'));
  const cdmCats = [...cdmCard.querySelectorAll('svg g, svg text')]
    .map(t => t.textContent).join(' ');
  ok(!/延迟|ms/.test(cdmCats), '总览 CDM 卡不含延迟数据（只有速度）', cdmCats.slice(0, 80));
  const asssdCard = ovCards0.find(c => cardTitle(c).includes('AS SSD'));
  const asssdCats = [...asssdCard.querySelectorAll('svg g, svg text')]
    .map(t => t.textContent).join(' ');
  ok(!/访问延迟/.test(asssdCats), '总览 AS SSD 卡不含访问延迟（只有速度）', asssdCats.slice(0, 80));

  // 切到合并模式：排布不变（这四张柱状图与模式无关，只有坐标轴缩放跟着变）
  dd.doc.querySelector('#modeBar button[data-mode=linear]').click();
  await sleep(300);
  const ovCards1 = [...ovPane.querySelectorAll('.bench-grid > div')];
  const bars1 = ovCards1.filter(c => c.querySelector('.chart.is-bar'));
  const cols1 = ovCards1.filter(c => c.querySelector('.chart.is-column'));
  ok(bars1.length === 1 && bars1[0].classList.contains('span-all'),
    '合并模式下条形图（四项评分）依旧独占一行');
  ok(cols1.length === 4 && cols1.every(c => !c.classList.contains('span-all')),
    '合并模式下四张柱状图仍两两并列', 'n=' + cols1.length);

  // 柱状图画布高度按绘图区宽度走 —— 写死 240 会让宽卡里的柱子变矮胖
  const expectColH = w => {
    const avail = w - (w < 420 ? 52 : 60) - 12;
    return Math.round(Math.max(210, Math.min(330, Math.min(avail, 820) * 0.46)));
  };
  const qSvg = dd.doc.querySelector('[data-pane=cdm] [data-chart=queueDepth] svg');
  const [, , qw, qh] = qSvg.getAttribute('viewBox').split(' ').map(Number);
  ok(Math.abs(qh - expectColH(qw)) <= 1, '柱状图高度随宽度走（不再写死 240）',
    `W=${qw} H=${qh} 期望≈${expectColH(qw)}`);
  // 条形图高度=行数×行高，不该被拉成和柱状图一样高
  const sSvg = dd.doc.querySelector('[data-pane=overview] [data-chart=scores] svg');
  const [, , , sh] = sSvg.getAttribute('viewBox').split(' ').map(Number);
  ok(sh < qh && sh > 100, '条形图按内容高度（比柱状图矮，不会底部留白）', `H=${sh}`);
  ok(!/\.bench-grid[^{]*\.chart[^}]*\{[^}]*height:\s*\d+px/.test(cssText),
    'CSS 不再给图表容器写死固定高度');

  // ---------------- 详情页：真实宽度下的排布（jsdom 里 clientWidth 恒为 0，需要注入桩） ----------------
  console.log('\n[11b] 详情页 · 注入真实宽度后的等高与留白');
  const HALF = 470, FULL = 960;
  // 半幅卡片 470px，整行卡片 960px；判定方式与 CSS 的两列网格一致
  const stubWidth = w => Object.defineProperty(w.Element.prototype, 'clientWidth', {
    configurable: true,
    get() {
      if (!this.classList || !this.classList.contains('chart')) return 0;
      const card = this.parentElement, grid = card && card.parentElement;
      const twoCols = grid && grid.classList && grid.classList.contains('bench-grid');
      return twoCols && !card.classList.contains('span-all') ? HALF : FULL;
    }
  });
  const wide = await open('/detail.html?id=88&mode=linear', 2500, stubWidth);
  ok(wide.errs.length === 0, '注入宽度后无 JS 错误', wide.errs[0]);
  const wideCards = [...wide.doc.querySelectorAll('[data-pane=overview] .bench-grid > div')];
  const axisW = c => {
    const svg = c.querySelector('svg');
    const line = [...svg.querySelectorAll('line')].find(l => l.getAttribute('stroke') === '#cdd4dd');
    return line ? +line.getAttribute('x2') - +line.getAttribute('x1') : 0;
  };
  const pairA = wideCards[1], pairB = wideCards[2];
  const hap = h => +h.querySelector('svg').getAttribute('viewBox').split(' ')[3];
  ok(hap(pairA) === hap(pairB),
    '同一行两张柱状图画布等高 → 渲染出来自然对齐', hap(pairA) + ' vs ' + hap(pairB));
  ok(Math.abs(hap(pairA) - expectColH(HALF)) <= 1,
    '半幅柱状图高度 = 半幅画布的推导值', `${hap(pairA)} vs ${expectColH(HALF)}`);
  // 落单的柱状图：TX 速度页的「读写拆分」左边是条形图（保持率），没有柱状邻居 → 占整行
  const lone = wide.doc.querySelector('[data-txp=speed] [data-chart=rw]').parentElement;
  ok(lone.classList.contains('span-all'), '落单的柱状图占整行');
  ok(axisW(lone) <= 820 + 1,
    '整行的柱状图绘图区有宽度上限，柱子不会被撑得很「肥」', 'plotW=' + axisW(lone));
  ok(axisW(lone) > axisW(pairA), '整行卡片确实比半幅卡片更宽');

  // ---------------- 详情页：对比组口径 ----------------
  console.log('\n[12] 详情页 · 「平均水平」对比组口径真实');
  const meta = await (await fetch(BASE + '/data/index.json')).json();
  const m2 = await open('/detail.html?id=207');       // M.2 2280 PCIe 4.0 X4：同接口样本充足
  const m2Card = m2.doc.querySelector('[data-pane=overview] [data-chart=peer]');
  ok(!!m2Card, '同接口样本充足时渲染对比卡片');
  const m2Wrap = m2Card.parentElement;
  const m2Title = cardTitle(m2Wrap), m2Sub = m2Wrap.querySelector('.chart-sub').textContent;
  const m2N = meta.filter(r => r.interface === 'M.2 2280 PCIe 4.0 X4').length - 1;
  ok(m2Title.includes('同接口盘'), '标题写「同接口盘」', m2Title);
  ok(m2Sub.includes(`共 ${m2N} 款`) && m2Sub.includes('M.2 2280 PCIe 4.0 X4'),
    '对比组数量与口径一致', m2Sub);
  ok(!/放宽/.test(m2Sub), '未放宽时不显示放宽说明');

  const u2 = await open('/detail.html?id=75');         // U.2 PCIe 4.0 X4：同接口只剩 2 款
  const u2Card = u2.doc.querySelector('[data-pane=overview] [data-chart=peer]');
  const u2Wrap = u2Card.parentElement;
  const u2Title = cardTitle(u2Wrap), u2Sub = u2Wrap.querySelector('.chart-sub').textContent;
  const nvN = meta.filter(r => r.bus === 'NVMe').length - 1;
  ok(u2Title.includes('同总线盘') && !u2Title.includes('同接口盘'),
    '同接口不足 3 款时标题改为「同总线盘」', u2Title);
  ok(!u2Sub.includes('U.2 PCIe 4.0 X4 共'), '副标题不再写「U.2 … 共 183 款」这种错话', u2Sub);
  ok(u2Sub.includes(`共 ${nvN} 款`) && u2Sub.includes('NVMe'),
    '放宽后按 NVMe 总线的真实样本数计数', u2Sub);
  ok(u2Sub.includes('已放宽到') && u2Sub.includes('样本不足'),
    '把放宽的原因写出来', u2Sub);

  console.log('\n' + (fail ? fail + ' 项未通过 / ' : '') + pass + ' 项通过');
  process.exit(fail ? 1 : 0);
})();
