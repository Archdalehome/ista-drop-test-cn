/**
 * app.js - 按箱体尺寸与毛重查询 ISTA 跌落测试步骤
 *
 * 数据来自 data.json（由 tools/extract.py 从原始结果页机械抽取，tools/compare.py 逐格校验）。
 * 本文件只做判定与展示，不改动任何步骤数据。
 *
 * 纯逻辑函数挂在 window.ISTA 上，方便 tools/test-rules.js 在 Node 里直接测边界。
 */
(function (global) {
    'use strict';

    var MM_PER_IN = 25.4;
    var GIRTH_LIMIT_IN = 165; // 正好 165 in 归入「大于 165 in」一侧

    var TYPE_ZH = {
        'Drop': ['跌落', 'Drop'],
        'Hazard Drop': ['危险跌落', 'Hazard Drop'],
        'Impact Test': ['冲击测试', 'Impact Test'],
        'Rotational FLAT Drop': ['旋转面跌落', 'Rotational FLAT Drop'],
        'Roational FLAT Drop': ['旋转面跌落', 'Roational FLAT Drop（原文拼写如此）'],
        'Rotational EDGE Drop': ['旋转棱跌落', 'Rotational EDGE Drop'],
        'Rotational Edge Drop Test': ['旋转棱跌落测试', 'Rotational Edge Drop Test'],
        'Rotational CORNER Drop': ['旋转角跌落', 'Rotational CORNER Drop'],
        'Full Rotational Test': ['完整旋转测试', 'Full Rotational Test'],
        'Floor Hazard Drop': ['地面危险跌落', 'Floor Hazard Drop'],
        'Bridge Hazard Drop': ['桥式危险跌落', 'Bridge Hazard Drop']
    };

    /* ---------- 纯逻辑 ---------- */

    function translate(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (s === '' || s === '--') return { zh: '—', en: '' };

        if (TYPE_ZH[s]) return { zh: TYPE_ZH[s][0], en: TYPE_ZH[s][1] };

        var m;
        if ((m = s.match(/^Face (\d+)$/))) return { zh: '面 ' + m[1], en: 'FACE ' + m[1] };
        if ((m = s.match(/^Edge ([\d-]+)$/))) return { zh: '棱 ' + m[1], en: 'EDGE ' + m[1] };
        if ((m = s.match(/^Corner ([\d-]+)$/))) return { zh: '角 ' + m[1], en: 'CORNER ' + m[1] };

        if (s === 'Most Risky Face') return { zh: '最危险面', en: 'Most Risky Face' };
        if (s === 'Allow to fall to ground with this face as the base') {
            return { zh: '以此面为底，自由跌落到地面', en: s };
        }
        if ((m = s.match(/^Place on\s*:\s*Face (\d+)$/))) {
            return { zh: '置于：面 ' + m[1], en: 'Place on: FACE ' + m[1] };
        }
        if ((m = s.match(/^Impact\s*:\s*Face (\d+)$/))) {
            return { zh: '冲击：面 ' + m[1], en: 'Impact: FACE ' + m[1] };
        }
        if ((m = s.match(/^Impact\s*:\s*Edge ([\d-]+)$/))) {
            return { zh: '冲击：棱 ' + m[1], en: 'Impact: EDGE ' + m[1] };
        }
        if ((m = s.match(/^HAZARD:\s*Face (\d+) on "Hazard Block"$/))) {
            return {
                zh: '危险跌落：面 ' + m[1] + ' 落在危险障碍块上',
                en: 'HAZARD: FACE ' + m[1] + ' on "Hazard Block"'
            };
        }
        if (/^Drop\s+"\s*Hazard Box\s*"\s*from/.test(s)) {
            return { zh: '将危险箱跌落到指定面（高度见左）', en: s };
        }
        if (/^Rest on 2 supports/.test(s)) {
            return { zh: '架在两个支撑上，将危险箱跌落到指定面', en: s };
        }
        // 高度这类纯数值，原样显示
        return { zh: s, en: '' };
    }

    function girthMm(l, w, h) {
        var a = [l, w, h].sort(function (x, y) { return x - y; }); // 升序，a[0] 最短
        return (a[0] + a[1]) * 2 + a[2];
    }

    function girthSide(girthIn) {
        return girthIn >= GIRTH_LIMIT_IN ? 'gt165' : 'lt165';
    }

    function weightKeysFor(side) {
        return side === 'gt165'
            ? ['lt27', '27to45', '45to91', 'gt91']
            : ['lt32', '32to45', 'gt45'];
    }

    function weightBandFor(weights, weightKg, side) {
        var keys = weightKeysFor(side);
        for (var i = 0; i < keys.length; i++) {
            var b = weights[keys[i]];
            if (weightKg >= b.min && (b.max === null || weightKg < b.max)) return keys[i];
        }
        return keys[keys.length - 1];
    }

    function pickGroupId(side, shape, band) {
        return side + '_' + shape + '_' + band;
    }

    function fdin(n) {
        return Number(n).toFixed(1).replace(/\.0$/, '');
    }

    var api = {
        MM_PER_IN: MM_PER_IN,
        GIRTH_LIMIT_IN: GIRTH_LIMIT_IN,
        translate: translate,
        girthMm: girthMm,
        girthSide: girthSide,
        weightKeysFor: weightKeysFor,
        weightBandFor: weightBandFor,
        pickGroupId: pickGroupId,
        fdin: fdin
    };
    global.ISTA = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (typeof document === 'undefined') return;

    /* ---------- 页面 ---------- */

    var state = { data: null, groups: {} };
    var els = {};

    function chip(label, value, sub, tone) {
        return '<div class="verdict-item' + (tone ? ' verdict-item--' + tone : '') + '">' +
            '<span class="verdict-label">' + label + '</span>' +
            '<strong class="verdict-value">' + value + '</strong>' +
            (sub ? '<span class="verdict-sub">' + sub + '</span>' : '') +
            '</div>';
    }

    function renderVerdict(info, group) {
        var shapeZh = info.shape === 'STANDARD' ? '标准箱型' : '细长 / 扁平箱型';
        var shapeEn = info.shape === 'STANDARD' ? 'STANDARD' : 'ELONGATED / FLAT';
        var sideZh = info.side === 'gt165' ? '周长 ≥ 165 in' : '周长 < 165 in';

        els.verdict.innerHTML =
            chip('箱体周长 Girth', fdin(info.girthIn) + ' in',
                fdin(info.girthMm) + ' mm · ' + sideZh) +
            chip('箱型 Carton Type', shapeZh, shapeEn) +
            chip('重量段 Gross Weight', state.data.weights[group.weightKey].display,
                '毛重 ' + fdin(info.weightKg) + ' kg') +
            chip('测试步骤数', group.rows.length + ' 步', '见下表', 'accent');
    }

    function renderTable(group) {
        var html = '';
        group.rows.forEach(function (row) {
            var type = translate(row.type);
            var height = translate(row.height);
            var impact = translate(row.impact);
            var imgs = (row.images || []).map(function (src) {
                return '<img src="' + src + '" alt="步骤 ' + row.step + ' 图示" loading="lazy">';
            }).join('');

            html += '<tr>' +
                '<td class="col-step" data-label="步骤"><span class="step-no">' + row.step + '</span></td>' +
                '<td class="col-type" data-label="类型">' + type.zh +
                (type.en ? '<span class="cell-en">' + type.en + '</span>' : '') + '</td>' +
                '<td class="col-height" data-label="跌落高度 / 条件">' + height.zh +
                (height.en ? '<span class="cell-en">' + height.en + '</span>' : '') + '</td>' +
                '<td class="col-impact" data-label="冲击部位">' + impact.zh +
                (impact.en ? '<span class="cell-en">' + impact.en + '</span>' : '') + '</td>' +
                '<td class="col-img" data-label="图示">' + imgs + '</td>' +
                '</tr>';
        });
        els.tbody.innerHTML = html;

        var notes = group.notes || [];
        if (notes.length && notes[0].images && notes[0].images.length) {
            var noteImgs = notes[0].images.map(function (src) {
                return '<img src="' + src + '" alt="危险跌落示意" loading="lazy">';
            }).join('');
            els.tableNote.innerHTML = '<span class="note-label">危险跌落 HAZARD 示意</span>' + noteImgs;
        } else {
            els.tableNote.innerHTML = '';
        }
    }

    function showError(msg) {
        els.error.textContent = msg;
        els.error.hidden = false;
        els.result.hidden = true;
        return false;
    }

    function compute() {
        var l = parseFloat(els.l.value);
        var w = parseFloat(els.w.value);
        var h = parseFloat(els.h.value);
        var kg = parseFloat(els.kg.value);
        var factor = els.unit.value === 'cm' ? 10 : 1;
        var shapeInput = els.form.querySelector('input[name="shape"]:checked');
        var shape = shapeInput ? shapeInput.value : 'STANDARD';

        var values = [l, w, h, kg];
        if (values.some(function (v) { return isNaN(v); })) {
            return showError('请填写长、宽、高和毛重四个数值。');
        }
        if (values.some(function (v) { return v <= 0; })) {
            return showError('尺寸和毛重都需要大于 0。');
        }

        els.error.hidden = true;

        var mmGirth = girthMm(l * factor, w * factor, h * factor);
        var inchGirth = mmGirth / MM_PER_IN;
        var side = girthSide(inchGirth);
        var band = weightBandFor(state.data.weights, kg, side);
        var group = state.groups[pickGroupId(side, shape, band)];

        if (!group) {
            return showError('没有匹配到对应的步骤表，请检查输入。');
        }

        renderVerdict({
            girthIn: inchGirth, girthMm: mmGirth, weightKg: kg, side: side, shape: shape
        }, group);
        renderTable(group);

        els.tableTitle.textContent = '跌落测试步骤（共 ' + group.rows.length + ' 步）';
        els.result.hidden = false;

        var params = new URLSearchParams({
            l: els.l.value, w: els.w.value, h: els.h.value,
            u: els.unit.value, kg: els.kg.value, shape: shape
        });
        history.replaceState(null, '', '?' + params.toString() + '#result');
        return true;
    }

    function readParams() {
        var p = new URLSearchParams(window.location.search);
        if (!p.has('l')) return false;
        els.l.value = p.get('l') || '';
        els.w.value = p.get('w') || '';
        els.h.value = p.get('h') || '';
        if (p.get('u') === 'cm') els.unit.value = 'cm';
        els.kg.value = p.get('kg') || '';
        var shape = p.get('shape');
        if (shape) {
            var radio = els.form.querySelector('input[name="shape"][value="' + shape + '"]');
            if (radio) radio.checked = true;
        }
        return true;
    }

    function init() {
        els.form = document.getElementById('calc-form');
        els.l = document.getElementById('dim-l');
        els.w = document.getElementById('dim-w');
        els.h = document.getElementById('dim-h');
        els.unit = document.getElementById('dim-unit');
        els.kg = document.getElementById('gross-weight');
        els.error = document.getElementById('form-error');
        els.result = document.getElementById('result');
        els.verdict = document.getElementById('verdict');
        els.tableTitle = document.getElementById('table-title');
        els.tbody = document.getElementById('steps-body');
        els.tableNote = document.getElementById('table-note');
        els.printBtn = document.getElementById('print-btn');

        fetch('data.json')
            .then(function (r) {
                if (!r.ok) throw new Error('data.json 加载失败（HTTP ' + r.status + '）');
                return r.json();
            })
            .then(function (data) {
                state.data = data;
                data.groups.forEach(function (g) {
                    state.groups[g.id] = g;
                });
                els.form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    compute();
                });
                els.printBtn.addEventListener('click', function () { window.print(); });
                if (readParams()) compute();
            })
            .catch(function (err) {
                showError('步骤数据加载失败：' + err.message + '。请刷新页面重试。');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
