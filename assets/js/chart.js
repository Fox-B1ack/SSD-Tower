/* ============================================================
   chart.js — 零依赖 SVG 图表（横向条形 / 分组柱状 / 雷达）
   全部为浅色主题，随容器宽度自适应。
   ============================================================ */

const PALETTE = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#db2777', '#ea580c'];

/** 取容器的真实像素宽度当画布宽度。
 *  这样 SVG 是 1:1 渲染，不会被 CSS 拉伸/压扁，字号才是设计时的样子；
 *  以前写死 640/940，宽卡里的图被放大、窄卡里的图被缩到字都看不清。
 *  容器不可见时（藏在未激活的页签里）clientWidth 为 0，退回默认宽度。 */
function hostWidth(host, fallback) {
  const w = host && host.clientWidth ? Math.round(host.clientWidth) : 0;
  return w > 240 ? Math.min(w, 1600) : fallback;
}

const Chart = {
  color(i) { return PALETTE[i % PALETTE.length]; },
  /** 横向条形图
   *  opts: {items:[{label, sub, value, display, color}], max, barColor}
   */
  hbar(host, opts) {
    const items = opts.items || [];
    const W = opts.width || hostWidth(host, 640), rowH = opts.rowH || 26, gap = 6;
    // 标签与数值的字号跟着容器宽度走：宽卡里 12.5/13，窄卡里收到 11.5/11，别再写死
    const fs = opts.labelFontSize || (W >= 620 ? 12.5 : 11.5);
    const vfs = opts.valueFontSize || (W >= 620 ? 13 : W >= 420 ? 12 : 11);
    const padR = opts.padR || Math.round(vfs * 5.2);
    // 左侧标签区按最长标签自动留宽（TX-Bench 场景名改中文后会变长），
    // 上限 240 防止把条形区挤没了，放不下的部分用省略号 + 悬停全文
    const padL = opts.padL || Math.min(240, Math.max(96, maxTextWidth(items.map(i => i.label || ''), fs) + 14));
    // 有基准线标签时，顶部单独留出一条 15px 的空白带放文字，
    // 否则文字会压在第一根条形背后、看起来像叠了一层
    const refTop = (opts.reference != null && opts.referenceLabel) ? 15 : 0;
    const H = items.length * (rowH + gap) + 8 + refTop;
    const max = opts.max || Math.max(...items.map(i => i.value || 0), 1);
    const fmt = opts.format || (v => Fmt.auto(v));

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMinYMin meet">`;
    let refLine = '';

    // 参考基准线（如"保持率 100%"）：标签画在顶部空白带，线最后画在条形之上
    if (opts.reference != null) {
      const rx = padL + (Math.min(opts.reference, max) / max) * (W - padL - padR);
      if (opts.referenceLabel) {
        const lw = textWidth(opts.referenceLabel, 9.5);
        const right = rx + 4 + lw > W - 4;
        svg += `<text x="${(right ? rx - 4 : rx + 4).toFixed(1)}" y="${(refTop - 3).toFixed(1)}"
                  text-anchor="${right ? 'end' : 'start'}" font-size="9.5" fill="#475569"
                  paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"
                >${UI.esc(opts.referenceLabel)}</text>`;
      }
      refLine = `<line x1="${rx.toFixed(1)}" y1="${refTop + 2}" x2="${rx.toFixed(1)}" y2="${H - 4}"
                  stroke="#475569" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.85"/>`;
    }

    items.forEach((it, i) => {
      const y = 4 + refTop + i * (rowH + gap);
      const w = Math.max(1, ((it.value || 0) / max) * (W - padL - padR));
      const col = it.color || opts.barColor || '#2563eb';
      const full = String(it.label || '');
      const shown = ellipsis(full, fs, padL - 14);
      const tip = UI.esc(it.sub ? full + ' — ' + it.sub : full);
      svg += `<text x="${padL - 8}" y="${y + rowH / 2 + 4}" text-anchor="end"
                font-size="${fs}" fill="#4b5563">${UI.esc(shown)}<title>${tip}</title></text>`;
      svg += `<rect x="${padL}" y="${y + 3}" width="${W - padL - padR}" height="${rowH - 8}"
                rx="3" fill="#f1f3f7"/>`;
      svg += `<rect x="${padL}" y="${y + 3}" width="${w}" height="${rowH - 8}" rx="3" fill="${col}"/>`;
      svg += `<text x="${W - padR + 8}" y="${y + rowH / 2 + 4}" font-size="${vfs}"
                font-weight="700" fill="#1b2027">${UI.esc(it.display != null ? it.display : fmt(it.value))}</text>`;
    });
    svg += refLine;
    svg += '</svg>';
    host.innerHTML = svg;
  },

  /** 分组柱状图
   *  opts: {
   *    categories:[...], series:[{name, values:[...], color}],
   *    unit, height, valueFormat, logScale
   *  }
   *  x 轴标签会根据可用宽度自动缩放字号，放不下时自动倾斜，避免重叠。
   */
  groupBar(host, opts) {
    const cats = opts.categories || [];
    const series = opts.series || [];
    const n = cats.length;
    if (!n || !series.length) { host.innerHTML = '<div class="empty">暂无数据</div>'; return; }

    const W = opts.width || hostWidth(host, Math.max(560, Math.min(1100, n * 86 + 90)));
    const padL = opts.padL || (W < 420 ? 52 : 60), padR = 12;
    const availW = W - padL - padR;
    const plotW = Math.min(availW, opts.maxPlotW || 820);
    const x0 = padL + (availW - plotW) / 2;
    const groupW = plotW / n;
    const barW = Math.max(4, (groupW - 10) / series.length);
    const fmt = opts.valueFormat || (v => Fmt.auto(v));

    // 数值 / 类目标签字号随画布宽度缩放：宽页里整张图被放大，字也得跟着放大，
    // 否则宽屏下标签显得小而糊、且"不随页面大小变化"。上限仍由各自槽位宽度约束
    // （柱宽 / 类目宽），不会溢出柱子或挤到相邻类目。
    const valFsBase = Math.max(9, Math.min(15, W * 0.0135));
    const catFsBase = Math.max(9, Math.min(14, W * 0.013));
    // 数据标签：窄屏下柱再细也「尽可能保留」标签（可读下限从 8 降到 6.5）；
    // 但柱宽一旦低于 VBAR_MINW，整张图就「统一隐藏」标签，绝不出现"一半有字一半没字"。
    // 同一张图里 barW 是统一的，所以要么全画、要么全不画，视觉上始终一致。
    const VBAR_FLOOR = 6.5;
    const VBAR_MINW = 8;

    // ---- x 轴标签：先算字号，再决定要不要倾斜
    let fs = catFsBase;
    cats.forEach(c => { fs = Math.min(fs, fitFontSize(String(c), groupW - 6, catFsBase, 8)); });
    const rotate = fs <= 8.6;                    // 缩到最小还放不下 → 倾斜
    const padB = rotate ? 16 + maxTextWidth(cats, fs) * 0.72 : 30;
    const fs2 = rotate ? Math.min(catFsBase, fitFontSize(longest(cats), padB / 0.72, catFsBase, 8)) : fs;

    // 数据标签一律画在柱顶正上方；先按最宽的一个标签预留顶部留白带，
    // 这样即使最高的柱子顶到绘图区顶端，它的标签也有地方放、不会被塞进柱内。
    // 彻底避免「标签在柱外 / 在柱内」混用、看起来不统一的问题。
    let labelBand = 12;
    if (opts.showValues !== false) {
      let mx = VBAR_FLOOR;
      cats.forEach((c, ci) => {
        series.forEach(s => {
          const v = s.values[ci];
          if (v != null && barW >= VBAR_MINW) {
            mx = Math.max(mx, Math.min(valFsBase, fitFontSize(String(fmt(v)), barW - 3, 16, VBAR_FLOOR)));
          }
        });
      });
      labelBand = Math.max(12, Math.ceil(mx) + 4);
    }
    const padT = labelBand;

    // 画布高度跟着绘图区宽度走：同一行两张卡片等宽 → 画布等宽 → 等高 → 渲染出来天然对齐。
    const H = opts.height || Math.round(Math.max(210, Math.min(330, plotW * 0.46)));
    const plotH = H - padT - padB;

    // ---- 量纲：线性 or 对数
    const log = !!opts.logScale;
    const tf = log ? (v => Math.log10(Math.max(0, v) + 1)) : (v => v);
    const all = [];
    series.forEach(s => s.values.forEach(v => { if (v != null && !isNaN(v)) all.push(v); }));
    let max = Math.max(...all, 0);
    if (max <= 0) max = 1;
    max = log ? tf(max) : niceCeil(max);

    // 纵轴刻度字号也随画布走，窄图不至于把 y 轴数字挤到边上
    const tickFs = W < 420 ? 9.5 : 10.5;

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;

    // y 轴网格：对数轴按 10 的幂取刻度
    // 对数轴的刻度是 0/1/10/100…，用整数格式才不会出现 "1.00 / 10.0" 这种混排
    const tickFmt = log ? (v => (v === 0 ? '0' : Fmt.n(v, 0))) : fmt;
    const tickVals = log ? logTicks(max) : Array.from({ length: 6 }, (_, i) => max * i / 5);
    tickVals.forEach(v => {
      const t = log ? tf(v) : v;
      const y = padT + plotH - (plotH * t / max);
      svg += `<line x1="${x0.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x0 + plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eceff4"/>`;
      svg += `<text x="${(x0 - 6).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end"
                font-size="${tickFs}" fill="#7b8794">${UI.esc(tickFmt(v))}</text>`;
    });

    cats.forEach((c, ci) => {
      const gx = x0 + ci * groupW + 5;
      series.forEach((s, si) => {
        const v = s.values[ci];
        const t = (v == null || isNaN(v)) ? null : tf(v);
        const h = t == null ? 0 : Math.max(1, (t / max) * plotH);
        const x = gx + si * barW;
        const y = padT + plotH - h;
        const col = s.color || Chart.color(si);
        svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
                  rx="2" fill="${col}"><title>${UI.esc(s.name + ' · ' + c + ': ' + fmt(v))}</title></rect>`;
        // 数据标签：字号随柱宽自适应，下限 VBAR_FLOOR；一律画在柱顶正上方。
        // 柱宽低于 VBAR_MINW 时整张图不画标签（统一隐藏，绝不残缺）。
        if (opts.showValues !== false && v != null) {
          const txt = fmt(v);
          const vfs = Math.min(valFsBase, fitFontSize(String(txt), barW - 3, 16, VBAR_FLOOR));
          if (vfs >= VBAR_FLOOR && barW >= VBAR_MINW) {
            svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}"
                      text-anchor="middle" font-size="${vfs.toFixed(1)}" fill="#4b5563"
                    >${UI.esc(txt)}</text>`;
          }
        }
      });

      const cx = x0 + ci * groupW + groupW / 2;
      const full = String(c);
      const txt = rotate ? full : ellipsis(full, fs, groupW - 6);
      if (rotate) {
        svg += `<text transform="translate(${cx.toFixed(1)},${(padT + plotH + 8).toFixed(1)}) rotate(-38)"
                  text-anchor="end" font-size="${fs2.toFixed(1)}" fill="#4b5563">${UI.esc(txt)}</text>`;
      } else {
        // 只有被截断时才挂 title，否则会把文本重复一遍
        const tip = txt === full ? '' : `<title>${UI.esc(full)}</title>`;
        svg += `<text x="${cx.toFixed(1)}" y="${(padT + plotH + 15).toFixed(1)}" text-anchor="middle"
                  font-size="${fs.toFixed(1)}" fill="#4b5563">${UI.esc(txt)}${tip}</text>`;
      }
    });

    svg += `<line x1="${x0.toFixed(1)}" y1="${padT + plotH}" x2="${(x0 + plotW).toFixed(1)}" y2="${padT + plotH}" stroke="#cdd4dd"/>`;
    svg += '</svg>';

    let html = svg;
    if (log) html = '<p class="chart-sub">纵轴为对数刻度，用于同时呈现量级差异很大的项目</p>' + html;
    if (opts.legend !== false) {
      html += `<div class="legend">${series.map((s, i) =>
        `<span><i style="background:${s.color || Chart.color(i)}"></i>${UI.esc(s.name)}</span>`).join('')}</div>`;
    }
    host.innerHTML = html;
  },

  /** 分项横向条形图（对比页主力图表）
   *
   *  每个"指标"独占一行，行内按硬盘画多条横向条，
   *  **每行独立归一化**：顺序读写几千 MB/s 与 4K 随机几十 MB/s 不会被压平，
   *  延迟（越低越好）单独成组，绝不与速度混在一张图里。
   *
   *  opts: { groups: [ {title, unit, better:'high'|'low', note,
   *                     rows: [ {label, items:[{name, value, color}]} ] } ] }
   */
  multiHBar(host, opts) {
    const groups = opts.groups || [];
    if (!groups.length) { host.innerHTML = '<div class="empty">暂无数据</div>'; return; }

    const W = opts.width || hostWidth(host, 940);
    // 各列的横向位置按画布宽度算，窄容器里条形区不会被挤没
    const nameX = 8;
    const nameW = Math.max(118, Math.min(200, Math.round(W * 0.16)));
    const barX = nameX + nameW + 8;
    const valW = 108;                       // 右侧数值区
    const barW = Math.max(120, W - barX - valW);
    const valX = barX + barW + 12;
    const barH = 15, barGap = 5, rowHeadH = 19, rowPad = 5, groupHeadH = 26, groupGap = 10;
    // 字号随画布宽度微幅缩放，宽容器里不再显得小而糊
    const k = W >= 880 ? 1.12 : W >= 560 ? 1 : 0.92;
    const fsHead = Math.round(13 * k * 10) / 10;
    const fsName = Math.round(11 * k * 10) / 10, fsRow = Math.round(11.5 * k * 10) / 10;
    const fsVal = Math.round(11 * k * 10) / 10;

    let H = 0;
    groups.forEach(g => {
      H += groupHeadH + groupGap;
      (g.rows || []).forEach(row => {
        H += rowHeadH + (row.items.length * (barH + barGap)) + rowPad;
      });
    });

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">`;
    let y = 0;

    groups.forEach(g => {
      const arrow = g.better === 'low'
        ? '<tspan fill="#0369a1" font-weight="700">↓ 越低越好</tspan>'
        : '<tspan fill="#15803d" font-weight="700">↑ 越高越好</tspan>';
      svg += `<text x="${nameX}" y="${y + 16}" font-size="${fsHead}" font-weight="700" fill="#1b2027">
                ${UI.esc(g.title)} <tspan font-weight="400" fill="#7b8794">（${UI.esc(g.unit || '')}）</tspan>
                ${arrow}</text>`;
      y += groupHeadH;
      if (g.note) {
        svg += `<text x="${nameX}" y="${y + 2}" font-size="10" fill="#7b8794">${UI.esc(g.note)}</text>`;
        y += 12;
      }

      (g.rows || []).forEach(row => {
        const items = row.items || [];
        // 每行独立取最大值做归一化 —— 这是解决量级差异的关键
        const vals = items.map(i => (i.value == null || isNaN(i.value)) ? null : Math.abs(i.value));
        const rowMax = Math.max(...vals.filter(v => v != null), 0) || 1;

        const rowTip = UI.esc(row.tip || row.label);
        svg += `<text x="${nameX}" y="${y + 13}" font-size="${fsRow}" font-weight="600" fill="#4b5563">
                  ${UI.esc(row.label)}<title>${rowTip}</title></text>`;
        y += rowHeadH;

        items.forEach(it => {
          const v = (it.value == null || isNaN(it.value)) ? null : Math.abs(it.value);
          const w = v == null ? 0 : Math.max(1.5, (v / rowMax) * barW);
          const col = it.color || '#2563eb';
          const isBest = v != null && g.better === 'low'
            ? v === Math.min(...vals.filter(x => x != null))
            : v === Math.max(...vals.filter(x => x != null));

          svg += `<rect x="${nameX + 8}" y="${y + 1}" width="${barW}" height="${barH - 2}" rx="2" fill="#f1f3f7"/>`;
          svg += `<rect x="${nameX + 8}" y="${y + 1}" width="${w.toFixed(1)}" height="${barH - 2}" rx="2"
                    fill="${col}" fill-opacity="${isBest ? 1 : 0.82}"/>`;
          svg += `<text x="${nameX + 10}" y="${y + barH - 3.5}" font-size="${fsName}"
                    fill="${isBest ? '#0f172a' : '#334155'}" font-weight="${isBest ? 700 : 400}"
                    style="paint-order:stroke;stroke:#fff;stroke-width:2.6px">${UI.esc(ellipsis(it.name, fsName, nameW - 16))}
                    <title>${UI.esc(it.name)}</title></text>`;
          svg += `<text x="${valX}" y="${y + barH - 3.5}" font-size="${fsVal}"
                    font-weight="${isBest ? 700 : 500}" fill="${isBest ? '#1d4ed8' : '#4b5563'}"
                    >${UI.esc(it.display != null ? it.display : Fmt.auto(it.value))}${isBest ? ' ★' : ''}</text>`;
          y += barH + barGap;
        });
        y += rowPad;
      });
      y += groupGap;
    });

    svg += '</svg>';
    host.innerHTML = svg;
  },

  /** 雷达图
   *  opts: {axes:[...], series:[{name, values:[...], color}], max}
   */
  radar(host, opts) {
    const axes = opts.axes || [];
    const series = opts.series || [];
    const n = axes.length;
    if (n < 3) { host.innerHTML = '<div class="empty">至少需要 3 个维度</div>'; return; }

    // 画布宽度跟着容器走，SVG 按 1:1 渲染，文字不会被 CSS 拉伸变大或缩小
    const W = opts.width || Math.max(340, Math.min(620, hostWidth(host, 440)));
    const H = opts.height || 340;
    const cx = W / 2, cy = H / 2 + 4;
    // 半径按可用空间算，宽容器里也能撑满而不留一整圈空白
    const R = Math.max(64, Math.min(126, Math.min(W / 2 - 66, H / 2 - 26)));
    let max = opts.max || Math.max(...series.flatMap(s => s.values.filter(v => v != null)), 1);
    max = niceCeil(max);

    const ang = i => (Math.PI * 2 * i / n) - Math.PI / 2;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];

    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
    // 网格
    for (let lvl = 1; lvl <= 4; lvl++) {
      const r = R * lvl / 4;
      const d = axes.map((_, i) => pt(i, r).map(v => v.toFixed(1)).join(',')).join(' ');
      svg += `<polygon points="${d}" fill="${lvl === 4 ? '#fafbfc' : 'none'}" stroke="#e6eaf0" stroke-width="1"/>`;
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R);
      svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e6eaf0"/>`;
    }
    // 刻度：标在正上方那根轴的左侧。
    // 以前是把上限值单独画在顶部正中，而正上方恰好是第一个轴的标签
    //（综合评分），看上去就像标签下面莫名多了个数字，这里改成本刻度线解。
    for (let lvl = 1; lvl <= 4; lvl++) {
      const r = R * lvl / 4;
      svg += `<text x="${(cx - 5).toFixed(1)}" y="${(cy - r + 3).toFixed(1)}" text-anchor="end"
                font-size="8.5" fill="#94a3b8"
                style="paint-order:stroke;stroke:#fff;stroke-width:2.5px;stroke-linejoin:round"
              >${UI.esc(Fmt.auto(max * lvl / 4))}</text>`;
    }
    // 轴标签
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R + 20);
      const anchor = Math.abs(x - cx) < 6 ? 'middle' : (x > cx ? 'start' : 'end');
      svg += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}"
                font-size="10.5" fill="#4b5563">${UI.esc(axes[i])}</text>`;
    }

    series.forEach((s, si) => {
      const col = s.color || Chart.color(si);
      const pts = s.values.map((v, i) => {
        const r = (v == null || isNaN(v)) ? 0 : Math.min(1, v / max) * R;
        return pt(i, r).map(x => x.toFixed(1)).join(',');
      }).join(' ');
      svg += `<polygon points="${pts}" fill="${col}" fill-opacity="0.13" stroke="${col}" stroke-width="2"/>`;
      s.values.forEach((v, i) => {
        const r = (v == null || isNaN(v)) ? 0 : Math.min(1, v / max) * R;
        const [x, y] = pt(i, r);
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${col}"><title>${UI.esc(s.name + ' · ' + axes[i] + ': ' + (v == null ? '—' : v.toFixed(3)))}</title></circle>`;
      });
    });
    svg += '</svg>';

    let html = svg;
    if (opts.legend !== false) {
      html += `<div class="legend">${series.map((s, i) =>
        `<span><i style="background:${s.color || Chart.color(i)}"></i>${UI.esc(s.name)}</span>`).join('')}</div>`;
    }
    host.innerHTML = html;
  }
};

