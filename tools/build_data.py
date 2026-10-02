# -*- coding: utf-8 -*-
"""
SSD 数据库构建脚本
==================
把 `SSD test data.xlsx` 转换成静态网站使用的 JSON 数据。

用法:
    python tools/build_data.py [Excel路径] [--out 站点目录]

产物:
    data/meta.json        元信息（生成时间、条目数、测试平台说明）
    data/index.json       列表索引（用于首页筛选/搜索/排序，不含完整跑分）
    data/ssd/<id>.json    单盘完整数据（详情页/对比页按需加载）

设计说明:
    数据被拆成"索引 + 分片"，而不是一个完整的 data.json，
    这样站点不会对外暴露一个可一次性拖走的全量数据文件。
"""

import json
import os
import re
import sys
import datetime

try:
    import openpyxl
except ImportError:
    sys.exit("需要 openpyxl:  pip install openpyxl")

# ---------------------------------------------------------------- 路径

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = PROJECT

# 默认直接读取 OneDrive 里的源表；如果找不到，退回项目内的副本
_ONEDRIVE = os.path.join(os.path.expanduser("~"), "OneDrive", "SSD test data.xlsx")
# 注意：源表副本刻意放在站点目录之外，避免被一起部署出去
_LOCAL = os.path.join(os.path.dirname(PROJECT), "data", "ssd_source.xlsx")
DEFAULT_XLSX = _ONEDRIVE if os.path.exists(_ONEDRIVE) else _LOCAL

# ---------------------------------------------------------------- 列定义

SHEET_DETAIL = "SSD详细性能对比 (新版）"
SHEET_LADDER = "简陋版天梯（不是最终的可视化天梯！）"
SHEET_NOTES = "更新日志与说明"

# 说明性区块的标题行形如「测试原则：」「TX-Bench 参数说明：」
TITLE_RE = re.compile(r"^[^：:]{2,24}[：:]$")

DATA_START_ROW = 5          # 详细表第 5 行起为数据
LADDER_START_ROW = 5

C_BRAND, C_MODEL, C_PN, C_CAP, C_PHOTO = 0, 1, 2, 3, 4
C_TIER, C_CTRL, C_NAND, C_DRAM, C_IFACE = 5, 6, 7, 8, 9
C_SPEC = (10, 11, 12, 13)   # 顺序读 / 顺序写 / 4K读IOPS / 4K写IOPS
C_ASSSD = range(14, 22)
C_CDM = range(22, 30)
C_TX_SPEED_EMPTY = range(30, 41)
C_TX_SPEED_FULL = range(41, 52)
C_TX_LAT_EMPTY = range(52, 63)
C_TX_LAT_FULL = range(63, 74)
C_SCORE = (74, 75, 76, 77)  # 理论性能比 / 读写速度比 / 响应速度比 / 综合

# 场景命名：写给人看的中文短标签（原 R/W 缩写普通用户看不懂）
#   label = 完整说明（悬停提示用）  short = 图表/表格里显示的短标签
#   规则：数字 + "顺序读/顺序写/随机读/随机写"，不加百分号，避免与顺序/随机字样打架
TX_SCENARIOS = [
    {"key": "s1", "label": "95% 顺序读取 + 5% 随机写入", "short": "95顺序读/5随机写", "rw": True},
    {"key": "s2", "label": "95% 顺序写入 + 5% 随机读取", "short": "95顺序写/5随机读", "rw": True},
    {"key": "s3", "label": "50% 顺序读取 + 50% 顺序写入", "short": "50顺序读/50顺序写", "rw": True},
    {"key": "s4", "label": "50% 随机读取 + 50% 随机写入", "short": "50随机读/50随机写", "rw": True},
    {"key": "s5", "label": "80% 顺序写入 + 20% 顺序读取", "short": "80顺序写/20顺序读", "rw": True},
    {"key": "s6", "label": "60% 顺序写入 + 40% 随机写入", "short": "60顺序写/40随机写", "rw": False},
]

