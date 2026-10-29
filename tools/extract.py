# -*- coding: utf-8 -*-
"""从原 ISTA 结果页抽取表格数据，输出 data.json。

只做机械抽取，不改任何文字：单元格文本仅做空白折叠（&nbsp; -> 空格、多空白合一、去首尾）。
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT = sys.argv[2] if len(sys.argv) > 2 else "data.json"

PAGES = [
    # (文件名, girth 侧, 箱型, 重量段 key)
    ("lessthan165_STANDARD_32kg.htm", "lt165", "STANDARD", "lt32"),
    ("lessthan165_STANDARD_45kg.htm", "lt165", "STANDARD", "32to45"),
    ("lessthan165_STANDARD_weighter.htm", "lt165", "STANDARD", "gt45"),
    ("lessthan165_ELONGATED_32kg.htm", "lt165", "ELONGATED", "lt32"),
    ("lessthan165_ELONGATED_45kg.htm", "lt165", "ELONGATED", "32to45"),
    ("lessthan165_ELONGATED_weighter.htm", "lt165", "ELONGATED", "gt45"),
    ("biggerthan165_STANDARD_27kg.htm", "gt165", "STANDARD", "lt27"),
    ("biggerthan165_STANDARD_27-45kg.htm", "gt165", "STANDARD", "27to45"),
    ("biggerthan165_STANDARD_45-91kg.htm", "gt165", "STANDARD", "45to91"),
    ("biggerthan165_STANDARD_91kg-plus.htm", "gt165", "STANDARD", "gt91"),
    ("biggerthan165_ELONGATED_27kg.htm", "gt165", "ELONGATED", "lt27"),
    ("biggerthan165_ELONGATED_27-45kg.htm", "gt165", "ELONGATED", "27to45"),
    ("biggerthan165_ELONGATED_45-91kg.htm", "gt165", "ELONGATED", "45to91"),
    ("biggerthan165_ELONGATED_91kg-plus.htm", "gt165", "ELONGATED", "gt91"),
]


def norm(s):
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


class TableParser(HTMLParser):
    """收集 table 内每个 tr 的单元格文本与图片，顺带抓 h1。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None
        self.images = []
        self.h1 = ""
        self._in_h1 = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "h1":
            self._in_h1 = True
        elif tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"text": "", "images": [], "colspan": int(a.get("colspan", 1) or 1)}
        elif tag == "img" and self.cell is not None:
            src = a.get("src", "")
            if src:
                self.cell["images"].append(src)

    def handle_endtag(self, tag):
        if tag == "h1":
            self._in_h1 = False
        elif tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.cell["text"] = norm(self.cell["text"])
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data
        elif self._in_h1:
            self.h1 += data


def parse(path):
    p = TableParser()
    with open(path, encoding="utf-8", errors="replace") as f:
        p.feed(f.read())
    return p.rows, norm(p.h1)


def extract(path):
    rows, h1 = parse(path)
    first_is_header = bool(rows) and len(rows[0]) > 1
    title = h1 or ("" if first_is_header else (rows[0][0]["text"] if rows else ""))
    steps = []
    notes = []
    header = None
    for r in rows[1:]:
        texts = [c["text"] for c in r]
        imgs = [i for c in r for i in c["images"]]
        if header is None and "Step" in " ".join(texts):
            header = texts
            continue
        if len(r) == 1 and r[0]["colspan"] >= 4:
            if imgs:
                notes.append({"images": imgs, "text": r[0]["text"]})
            continue
        if len(r) >= 4:
            steps.append({
                "step": texts[0],
                "type": texts[1],
                "height": texts[2],
                "impact": texts[3],
                "images": imgs,
            })
        elif imgs:
            notes.append({"images": imgs, "text": " ".join(t for t in texts if t)})
    return {"title": title, "header": header, "steps": steps, "notes": notes}


WEIGHTS = {
    "lt27": {"label": "<27 kg", "min": 0, "max": 27, "maxInclusive": False, "display": "毛重 < 27 kg"},
    "lt32": {"label": "<32 kg", "min": 0, "max": 32, "maxInclusive": False, "display": "毛重 < 32 kg"},
    "27to45": {"label": "27–45 kg", "min": 27, "max": 45, "maxInclusive": False, "display": "27 kg ≤ 毛重 < 45 kg"},
    "32to45": {"label": "32–45 kg", "min": 32, "max": 45, "maxInclusive": False, "display": "32 kg ≤ 毛重 < 45 kg"},
    "45to91": {"label": "45–91 kg", "min": 45, "max": 91, "maxInclusive": False, "display": "45 kg ≤ 毛重 < 91 kg"},
    "gt45": {"label": ">45 kg", "min": 45, "max": None, "maxInclusive": False, "display": "毛重 ≥ 45 kg"},
    "gt91": {"label": ">91 kg", "min": 91, "max": None, "maxInclusive": False, "display": "毛重 ≥ 91 kg"},
}

def main():
    groups = []
    for fname, girth, shape, wkey in PAGES:
        path = os.path.join(SRC, fname)
        d = extract(path)
        groups.append({
            "id": "%s_%s_%s" % (girth, shape, wkey),
            "source": fname,
            "girth": girth,      # lt165 / gt165
            "shape": shape,      # STANDARD / ELONGATED
            "weightKey": wkey,
            "title": d["title"],
            "rows": d["steps"],
            "notes": d["notes"],
        })

    used_images = sorted({i for g in groups for r in g["rows"] + g["notes"] for i in r["images"]})

    data = {
        "generatedFrom": "ista-drop-test-cn 原始结果页（逐格机械抽取）",
        "girthThresholdIn": 165,
        "weights": WEIGHTS,
        "groups": groups,
        "usedImages": used_images,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("组数:", len(groups))
    for g in groups:
        print("  %-34s %-11s %2d 步  %s" % (g["source"], g["weightKey"], len(g["rows"]), g["title"][:44]))
    print("用到的图片:", len(used_images))
    for i in used_images:
        print("   ", i)


if __name__ == "__main__":
    main()
