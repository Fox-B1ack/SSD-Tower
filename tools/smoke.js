/**
 * 冒烟测试：用 jsdom 加载各页面，捕获 JS 运行时错误，
 * 并断言关键 DOM 是否已渲染出来。
 *   用法: node tools/smoke.js http://127.0.0.1:8899
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8899';
const pages = [
  { url: '/index.html', name: '首页', checks: ['#filterGroups .fgroup', '.lrow', '#countNum'] },
  { url: '/detail.html?id=88', name: '详情页', checks: ['.dhead h1', '.scorecards .scard', '.tabpane', '[data-pane=overview] [data-chart=scores] svg'] },
  { url: '/compare.html?ids=88,160,206,249', name: '对比页', checks: ['#cRadar svg', '#cOverall svg', '#cBench svg', '#specTable tbody tr', '#benchTable tbody tr'] },
  { url: '/about.html', name: '说明页', checks: ['#content h2', '#content table'] },
  { url: '/index.html?q=sn850x', name: '首页·搜索', checks: ['.lrow'] },
  { url: '/index.html?q=pm9a1', name: '首页·搜索(大小写)', checks: ['.lrow'] },
  { url: '/index.html?q=zzzzzz', name: '首页·空结果', checks: ['.empty'] },
  { url: '/detail.html?id=64', name: '详情页·缺失数据', checks: ['.dhead h1', '[data-pane=overview] [data-chart=scores] svg', '[data-pane=raw] tbody tr'] },
  { url: '/detail.html?id=113', name: '详情页·SATA', checks: ['.dhead h1', '[data-pane=overview] [data-chart=steady] svg'] },
  { url: '/compare.html?ids=64,113', name: '对比页·缺失数据', checks: ['#cRadar svg', '#specTable tbody tr'] }
];

(async () => {
  let failed = 0;
  for (const p of pages) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push(e.message + '\n' + (e.stack || '')));
    vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

    const dom = await JSDOM.fromURL(BASE + p.url, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(window) {
        // jsdom 不实现 fetch，这里用 Node 的 fetch 代理到站点
        window.fetch = (input, init) => {
          const u = new URL(String(input), BASE + '/').href;
          return fetch(u, init);
        };
      }
    });
    // 等待数据加载 + 渲染
    await new Promise(r => setTimeout(r, 2500));
    const doc = dom.window.document;

    const results = p.checks.map(sel => {
      const n = doc.querySelectorAll(sel).length;
      return { sel, n, ok: n > 0 };
    });
    const ok = results.every(r => r.ok) && errors.length === 0;
    if (!ok) failed++;

    console.log((ok ? '  PASS  ' : '  FAIL  ') + p.name + '  (' + p.url + ')');
    results.forEach(r => console.log('        ' + (r.ok ? '✓' : '✗') + ' ' + r.sel + ' × ' + r.n));
    errors.slice(0, 3).forEach(e => console.log('        ! ' + e.split('\n')[0]));
    if (!ok && errors.length) console.log('        ' + errors[0].split('\n').slice(0, 6).join('\n        '));
    dom.window.close();
  }
  console.log(failed ? '\n' + failed + ' 个页面未通过' : '\n全部页面通过');
  process.exit(failed ? 1 : 0);
})();
