# ISTA 跌落测试方案 - 箱体跌落步骤查询

把原来 21 个静态页的分级查询（周长 → 箱型 → 重量段 → 步骤表）重做成一个单页工具：
输入箱体长宽高与毛重，自动算周长并按规则匹配到对应的跌落步骤表。

## 目录

```
index.html          单页工具（唯一发布页面）
app.js              判定逻辑 + 渲染（纯逻辑挂在 window.ISTA，可在 Node 里测）
style.css           样式（含手机 375px 卡片式表格、打印样式）
data.json           14 组步骤表数据（从原始结果页逐格抽取）
images/             页面实际用到的 17 张图
reference/          原始结果页留档（.htm.txt，不作为页面发布）
tools/extract.py    从原始 .htm 抽取 data.json
tools/compare.py    data.json 与原始 .htm 逐格比对
tools/test-rules.js 判定规则、边界值、译法与图片完整性自测
```

## 数据怎么来

`data.json` 由 `tools/extract.py` 从原始结果页机械抽取，只做空白折叠，不改任何文字与数值。
抽取后必须跑 `tools/compare.py`，逐格比对差异为 0 才算通过。

```bash
# 从原始文件夹重新生成 data.json
python tools/extract.py <原始 htm 文件夹> data.json

# 逐格比对（reference/ 里放原始页，后缀 .htm.txt）
python tools/compare.py --data data.json --ref reference
```

当前状态：14 组、1085 个单元格，差异 0。

## 判定规则

- 周长 Girth =（最短边 + 次短边）× 2 + 最长边，按英寸比较（1 in = 25.4 mm）
- **周长正好 165 in 归入「大于 165 in」一侧**（与原工具一致）
- 重量段上限不含：32 kg 归 32–45 kg 段、45 kg 归 45 kg 以上段；27 kg、91 kg 同理
- 周长 < 165 in：<32 kg / 32–45 kg / >45 kg
- 周长 > 165 in：<27 kg / 27–45 kg / 45–91 kg / >91 kg

箱型（STANDARD 与 ELONGATED/FLAT）由用户按示意图选择，工具不做推断。

## 自测

```bash
node tools/test-rules.js
```

覆盖：14 组齐全、每组都可被输入命中、165 in 与 32/45/27/91 kg 的边界、651 个单元格都有中文译法、图片文件都存在。

## 部署

Cloudflare Pages 项目 `ista-drop-test-cn`，GitHub 集成，`main` 分支，无构建命令，push 即发布。

- 生产地址：https://ista-drop-test-cn.pages.dev/
- `reference/` 下的原始页面在 `robots.txt` 里 Disallow，不参与索引