# TX-Bench 场景命名口径说明，前端做图例用
TX_SCENARIO_NOTE = "顺序 = 连续大块数据；随机 = 4K 小块离散地址。百分比为该场景的读写占比"

ASSSD_KEYS = ["seqR", "seqW", "r4k", "w4k", "r4k64", "w4k64", "accR", "accW"]
CDM_KEYS = ["seqR", "seqW", "r4kq8t1", "w4kq8t1", "r4kq64t1", "w4kq64t1", "r4kq8t8", "w4kq8t8"]


# ---------------------------------------------------------------- 工具函数

NA_STRINGS = {"None", "none", "NONE", "-", "—", "", "N/A", "n/a"}


def clean(v):
    """把单元格值归一化：'None'/空 -> None，字符串去空白。"""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        if s in NA_STRINGS:
            return None
        return re.sub(r"\s+", " ", s)
    return v


def num(v, nd=2):
    """转数字并四舍五入；非法值返回 None。"""
    v = clean(v)
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return round(f, nd)


def cap_to_gb(cap):
    """'512G' -> 512 ; '4T' -> 4096"""
    if not cap:
        return None
    m = re.match(r"^\s*([\d.]+)\s*([GTgt])\s*$", str(cap))
    if not m:
        return None
    val = float(m.group(1))
    return int(val * 1024) if m.group(2).upper() == "T" else int(val)


def split_brand(raw):
    """'三星\n（Samsung）' -> ('三星', 'Samsung')"""
    if not raw:
        return None, None
    parts = [p.strip() for p in re.split(r"[\n\r]+", str(raw)) if p.strip()]
    cn = parts[0] if parts else None
    en = None
    if len(parts) > 1:
        en = parts[1].strip("（）() ").strip()
    if not en and cn:
        m = re.match(r"^(.*?)[（(](.*?)[）)]$", cn)
        if m:
            cn, en = m.group(1).strip(), m.group(2).strip()
    return cn, en


def parse_interface(iface):
    """'M.2 2280 PCIe 4.0 X4' -> 总线 / 形态 / 代际 / 通道"""
    if not iface:
        return {"bus": None, "form": None, "pcieGen": None, "lanes": None}
    s = str(iface)
    up = s.upper()

    # 总线类型
    if "NVME" in up or "PCIE" in up:
        bus = "NVMe" if "AHCI" not in up else "PCIe-AHCI"
    elif "SATA" in up:
        bus = "SATA"
    else:
        bus = "其他"

    # 形态
    form = None
    m = re.search(r"M\.2\s*(\d{4,5})", s)
    if m:
        form = "M.2 " + m.group(1)
    elif re.search(r"M\.3\s*(\d{4,5})", s):
        m3 = re.search(r"M\.3\s*(\d{4,5})", s)
        form = "M.3 " + m3.group(1)
    else:
        for key in ["U.2", "U.3", "E1.S", "E1.L", "AIC", "mSATA", "MicroSATA", "SATA"]:
            if key.upper() in up:
                form = key
                break
    if form is None:
        form = "其他"

    # PCIe 代际 / 通道
    gen = None
    mg = re.search(r"PCIE\s*(\d)\.0", up)
    if mg:
        gen = "PCIe " + mg.group(1) + ".0"
    lanes = None
    ml = re.search(r"X(\d)\b", up)
    if ml:
        lanes = int(ml.group(1))

    return {"bus": bus, "form": form, "pcieGen": gen, "lanes": lanes}


def nand_type(nand):
    """从颗粒串里提取 TLC / MLC / QLC / SLC / 3D-XPoint"""
    if not nand:
        return None
    s = str(nand).upper()
    for t in ["3D-XPOINT", "QLC", "TLC", "MLC", "SLC"]:
        if t in s:
            return "3D XPoint" if t == "3D-XPOINT" else t
    return None


