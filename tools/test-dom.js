#!/usr/bin/env node
/**
 * 页面逻辑自测：node tools/test-dom.js
 *
 * 用最小 DOM 桩跑一遍 app.js 的 init → fetch(data.json) → compute → render，
 * 验证：能自动按 URL 参数出结果、结果区渲染出的行数与所选步骤表一致、
 * 判定条文案正确、非法输入会报错。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));

let fails = 0;
function ok(cond, label, extra) {
    if (cond) console.log('OK   ' + label);
    else {
        fails++;
        console.log('FAIL ' + label + (extra ? '  -> ' + extra : ''));
    }
}

/* ---------- 最小 DOM 桩 ---------- */
class El {
    constructor(id) {
        this.id = id;
        this.innerHTML = '';
        this.textContent = '';
        this.hidden = false;
        this.value = '';
        this.listeners = {};
        this.style = {};
        this._checked = null;
    }
    addEventListener(type, fn) {
        this.listeners[type] = fn;
    }
    querySelector(sel) {
        return this._checked || null;
    }
    appendChild() {}
}

const nodes = {};
function node(id) {
    if (!nodes[id]) nodes[id] = new El(id);
    return nodes[id];
}

const radios = {
    STANDARD: Object.assign(new El('radio-standard'), { value: 'STANDARD', checked: true }),
    ELONGATED: Object.assign(new El('radio-elongated'), { value: 'ELONGATED', checked: false })
};

const form = node('calc-form');
form.querySelector = function (sel) {
    // 支持 input[name="shape"][value="ELONGATED"] 这种带值的查询
    const m = /value="([^"]+)"/.exec(sel || '');
    if (m) return radios[m[1]] || null;
    return radios.STANDARD.checked ? radios.STANDARD : radios.ELONGATED;
};

const URL_PARAMS = '?l=600&w=400&h=300&u=mm&kg=18.5&shape=STANDARD';

global.window = global;
global.location = { search: URL_PARAMS };
global.history = { replaceState() {} };
global.document = {
    readyState: 'complete',
    getElementById: node,
    addEventListener() {}
};
global.window.print = () => {};
global.fetch = function () {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve(data); }
    });
};
global.URLSearchParams = URLSearchParams;

require(path.join(ROOT, 'app.js'));

/* ---------- 断言 ---------- */
// girth = (400+300)*2 + 600 = 2000 mm = 78.74 in -> lt165；18.5 kg -> lt32
const expectedGroup = data.groups.find(g => g.id === 'lt165_STANDARD_lt32');

setTimeout(() => {
    const result = node('result');
    const verdict = node('verdict');
    const tbody = node('steps-body');

    ok(result.hidden === false, '有 URL 参数时自动出结果');
    ok(verdict.innerHTML.includes('78.7 in') || verdict.innerHTML.includes('78.74 in'),
        '判定条显示周长 78.7 in', verdict.innerHTML.slice(0, 120));
    ok(verdict.innerHTML.includes('标准箱型'), '判定条显示箱型');
    ok(verdict.innerHTML.includes('32 kg'), '判定条显示重量段', verdict.innerHTML.slice(0, 160));
    const rows = (tbody.innerHTML.match(/<tr>/g) || []).length;
    ok(rows === expectedGroup.rows.length, '表格行数 = 该组步骤数（' + expectedGroup.rows.length + '）', rows);
    ok(tbody.innerHTML.includes('棱 3-4'), '冲击部位译成中文（棱 3-4）');
    ok(tbody.innerHTML.includes('Edge 3-4'), '副行保留英文原文（原文逐字：Edge 3-4）');
    ok(node('table-title').textContent.includes(String(expectedGroup.rows.length)),
        '标题显示步骤数', node('table-title').textContent);
    ok(node('form-error').hidden === true, '合法输入不显示错误');

    // 非法输入
    node('dim-l').value = '-5';
    form.listeners.submit({ preventDefault() {} });
    ok(node('form-error').hidden === false, '负数输入会提示错误');
    ok(node('result').hidden === true, '出错时隐藏结果区');

    // 改回合法 + 换箱型 + 超过 165 in，验证换组
    node('dim-l').value = '1000';
    node('dim-w').value = '1000';
    node('dim-h').value = '1000';
    node('gross-weight').value = '95';
    radios.STANDARD.checked = false;
    radios.ELONGATED.checked = true;
    form.listeners.submit({ preventDefault() {} });
    const g2 = data.groups.find(g => g.id === 'gt165_ELONGATED_gt91');
    const rows2 = (node('steps-body').innerHTML.match(/<tr>/g) || []).length;
    ok(node('form-error').hidden === true && node('result').hidden === false, '切换输入后重新出结果');
    ok(rows2 === g2.rows.length, '大箱重货命中 gt165_ELONGATED_gt91（' + g2.rows.length + ' 步）', rows2);
    ok(node('verdict').innerHTML.includes('细长 / 扁平箱型'), '箱型切换生效');

    console.log('\nFAIL 合计: ' + fails);
    process.exit(fails === 0 ? 0 : 1);
}, 50);