function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

function shortLabel(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ---------------- 文本度量（无 DOM，按字宽估算） ---------------- */
/* CJK 近似 1 个字宽，ASCII 近似 0.55 个字宽 */

function textWidth(s, fs) {
  let u = 0;
  for (const ch of String(s)) u += (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55);
  return u * fs;
}

function maxTextWidth(list, fs) {
  return Math.max(...list.map(s => textWidth(s, fs)), 0);
}

function longest(list) {
  return list.reduce((a, b) => (textWidth(b, 10) > textWidth(a, 10) ? b : a), '');
}

/** 在 [min,max] 里找一个能让文本放进 maxW 的字号 */
function fitFontSize(s, maxW, max, min) {
  let fs = max;
  while (fs > min && textWidth(s, fs) > maxW) fs -= 0.25;
  return fs;
}

/** 按给定字号把文本截断到 maxW 宽度内 */
function ellipsis(s, fs, maxW) {
  s = String(s);
  if (textWidth(s, fs) <= maxW) return s;
  let out = '';
  let w = 0;
  const limit = maxW - textWidth('…', fs);
  for (const ch of s) {
    const cw = textWidth(ch, fs);
    if (w + cw > limit) break;
    out += ch; w += cw;
  }
  return out + '…';
}

/** 对数轴的刻度值：1, 10, 100, 1000 …（外加 0） */
function logTicks(maxT) {
  const out = [0];
  for (let p = 0; p <= 8; p++) {
    const v = Math.pow(10, p);
    if (Math.log10(v + 1) <= maxT) out.push(v);
  }
  if (out.length < 3) out.push(1);
  return out;
}