def controller_brand(ctrl):
    if not ctrl:
        return None
    s = str(ctrl)
    known = [
        "Samsung", "Intel", "Sandisk", "SanDisk", "Hynix", "Micron", "Marvell",
        "SMI", "Silicon Motion", "Phison", "Realtek", "Maxio", "InnoGrit",
        "JMicron", "SandForce", "Microchip", "PMC-Sierra", "PLX", "Shannon Systems",
        "Kingston", "Toshiba", "Kioxia", "Seagate", "WD", "Western Digital",
    ]
    for k in known:
        if k.lower() in s.lower():
            return "Silicon Motion" if k in ("SMI", "Silicon Motion") else (
                "Sandisk" if k == "SanDisk" else k)
    return s.split()[0]


def tx_group(row, cols):
    """把 11 列 TX-Bench 数据按 6 个场景拆成 [{read, write}]"""
    vals = [num(row[i], 4) for i in cols]
    out = []
    idx = 0
    for sc in TX_SCENARIOS:
        if sc["rw"]:
            out.append({"read": vals[idx] if idx < len(vals) else None,
                        "write": vals[idx + 1] if idx + 1 < len(vals) else None})
            idx += 2
        else:
            out.append({"read": None,
                        "write": vals[idx] if idx < len(vals) else None})
            idx += 1
    return out


# ---------------------------------------------------------------- 读取

def load_workbook(path):
    return openpyxl.load_workbook(path, data_only=True, read_only=True)


def read_detail(wb):
    ws = wb[SHEET_DETAIL]
    rows = list(ws.iter_rows(min_row=DATA_START_ROW, max_row=ws.max_row, values_only=True))
    records = []
    brand = None
    for offset, row in enumerate(rows):
        if row is None or len(row) <= C_MODEL:
            continue
        if clean(row[C_MODEL]) is None:
            continue
        # 品牌为纵向合并单元格，需要向下填充
        if clean(row[C_BRAND]) is not None:
            brand = clean(row[C_BRAND])
        sid = offset + 1  # 与天梯表的"序号"一一对应

        cn, en = split_brand(brand)
        iface = clean(row[C_IFACE])
        nand = clean(row[C_NAND])
        ctrl = clean(row[C_CTRL])
        cap = clean(row[C_CAP])

        rec = {
            "id": sid,
            "brand": cn,
            "brandEn": en,
            "model": clean(row[C_MODEL]),
            "pn": clean(row[C_PN]),
            "capacity": cap,
            "capacityGB": cap_to_gb(cap),
            "tier": clean(row[C_TIER]),
            "controller": ctrl,
            "controllerBrand": controller_brand(ctrl),
            "nand": nand,
            "nandType": nand_type(nand),
            "dram": clean(row[C_DRAM]),
            "interface": iface,
            **{"bus": None, "form": None, "pcieGen": None, "lanes": None},
        }
        rec.update(parse_interface(iface))

        spec = [num(row[i], 0) for i in C_SPEC]
        rec["spec"] = {
            "seqRead": spec[0], "seqWrite": spec[1],
            "randReadIOPS": spec[2], "randWriteIOPS": spec[3],
        }

        a = [num(row[i], 2) for i in C_ASSSD]
        rec["asssd"] = dict(zip(ASSSD_KEYS, a))

        c = [num(row[i], 2) for i in C_CDM]
        rec["cdm"] = dict(zip(CDM_KEYS, c))

        rec["txbench"] = {
            "speedEmpty": tx_group(row, C_TX_SPEED_EMPTY),
            "speedFull": tx_group(row, C_TX_SPEED_FULL),
            "latencyEmpty": tx_group(row, C_TX_LAT_EMPTY),
            "latencyFull": tx_group(row, C_TX_LAT_FULL),
        }

        sc = [num(row[i], 4) for i in C_SCORE]
        rec["scores"] = {
            "theoretical": sc[0],   # 理论性能比
            "bandwidth": sc[1],     # 读写速度比
            "latency": sc[2],       # 响应速度比
            "overall": sc[3],       # 综合
        }
        records.append(rec)
    return records


