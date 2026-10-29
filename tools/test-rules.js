#!/usr/bin/env node
/**
 * 规则与数据自测：node tools/test-rules.js
 *
 * 覆盖：
 *  1. data.json 里 14 组是否齐全、id 是否唯一
 *  2. 每组是否都能被一组输入命中（判定链路可走通）
 *  3. 边界值：周长 165 in 归「大于」一侧；32/45/27/91 kg 上限不含
 *  4. 每个单元格文本都有中文译法（不出现空字符串）
 *  5. data.json 引用的图片文件都存在
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ISTA = require(path.join(ROOT, 'app.js'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));

let fails = 0;
function ok(cond, label, extra) {
    if (cond) {
        console.log('OK   ' + label);
    } else {
        fails++;
        console.log('FAIL ' + label + (extra ? '  -> ' + extra : ''));
    }
}

/* 1. 14 组齐全、id 唯一 */
const expected = [
    'lt165_STANDARD_lt32', 'lt165_STANDARD_32to45', 'lt165_STANDARD_gt45',
    'lt165_ELONGATED_lt32', 'lt165_ELONGATED_32to45', 'lt165_ELONGATED_gt45',
    'gt165_STANDARD_lt27', 'gt165_STANDARD_27to45', 'gt165_STANDARD_45to91', 'gt165_STANDARD_gt91',
    'gt165_ELONGATED_lt27', 'gt165_ELONGATED_27to45', 'gt165_ELONGATED_45to91', 'gt165_ELONGATED_gt91'
];
const ids = data.groups.map(g => g.id);
ok(data.groups.length === 14, '共 14 组步骤表', data.groups.length);
ok(new Set(ids).size === ids.length, 'id 无重复');
expected.forEach(id => ok(ids.includes(id), '存在 ' + id));

/* 2. 每组都能被输入命中 */
const groups = {};
data.groups.forEach(g => { groups[g.id] = g; });
const DIMS_LT = [200, 200, 200];   // 周长 1000 mm ≈ 39.4 in
const DIMS_GT = [1000, 1000, 1000]; // 周长 5000 mm ≈ 196.9 in
const probes = [
    ['lt165', 'STANDARD', 10, 'lt32'], ['lt165', 'STANDARD', 32, '32to45'], ['lt165', 'STANDARD', 45, 'gt45'],
    ['lt165', 'ELONGATED', 10, 'lt32'], ['lt165', 'ELONGATED', 32, '32to45'], ['lt165', 'ELONGATED', 45, 'gt45'],
    ['gt165', 'STANDARD', 10, 'lt27'], ['gt165', 'STANDARD', 27, '27to45'],
    ['gt165', 'STANDARD', 45, '45to91'], ['gt165', 'STANDARD', 91, 'gt91'],
    ['gt165', 'ELONGATED', 10, 'lt27'], ['gt165', 'ELONGATED', 27, '27to45'],
    ['gt165', 'ELONGATED', 45, '45to91'], ['gt165', 'ELONGATED', 91, 'gt91']
];
probes.forEach(([side, shape, kg, bandExpected]) => {
    const dims = side === 'gt165' ? DIMS_GT : DIMS_LT;
    const girth = ISTA.girthMm(dims[0], dims[1], dims[2]);
    const inch = girth / ISTA.MM_PER_IN;
    const sideGot = ISTA.girthSide(inch);
    const bandGot = ISTA.weightBandFor(data.weights, kg, sideGot);
    const id = ISTA.pickGroupId(sideGot, shape, bandGot);
    ok(sideGot === side && bandGot === bandExpected && !!groups[id],
        `输入 ${dims.join('x')} mm / ${kg} kg / ${shape} -> ${id}`);
});

/* 3. 边界 */
ok(ISTA.girthSide(165) === 'gt165', '周长正好 165 in 归入「大于 165 in」');
ok(ISTA.girthSide(164.999) === 'lt165', '周长 164.999 in 归入「小于」');
ok(ISTA.weightBandFor(data.weights, 31.99, 'lt165') === 'lt32', '31.99 kg -> <32 kg');
ok(ISTA.weightBandFor(data.weights, 32, 'lt165') === '32to45', '32 kg -> 32–45 kg 段');
ok(ISTA.weightBandFor(data.weights, 44.99, 'lt165') === '32to45', '44.99 kg -> 32–45 kg 段');
ok(ISTA.weightBandFor(data.weights, 45, 'lt165') === 'gt45', '45 kg -> >45 kg 段');
ok(ISTA.weightBandFor(data.weights, 26.99, 'gt165') === 'lt27', '26.99 kg -> <27 kg');
ok(ISTA.weightBandFor(data.weights, 27, 'gt165') === '27to45', '27 kg -> 27–45 kg 段');
ok(ISTA.weightBandFor(data.weights, 44.99, 'gt165') === '27to45', '44.99 kg -> 27–45 kg 段');
ok(ISTA.weightBandFor(data.weights, 45, 'gt165') === '45to91', '45 kg -> 45–91 kg 段');
ok(ISTA.weightBandFor(data.weights, 90.99, 'gt165') === '45to91', '90.99 kg -> 45–91 kg 段');
ok(ISTA.weightBandFor(data.weights, 91, 'gt165') === 'gt91', '91 kg -> >91 kg 段');

/* 4. 每个单元格都有中文 */
let cells = 0;
let emptyZh = [];
let untranslated = [];
const SKIP = /^[\d.\s]+mm|^\(?[\d.\s]+mm/;
data.groups.forEach(g => {
    g.rows.forEach(r => {
        ['type', 'height', 'impact'].forEach(f => {
            cells++;
            const t = ISTA.translate(r[f]);
            if (!t.zh) emptyZh.push(g.source + ' ' + f + ' ' + JSON.stringify(r[f]));
            // 英文原文应保留：中文里不含英文单词则要求 zh 是译法或原值
            if (t.zh === r[f] && /[A-Za-z]{3,}/.test(r[f]) && !SKIP.test(r[f])) {
                untranslated.push(g.source + ' ' + f + ' ' + JSON.stringify(r[f]));
            }
        });
    });
});
ok(emptyZh.length === 0, '所有单元格都有显示文本（' + cells + ' 个）', emptyZh.slice(0, 3).join(' | '));
ok(untranslated.length === 0, '所有带英文的单元格都已译成中文（副行保留英文）',
    untranslated.slice(0, 5).join(' | '));

/* 5. 图片存在 */
const missing = [];
data.groups.forEach(g => {
    g.rows.concat(g.notes).forEach(r => {
        (r.images || []).forEach(src => {
            const p = path.join(ROOT, decodeURIComponent(src));
            if (!fs.existsSync(p)) missing.push(src);
        });
    });
});
ok(missing.length === 0, 'data.json 引用的图片都存在（' + data.usedImages.length + ' 张）', missing.join(', '));

console.log('\nFAIL 合计: ' + fails);
process.exit(fails === 0 ? 0 : 1);
