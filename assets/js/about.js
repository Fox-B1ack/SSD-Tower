/* ============================================================
   about.js — 测试方法 / 评分口径 / 更新日志
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  UI.renderHeader('about');
  let meta;
  try { meta = await DB.meta(); }
  catch (e) {
    document.getElementById('content').innerHTML =
      '<div class="empty"><h3>加载失败</h3><p>' + UI.esc(e.message) + '</p></div>';
    return;
  }
  const notes = meta.notes || {};

  // 表头用源表里的平台名（"测试平台一 / 测试平台二"），取不到才退回默认值
  const platNames = (notes.platformNames && notes.platformNames.length === 2)
    ? notes.platformNames : ['平台一', '平台二'];

  const platformRows = (notes.platforms || []).map(p => {
    // 每行形如 [标签, 平台一值, 标签, 平台二值]
    return `<tr><th>${UI.esc(p[0] || '')}</th><td>${UI.esc(p[1] || '')}</td><td>${UI.esc(p[3] || '')}</td></tr>`;
  }).join('');

  // 说明性区块（测试原则、TX-Bench 参数说明…）全部来自 Excel 的「更新日志与说明」表，
  // 顺序跟着表里走，标题已在源数据里，这里不再手写。
  const sectionsHtml = (notes.sections || []).map(s => `
    ${s.title ? `<h2>${UI.esc(s.title)}</h2>` : ''}
    ${s.lines.map(l => `<p>${UI.esc(l)}</p>`).join('')}
  `).join('');

  // 职责范围放在表格下方当脚注，不再占一行表格（否则和脚注内容重复）
  const scopeNote = (notes.platformScope && notes.platformScope.length === 2)
    ? `${UI.esc(notes.platformScope[0])}；${UI.esc(notes.platformScope[1])}。`
    : '测试平台一已荒废，除非出现SATA ExPress，否则移交测试平台二。';

  const changelog = (notes.changelog || []).slice().reverse().map(c =>
    `<tr><th style="width:110px">${UI.esc(c.date)}</th><td>${UI.esc(c.text).replace(/\n/g, '<br>')}</td></tr>`
  ).join('');

  document.getElementById('content').innerHTML = `
    <h1 style="margin:0 0 6px;font-size:22px">测试方法与其他说明</h1>
    <p style="color:var(--muted);font-size:13px;margin:0 0 18px">
      数据库共收录 <b>${meta.count}</b> 款硬盘 · 最后更新 ${UI.esc(meta.generatedAt)}
    </p>

    ${sectionsHtml}

    <h2>测试平台</h2>
    <table><thead><tr><th>项目</th><th>${UI.esc(platNames[0])}</th><th>${UI.esc(platNames[1])}</th></tr></thead>
      <tbody>${platformRows}</tbody></table>
    <p class="mini-note">${scopeNote}</p>

    <h2>测试项目</h2>
    <table>
      <thead><tr><th>软件</th><th>设置</th><th>说明</th></tr></thead>
      <tbody>
        <tr><th>AS SSD Benchmark</th><td>5 GB</td><td>顺序、4K 随机、4K-64Thrd 与访问延迟。4K 单项受 CPU 影响较大，不计入综合评分。</td></tr>
        <tr><th>CrystalDiskMark</th><td>16 GiB × 3 次</td><td>Q8T1 / Q64T1 / Q8T8 三种队列与线程组合下的顺序与 4K 随机吞吐。</td></tr>
        <tr><th>TX-Bench</th><td>空盘 / 85% 满盘</td><td>六种混合读写负载的传输速度与响应延迟，用来观察缓外写入与满盘衰减。</td></tr>
      </tbody>
    </table>

    <h2>四项评分的含义</h2>
    <table>
      <thead><tr><th>评分</th><th>含义</th></tr></thead>
      <tbody>
        ${SCORE_DEFS.map(s => `<tr><th>${s.label}</th><td>${s.desc}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="mini-note">所有评分均以基准盘 = 1.000 做归一化，数值越高越好。天梯榜默认按<b>综合评分</b>排序。</p>

    <h2>使用说明</h2>
    <ul>
      <li><b>筛选</b>：宽屏下筛选栏常驻页面左侧，直接勾选即可；窄屏（窗口宽度 ≤1000px）空间不够时才收起，点工具栏左侧的「筛选」把它从左侧拉出来，按 Esc、点遮罩或「收起 ✕」关闭。可按品牌、定位、总线、PCIe 代际、接口形态、容量、颗粒类型、主控品牌组合筛选，按钮上的数字是当前生效的条件数。</li>
      <li><b>搜索</b>：顶部搜索框支持型号、代号/料号、主控、颗粒关键词，多个词用空格分隔表示"同时包含"。</li>
      <li><b>对比</b>：在列表或天梯图里勾选硬盘（最多 6 款），点击底部"开始对比"进入对比页。</li>
      <li><b>对比页</b>会给出评分雷达图、实测分组柱状图、逐项明细表，并自动标出每一行的最优值。</li>
    </ul>

    <h2>更新日志</h2>
    <table><tbody>${changelog || '<tr><td>暂无</td></tr>'}</tbody></table>
  `;
}
