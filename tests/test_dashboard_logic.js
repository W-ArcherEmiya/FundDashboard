const assert = require('node:assert/strict');

const logic = require('../static/js/dashboard/logic.js');

function runTest(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

function assertAlmostEqual(actual, expected, epsilon = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

runTest('normalizeActiveTab falls back to summary when active group is missing', () => {
    const result = logic.normalizeActiveTab('tab-group-3', ['稳健', '高风险']);

    assert.deepEqual(result, {
        activeTabId: 'tab-summary',
        currentActiveGroup: null,
    });
});

runTest('buildDisplayData returns loading placeholders when cache is not ready', () => {
    const myFunds = [{ code: '000001', group: '稳健' }];
    const displayData = logic.buildDisplayData(myFunds, [], false);

    assert.equal(displayData[0].code, '000001');
    assert.equal(displayData[0].isLoading, true);
    assert.equal(displayData[0].valid, true);
});

runTest('buildDisplayData treats malformed cached snapshots as loading', () => {
    const myFunds = [{ code: '000001', shares: '10', cost: '1.2', group: '稳健' }];
    const displayData = logic.buildDisplayData(myFunds, [
        { code: '000001', group: '稳健', valid: true }
    ], false);

    assert.equal(displayData[0].code, '000001');
    assert.equal(displayData[0].isLoading, true);
    assert.equal(displayData[0].valid, true);
});

runTest('summarizeDisplayData aggregates totals and group profit', () => {
    const summary = logic.summarizeDisplayData([
        { valid: true, isLoading: false, estNav: 1.2, dailyProfit: 12, holdProfit: 20, totalAsset: 100, gztime: '2026-04-11 14:00', group: '稳健' },
        { valid: true, isLoading: false, estNav: 1.5, dailyProfit: -2, holdProfit: 5, totalAsset: 50, gztime: '实际净值 (04-11)', group: '高风险' },
        { valid: false, isLoading: false, dailyProfit: 999, holdProfit: 999, totalAsset: 999, gztime: '--', group: '忽略' },
        { valid: true, isLoading: false, gztime: '坏快照', group: '忽略' },
    ]);

    assert.equal(summary.totalDaily, 10);
    assert.equal(summary.totalHold, 25);
    assert.equal(summary.totalAssets, 150);
    assert.equal(summary.lastTime, '实际净值 (04-11)');
    assert.deepEqual(summary.groupStats, { '稳健': 12, '高风险': -2 });
});

runTest('buildFundResult prefers realtime estimate during daytime session', () => {
    const result = logic.buildFundResult(
        { code: '000001', shares: '10', cost: '1.2', group: '稳健' },
        { name: '基金A', latest: 1.1, prev: 1.0, dateMs: Date.UTC(2026, 3, 9, 16, 0, 0) },
        { name: '基金A', gsz: '1.15', gszzl: '4.55', gztime: '2026-04-11 14:35', dwjz: '1.10' }
    );

    assert.equal(result.valid, true);
    assert.equal(result.isActual, false);
    assert.equal(result.isBackup, false);
    assert.equal(result.estNav, 1.15);
    assertAlmostEqual(result.dailyProfit, 0.5);
    assertAlmostEqual(result.holdProfit, -1);
    assert.equal(result.totalAsset, 11.5);
});

runTest('buildFundResult falls back to actual settlement when realtime data is stale', () => {
    const result = logic.buildFundResult(
        { code: '000001', shares: '10', cost: '1.0', group: '稳健' },
        { name: '基金A', latest: 1.08, prev: 1.0, dateMs: Date.UTC(2026, 3, 11, 15, 0, 0) },
        { name: '基金A', gsz: '1.20', gszzl: '11.11', gztime: '2026-04-11 14:35', dwjz: '1.10' }
    );

    assert.equal(result.isActual, true);
    assert.equal(result.isBackup, false);
    assert.equal(result.gztime, '实际净值 (04-11)');
    assertAlmostEqual(result.dailyProfit, 0.8);
    assertAlmostEqual(result.holdProfit, 0.8);
});

runTest('buildFundResult marks backup mode when only historical settlement exists', () => {
    const result = logic.buildFundResult(
        { code: '007721', shares: '5', cost: '2', group: '美股' },
        { name: '基金B', latest: 1.5, prev: 1.4, dateMs: Date.UTC(2026, 3, 11, 15, 0, 0) },
        null
    );

    assert.equal(result.isActual, true);
    assert.equal(result.isBackup, true);
    assert.equal(result.name, '基金B');
    assert.equal(result.totalAsset, 7.5);
});

runTest('buildFundResult handles money funds with million-copy income', () => {
    const result = logic.buildFundResult(
        { code: '018092', shares: '878.73', cost: '0.9909', group: '稳健' },
        { name: '货币基金', latest: 1, prev: 1, dateMs: Date.UTC(2026, 5, 5, 15, 0, 0), isMoneyFund: true, millionIncome: 0.3414 },
        null
    );

    assert.equal(result.valid, true);
    assert.equal(result.isMoneyFund, true);
    assert.equal(result.estNav, 1);
    assert.equal(result.totalAsset, 878.73);
    assertAlmostEqual(result.dailyProfit, 0.03, 0.0001);
    assertAlmostEqual(result.holdProfit, 7.996443, 0.0001);
});

runTest('buildFundResult returns fallback realtime snapshot when historical data is unavailable', () => {
    const result = logic.buildFundResult(
        { code: '000003', shares: '8', cost: '1.1', group: '混合' },
        null,
        { name: '基金C', gsz: '1.25', gszzl: '2.5', gztime: '2026-04-11 13:00', dwjz: '1.20' }
    );

    assert.equal(result.isActual, false);
    assert.equal(result.isBackup, false);
    assertAlmostEqual(result.dailyProfit, 0.4);
    assertAlmostEqual(result.holdProfit, 0.8);
});

runTest('buildFundResult returns unavailable state when neither realtime nor historical data exists', () => {
    const result = logic.buildFundResult(
        { code: '007721', shares: '5', cost: '2', group: '美股' },
        null,
        null
    );

    assert.equal(result.valid, true);
    assert.equal(result.isUnavailable, true);
    assert.equal(result.gztime, '暂无盘中估算');
    assert.equal(result.name, '基金 007721');
});

console.log('All dashboard logic tests passed.');