def read_ladder(wb):
    """返回 {序号: 排名}"""
    ws = wb[SHEET_LADDER]
    rows = list(ws.iter_rows(min_row=LADDER_START_ROW, max_row=ws.max_row, values_only=True))
    ranks = {}
    for row in rows:
        if not row or row[0] is None:
            continue
        try:
            sid = int(row[0])
            rank = int(row[1])
        except (TypeError, ValueError):
            continue
        ranks[sid] = rank
    return ranks


def read_notes(wb):
    """解析「更新日志与说明」表。

    这一页是给人看的手写表，行位置随时会被改动，所以这里**不写死行号**，
    而是按内容形态分块：
      · 只有第 1 列有内容        → 说明性区块（标题行以「：」结尾，正文是其后的若干行）
      · 跨多列的行               → 测试平台表（表头 / 规格 / 职责脚注）
      · 「更新记录」之后的两列行 → 更新日志
    """
    ws = wb[SHEET_NOTES]
    rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))

    def cell(row, j):
        v = row[j] if j < len(row) else None
        return str(v).strip() if v is not None else ""

    def non_empty(row):
        return [(j, cell(row, j)) for j in range(len(row)) if cell(row, j)]

    sections = []          # [{"title": str|None, "lines": [...]}]
    platform_names, platform_scope, platforms = [], [], []
    changelog = []
    log_started = False

    for row in rows:
        parts = non_empty(row)
        if not parts:
            continue

        # ---- 说明性区块 / 锚点：整行只有第 1 列有内容 ----
        if len(parts) == 1 and parts[0][0] == 0:
            raw = parts[0][1]
            lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            if len(lines) == 1 and lines[0].rstrip("：:") == "更新记录":
                log_started = True          # 之后的两列行就是更新日志
                continue
            title = None
            if lines and TITLE_RE.match(lines[0]):
                title = lines[0].rstrip("：:")
                lines = lines[1:]
            if lines:
                sections.append({"title": title, "lines": lines})
            continue

        # ---- 跨列的行：可能是测试平台表，也可能是更新日志 ----
        # 平台表缩进一列写（列 B 起），更新日志则从列 A 开始，用这一点区分，
        # 否则最后一条更新记录（两列）会被误当成平台职责说明。
        if parts[0][0] == 0:
            continue
        vals = [v for _, v in parts]
        if all(v.startswith("测试平台") for v in vals):
            platform_names = vals
        elif len(vals) >= 3:
            # 规格行：[标签, 平台一值, 标签, 平台二值]
            platforms.append(vals)
        elif len(vals) == 2:
            # 只有两个值、且不是表头 → 平台职责说明，放到表格下方当脚注
            platform_scope = vals

    if log_started:
        hit = False
        for row in rows:
            if not hit:
                if len(non_empty(row)) == 1 and non_empty(row)[0][0] == 0 \
                        and non_empty(row)[0][1].rstrip("：:") == "更新记录":
                    hit = True
                continue
            a, b = cell(row, 0), cell(row, 1)
            if a and b:
                changelog.append({"date": a, "text": b})

    return {
        "sections": sections,
        "principle": "\n".join((sections[0]["lines"] if sections else [])),
        "platformNames": platform_names,
        "platformScope": platform_scope,
        "platforms": platforms,
        "changelog": changelog
    }


# ---------------------------------------------------------------- 输出

def build_index(records):
    idx = []
    for r in records:
        idx.append({
            "id": r["id"],
            "rank": r.get("rank"),
            "brand": r["brand"],
            "brandEn": r["brandEn"],
            "model": r["model"],
            "pn": r["pn"],
            "capacity": r["capacity"],
            "capacityGB": r["capacityGB"],
            "tier": r["tier"],
            "controller": r["controller"],
            "controllerBrand": r["controllerBrand"],
            "nand": r["nand"],
            "nandType": r["nandType"],
            "dram": r["dram"],
            "interface": r["interface"],
            "bus": r["bus"],
            "form": r["form"],
            "pcieGen": r["pcieGen"],
            "lanes": r["lanes"],
            "spec": r["spec"],
            "scores": r["scores"],
            # 列表页天梯图需要的少量关键跑分
            "key": {
                "asssdSeqR": r["asssd"]["seqR"],
                "asssdSeqW": r["asssd"]["seqW"],
                "cdmSeqR": r["cdm"]["seqR"],
                "cdmSeqW": r["cdm"]["seqW"],
                "cdm4kR": r["cdm"]["r4kq8t8"],
                "cdm4kW": r["cdm"]["w4kq8t8"],
                "accR": r["asssd"]["accR"],
            },
        })
    idx.sort(key=lambda x: (x["rank"] is None, x["rank"]))
    return idx


