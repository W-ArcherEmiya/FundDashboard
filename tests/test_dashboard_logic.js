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

runTest('sortImportCandidatesForReview puts unresolved rows first and keeps screenshot order', () => {
    const completeA = { code: '000001', shares: '100', name: '完整基金A' };
    const unmatchedA = { code: '', shares: '', name: '未匹配基金A', unmatched: true };
    const incomplete = { code: '000002', shares: '', name: '未反推份额' };
    const completeB = { code: '000003', shares: '200', name: '完整基金B' };
    const unmatchedB = { code: '', shares: '', name: '未匹配基金B', suggestions: [{ code: '000004' }] };

    const sorted = logic.sortImportCandidatesForReview([
        completeA,
        unmatchedA,
        incomplete,
        completeB,
        unmatchedB
    ]);

    assert.deepEqual(sorted, [unmatchedA, unmatchedB, incomplete, completeA, completeB]);
    assert.equal(logic.getImportCandidateReviewRank(unmatchedA), 0);
    assert.equal(logic.getImportCandidateReviewRank(incomplete), 1);
    assert.equal(logic.getImportCandidateReviewRank(completeA), 2);
});

runTest('sortImportCandidatesForReview puts share calibration reviews before complete rows', () => {
    const complete = { code: '000001', shares: '100', name: '完整基金' };
    const review = { code: '000002', shares: '200', name: '份额待确认', requiresShareReview: true };

    assert.deepEqual(logic.sortImportCandidatesForReview([complete, review]), [review, complete]);
    assert.equal(logic.getImportCandidateReviewRank(review), 1);
});

runTest('evaluateExistingShareCalibration corrects shares when screenshot daily profit agrees', () => {
    const result = logic.evaluateExistingShareCalibration({
        existingShares: 1335.78,
        proposedShares: 1317.49,
        screenshotDailyProfit: 71.67,
        marketDailyProfit: 72.67
    });

    assert.equal(result.status, 'calibrated');
    assert.equal(result.requiresReview, false);
    assert.equal(result.shares, 1317.49);
    assertAlmostEqual(result.expectedDailyProfit, 71.675, 0.01);
});

runTest('evaluateExistingShareCalibration preserves shares when daily profit disagrees', () => {
    const result = logic.evaluateExistingShareCalibration({
        existingShares: 1335.78,
        proposedShares: 1317.49,
        screenshotDailyProfit: 60,
        marketDailyProfit: 72.67
    });

    assert.equal(result.status, 'review');
    assert.equal(result.requiresReview, true);
    assert.equal(result.shares, 1335.78);
    assert.equal(result.reason, 'daily-profit-mismatch');
});

runTest('evaluateExistingShareCalibration requires review when daily profit is unavailable', () => {
    const result = logic.evaluateExistingShareCalibration({
        existingShares: 1000,
        proposedShares: 900,
        screenshotDailyProfit: '',
        marketDailyProfit: 12
    });

    assert.equal(result.status, 'review');
    assert.equal(result.requiresReview, true);
    assert.equal(result.shares, 1000);
    assert.equal(result.reason, 'missing-daily-profit');
});

runTest('evaluateExistingShareCalibration keeps nearly identical existing shares', () => {
    const result = logic.evaluateExistingShareCalibration({
        existingShares: 1000,
        proposedShares: 1001,
        screenshotDailyProfit: '',
        marketDailyProfit: ''
    });

    assert.equal(result.status, 'aligned');
    assert.equal(result.requiresReview, false);
    assert.equal(result.shares, 1000);
});

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

runTest('cloud snapshot response never overwrites unsynced local changes', () => {
    const decision = logic.getCloudSnapshotApplyDecision(
        true,
        [{ valid: true, estNav: 1.2, dailyProfit: 1, holdProfit: 2, totalAsset: 12 }],
        []
    );

    assert.deepEqual(decision, { apply: false, reason: 'local-changes' });
});

runTest('unavailable cloud response keeps the current complete snapshot', () => {
    const decision = logic.getCloudSnapshotApplyDecision(
        false,
        [{ valid: true, isUnavailable: true }],
        [{ valid: true, estNav: 1.2, dailyProfit: 1, holdProfit: 2, totalAsset: 12 }]
    );

    assert.deepEqual(decision, { apply: false, reason: 'incoming-unavailable' });
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

runTest('parseBrowserHistoryGlobals extracts regular NAV history', () => {
    const result = logic.parseBrowserHistoryGlobals({
        name: '测试债券C',
        isMoneyFund: false,
        netWorthTrend: [
            { x: 1785427200000, y: 1.0918 },
            { x: 1785686400000, y: 1.0919 }
        ]
    });

    assert.equal(result.name, '测试债券C');
    assert.equal(result.latest, 1.0919);
    assert.equal(result.prev, 1.0918);
    assert.equal(result.dateMs, 1785686400000);
    assert.equal(result.isMoneyFund, false);
});

runTest('parseBrowserHistoryGlobals extracts money fund income', () => {
    const result = logic.parseBrowserHistoryGlobals({
        name: '现金添利C',
        isMoneyFund: true,
        millionCopiesIncome: [
            [1785600000000, 0.5892],
            [1785686400000, 0.4438]
        ]
    });

    assert.equal(result.latest, 1);
    assert.equal(result.prev, 1);
    assert.equal(result.millionIncome, 0.4438);
    assert.equal(result.prevMillionIncome, 0.5892);
    assert.equal(result.isMoneyFund, true);
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

runTest('buildFundResult keeps same-day settlement as estimate before 23:00 Beijing time', () => {
    const result = logic.buildFundResult(
        { code: '000001', shares: '10', cost: '1.0', group: '稳健' },
        { name: '基金A', latest: 1.08, prev: 1.0, dateMs: Date.UTC(2026, 3, 11, 15, 0, 0) },
        { name: '基金A', gsz: '1.20', gszzl: '20.00', gztime: '2026-04-11 14:35', dwjz: '1.00' },
        { now: new Date(Date.UTC(2026, 3, 11, 14, 30, 0)) }
    );

    assert.equal(result.isActual, false);
    assert.equal(result.gztime, '2026-04-11 14:35');
    assert.equal(result.estNav, 1.2);
    assertAlmostEqual(result.dailyProfit, 2);
    assertAlmostEqual(result.holdProfit, 0);
});

runTest('buildFundResult accepts same-day settlement after 23:00 Beijing time', () => {
    const result = logic.buildFundResult(
        { code: '000001', shares: '10', cost: '1.0', group: '稳健' },
        { name: '基金A', latest: 1.08, prev: 1.0, dateMs: Date.UTC(2026, 3, 11, 15, 0, 0) },
        { name: '基金A', gsz: '1.20', gszzl: '20.00', gztime: '2026-04-11 14:35', dwjz: '1.00' },
        { now: new Date(Date.UTC(2026, 3, 11, 15, 0, 0)) }
    );

    assert.equal(result.isActual, true);
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
