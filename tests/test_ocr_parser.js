const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync('static/js/dashboard/ocr.js', 'utf8');
const context = { console, window: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(code, context);

const app = context.FundDashboard || context.window.FundDashboard;
const ocr = app.ocr;

function runTest(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

function decodeText(base64) {
    return Buffer.from(base64, 'base64').toString('utf8');
}

runTest('parseAlipayFundText extracts generic asset fields from detail screenshot text', () => {
    const detailText = decodeText(
        'MTE6NDUKMDAK6LWE5Lqn6K+m5oOFCkFJ5YaZ56yU6K6w5b6X6buE6YeR56WoCueos+WBpeeQhui0ouWFiOaxgueos+WGjeaxgui1mgrlmInlrp7lpJrliKnmlLbnm4rlgLrliLhDCuivpuaDhQowMTYzNjfkuK3po47pmakK6YeR6aKdKOWFgykKMiwzMzIuMDYK5pio5pel5pS255uKKOWFgynikaAK5oyB5pyJ5pS255uKKOWFgynikaAK5oyB5pyJ5pS255uK546H4pGgCisxNS45NgorMzMyLjA2CisxNi42MCUK5oyB5pyJ6YeR6aKdMiwzMzIuMDYK5b6F56Gu6K6k6YeR6aKdMC4wMArmjIHku5PmiJDmnKzku7cwLjg4OTYK5oyB5pyJ5Lu96aKdMiwyNDguMjAK5pel5rao5bmFKzAuNjklCuWfuumHkeWHgOWAvCAxLjAzNzMoMDYtMTcpCuecgeW/g+aKlei1hArnm64K5pS255uK5piO57uGCuS6pOaYk+iusOW9lQrmiJHnmoTlrprmipUK57Sv6K6h55uI5LqPCuS4mue7qei1sOWKvwrvvInntK/orqHmlLbnm4rvvJorMzMyLjA2CjMzMi4wNgozMzYuMDAKMzEyLjAwCjI4OC4wMAoyNjQuMDAKVgrovazmjaIK5Y2W5Ye6CuWumuaKlQrkubDlhaUK6K6o6K665Yy6CuiviuWfug=='
    );

    const parsed = ocr.parseAlipayFundText(detailText, []);

    assert.equal(parsed.code, '016367');
    assert.equal(parsed.matchedName, '嘉实多利收益债券C');
    assert.equal(parsed.amount, '2332.06');
    assert.equal(parsed.shares, '2248.2');
    assert.equal(parsed.cost, '0.8896');
    assert.equal(parsed.holdProfit, '332.06');
    assert.equal(parsed.dailyProfit, '15.96');
    assert.equal(parsed.nav, '1.0373');
    assert.equal(parsed.rate, '16.6');
    assert.equal(parsed.candidates.length, 1);
    assert.equal(parsed.candidates[0].source, 'fields');
});

runTest('layout parser keeps rows when a plus sign or fund name is missing', () => {
    const block = (text, left, top, right, bottom) => ({ text, left, top, right, bottom });
    const blocks = [
        block('名称', 50, 40, 130, 80),
        block('金额/昨日收益', 400, 40, 610, 80),
        block('持有收益/率', 700, 40, 870, 80),
        block('测试稳健债券C', 50, 120, 300, 160),
        block('1,000.00', 430, 120, 570, 160),
        block('+1.20', 450, 175, 540, 205),
        block('12.34', 730, 120, 830, 160),
        block('+1.25%', 730, 175, 840, 205),
        block('500.00', 430, 270, 560, 310),
        block('+0.10', 450, 325, 540, 355),
        block('-8.00', 730, 270, 830, 310),
        block('-1.57%', 730, 325, 840, 355)
    ];
    const catalog = [{
        code: '000001',
        name: '测试稳健债券C',
        type: '债券型',
        normalizedName: '测试稳健债券C'
    }];

    const candidates = ocr.findFundCandidates('', catalog, blocks);

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].code, '000001');
    assert.equal(candidates[0].holdProfit, '12.34');
    assert.equal(candidates[1].code, '');
    assert.equal(candidates[1].amount, '500');
    assert.equal(candidates[1].holdProfit, '-8');
    assert.equal(candidates[1].unmatched, true);
});

console.log('All OCR parser tests passed.');