def facets(index):
    def uniq(key, sort_values=True):
        vals = {}
        for r in index:
            v = r.get(key)
            if v:
                vals[v] = vals.get(v, 0) + 1
        if sort_values:
            return [{"value": k, "count": v} for k, v in sorted(vals.items(), key=lambda x: -x[1])]
        return [{"value": k, "count": v} for k, v in vals.items()]

    cap_order = ["16G", "32G", "64G", "128G", "256G", "512G", "1T", "2T", "4T", "8T"]
    caps = {r["capacity"] for r in index if r.get("capacity")}
    cap_list = [{"value": c, "count": sum(1 for r in index if r.get("capacity") == c)}
                for c in cap_order if c in caps]
    for c in sorted(caps):
        if c not in cap_order:
            cap_list.append({"value": c, "count": sum(1 for r in index if r.get("capacity") == c)})

    return {
        "brand": uniq("brand"),
        "tier": uniq("tier"),
        "capacity": cap_list,
        "bus": uniq("bus"),
        "form": uniq("form"),
        "pcieGen": [{"value": g, "count": c} for g, c in
                    sorted({r["pcieGen"]: sum(1 for x in index if x.get("pcieGen") == r["pcieGen"])
                            for r in index if r.get("pcieGen")}.items())],
        "nandType": uniq("nandType"),
        "controllerBrand": uniq("controllerBrand"),
    }


def main():
    given = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    out_dir = OUT_DIR
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]

    # 候选路径：命令行指定 > OneDrive 源表 > 项目内副本
    candidates = [given] if given else [_ONEDRIVE, _LOCAL]
    xlsx = None
    for c in candidates:
        if c and os.path.exists(c):
            try:
                open(c, "rb").close()
                xlsx = c
                break
            except PermissionError:
                print("跳过（文件被占用）: %s" % c)
    if not xlsx:
        sys.exit("找不到可读取的 Excel 文件。\n" +
                 "若源表正在 Excel 中打开，请先关闭，或在命令行显式指定一个副本路径：\n" +
                 "  python tools/build_data.py <副本路径.xlsx>")

    print("读取: %s" % xlsx)
    wb = load_workbook(xlsx)
    records = read_detail(wb)
    ranks = read_ladder(wb)
    notes = read_notes(wb)

    for r in records:
        r["rank"] = ranks.get(r["id"])

    missing = [r["id"] for r in records if r["rank"] is None]
    if missing:
        print("警告: %d 条记录没有排名: %s" % (len(missing), missing[:10]))

    index = build_index(records)
    meta = {
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(records),
        "notes": notes,
        "facets": facets(index),
        "txScenarios": TX_SCENARIOS,
        "txScenarioNote": TX_SCENARIO_NOTE,
    }

    data_dir = os.path.join(out_dir, "data")
    shard_dir = os.path.join(data_dir, "ssd")
    os.makedirs(shard_dir, exist_ok=True)

    def dump(obj, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    dump(meta, os.path.join(data_dir, "meta.json"))
    dump(index, os.path.join(data_dir, "index.json"))
    for r in records:
        dump(r, os.path.join(shard_dir, "%d.json" % r["id"]))

    size_idx = os.path.getsize(os.path.join(data_dir, "index.json"))
    print("完成: %d 条记录" % len(records))
    print("  data/index.json  %.1f KB" % (size_idx / 1024.0))
    print("  data/ssd/*.json  %d 个分片" % len(records))
    print("  data/meta.json   已生成")


if __name__ == "__main__":
    main()
