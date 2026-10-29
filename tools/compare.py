# -*- coding: utf-8 -*-
"""把 data.json 与 reference/ 下的原始结果页逐格比对。

用法：
    python tools/compare.py --data data.json --ref reference

比对字段：每个步骤的 步骤号 / 类型 / 跌落高度 / 冲击部位 / 图片，以及表格标题与备注行。
任何一格不一致都会打印出来并以非 0 退出码结束。
"""
import argparse
import json
import os
import re
import sys
from html.parser import HTMLParser


def norm(s):
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None
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
    steps, notes, header = [], [], None
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
            steps.append({"step": texts[0], "type": texts[1], "height": texts[2],
                          "impact": texts[3], "images": imgs})
        elif imgs:
            notes.append({"images": imgs, "text": " ".join(t for t in texts if t)})
    return {"title": title, "header": header, "steps": steps, "notes": notes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data.json")
    ap.add_argument("--ref", default="reference")
    a = ap.parse_args()

    data = json.load(open(a.data, encoding="utf-8"))
    total_cells = 0
    diffs = []
    for g in data["groups"]:
        ref_path = os.path.join(a.ref, g["source"] + ".txt")
        if not os.path.isfile(ref_path):
            diffs.append("%s: 缺少参考文件 %s" % (g["source"], ref_path))
            continue
        ref = extract(ref_path)
        if ref["title"] and g["title"] and norm(ref["title"]) != norm(g["title"]):
            diffs.append("%s: 标题不一致 %r != %r" % (g["source"], g["title"], ref["title"]))
        if len(ref["steps"]) != len(g["rows"]):
            diffs.append("%s: 行数不一致 JSON=%d 参考=%d" % (g["source"], len(g["rows"]), len(ref["steps"])))
        for i, (row, rrow) in enumerate(zip(g["rows"], ref["steps"])):
            for f in ("step", "type", "height", "impact"):
                total_cells += 1
                if norm(str(row[f])) != norm(rrow[f]):
                    diffs.append("%s 第 %d 行 %s: JSON=%r 参考=%r" % (g["source"], i + 1, f, row[f], rrow[f]))
            total_cells += 1
            if sorted(row["images"]) != sorted(rrow["images"]):
                diffs.append("%s 第 %d 行 images 不一致" % (g["source"], i + 1))
        if len(g["notes"]) != len(ref["notes"]):
            diffs.append("%s: 备注行数不一致" % g["source"])

    print("比对组数: %d，比对单元格: %d" % (len(data["groups"]), total_cells))
    if diffs:
        print("差异 %d 处:" % len(diffs))
        for d in diffs:
            print("  - " + d)
        return 1
    print("差异: 0（逐格一致）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
