(function(root, factory) {
    const logic = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = logic;
    }

    const app = root.FundDashboard = root.FundDashboard || {};
    app.logic = logic;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    function getGroups(myFunds) {
        return [...new Set((myFunds || []).map(item => item.group || '默认分组'))];
    }

    function getImportCandidateReviewRank(candidate) {
        const hasCode = /^\d{6}$/.test(String(candidate && candidate.code || ''));
        if (!hasCode || candidate.unmatched) return 0;
        if (!candidate.shares || candidate.requiresShareReview) return 1;
        return 2;
    }

    function parseRequiredNumber(value) {
        if (value === '' || value === null || value === undefined) return NaN;
        return Number(value);
    }

    function evaluateExistingShareCalibration(input = {}) {
        const existingShares = parseRequiredNumber(input.existingShares);
        const proposedShares = parseRequiredNumber(input.proposedShares);
        const screenshotDailyProfit = parseRequiredNumber(input.screenshotDailyProfit);
        const marketDailyProfit = parseRequiredNumber(input.marketDailyProfit);

        const review = reason => ({
            status: 'review',
            shares: existingShares,
            previousShares: existingShares,
            proposedShares,
            requiresReview: true,
            reason
        });

        if (!Number.isFinite(existingShares) || existingShares <= 0) return review('invalid-existing-shares');
        if (!Number.isFinite(proposedShares) || proposedShares <= 0) return review('invalid-proposed-shares');

        const shareDeltaRatio = Math.abs(proposedShares - existingShares) / existingShares;
        if (shareDeltaRatio <= 0.0015) {
            return {
                status: 'aligned',
                shares: existingShares,
                previousShares: existingShares,
                proposedShares,
                shareDeltaRatio,
                requiresReview: false,
                reason: ''
            };
        }

        if (!Number.isFinite(screenshotDailyProfit) || !Number.isFinite(marketDailyProfit)) {
            return review('missing-daily-profit');
        }

        const expectedDailyProfit = marketDailyProfit * proposedShares / existingShares;
        const dailyDifference = Math.abs(expectedDailyProfit - screenshotDailyProfit);
        const dailyTolerance = Math.max(0.03, Math.abs(screenshotDailyProfit) * 0.015);
        const signMatches = Math.abs(screenshotDailyProfit) <= dailyTolerance
            || Math.abs(expectedDailyProfit) <= dailyTolerance
            || Math.sign(expectedDailyProfit) === Math.sign(screenshotDailyProfit);

        if (signMatches && dailyDifference <= dailyTolerance) {
            return {
                status: 'calibrated',
                shares: proposedShares,
                previousShares: existingShares,
                proposedShares,
                expectedDailyProfit,
                dailyDifference,
                dailyTolerance,
                shareDeltaRatio,
                requiresReview: false,
                reason: ''
            };
        }

        return {
            ...review('daily-profit-mismatch'),
            expectedDailyProfit,
            dailyDifference,
            dailyTolerance,
            shareDeltaRatio
        };
    }

    function sortImportCandidatesForReview(candidates) {
        return (candidates || [])
            .map((candidate, index) => ({ candidate, index }))
            .sort((left, right) => {
                const rankDelta = getImportCandidateReviewRank(left.candidate)
                    - getImportCandidateReviewRank(right.candidate);
                return rankDelta || left.index - right.index;
            })
            .map(entry => entry.candidate);
    }

    function isFiniteMetric(value) {
        return Number.isFinite(Number(value));
    }

    function hasCompleteDisplayMetrics(item) {
        return Boolean(
            item &&
            item.valid !== false &&
            !item.isLoading &&
            !item.isUnavailable &&
            isFiniteMetric(item.estNav) &&
            isFiniteMetric(item.dailyProfit) &&
            isFiniteMetric(item.holdProfit) &&
            isFiniteMetric(item.totalAsset)
        );
    }

    function getCloudSnapshotApplyDecision(cloudSyncDirty, incomingSnapshot, currentSnapshot) {
        if (cloudSyncDirty) return { apply: false, reason: 'local-changes' };

        const incomingCompleteCount = (incomingSnapshot || []).filter(hasCompleteDisplayMetrics).length;
        const currentCompleteCount = (currentSnapshot || []).filter(hasCompleteDisplayMetrics).length;
        if (incomingCompleteCount === 0 && currentCompleteCount > 0) {
            return { apply: false, reason: 'incoming-unavailable' };
        }
        return { apply: true, reason: '' };
    }

    function normalizeActiveTab(activeTabId, groups) {
        if (activeTabId === 'tab-summary') {
            return { activeTabId: 'tab-summary', currentActiveGroup: null };
        }

        const activeGroupIndex = parseInt(String(activeTabId || '').split('-')[2], 10);
        if (groups.length === 0 || Number.isNaN(activeGroupIndex) || !groups[activeGroupIndex]) {
            return { activeTabId: 'tab-summary', currentActiveGroup: null };
        }

        return {
            activeTabId,
            currentActiveGroup: groups[activeGroupIndex]
        };
    }

    function buildDisplayData(myFunds, cachedResults, isLoading) {
        return (myFunds || []).map((fund, index) => {
            if (isLoading) return { ...fund, isLoading: true, valid: true };

            const data = (cachedResults || [])[index];
            if (!data) return { ...fund, isLoading: true, valid: true };
            if (data.error || !data.valid) return { ...fund, valid: false };
            if (!data.isUnavailable && !hasCompleteDisplayMetrics(data)) {
                return { ...fund, isLoading: true, valid: true };
            }
            return data;
        });
    }

    function summarizeDisplayData(displayData) {
        let totalDaily = 0;
        let totalHold = 0;
        let totalAssets = 0;
        let lastTime = '--:--';
        let groupStats = {};

        (displayData || []).forEach(data => {
            if (hasCompleteDisplayMetrics(data)) {
                totalDaily += Number(data.dailyProfit);
                totalHold += Number(data.holdProfit);
                totalAssets += Number(data.totalAsset);

                if (lastTime === '--:--' || data.gztime.includes(':') || data.gztime.includes('更新') || data.gztime.includes('实际')) {
                    lastTime = data.gztime;
                }

                const groupName = data.group || '默认分组';
                if (!groupStats[groupName]) groupStats[groupName] = 0;
                groupStats[groupName] += data.dailyProfit;
            }
        });

        return { totalDaily, totalHold, totalAssets, lastTime, groupStats };
    }

    function getCurrentGroupItems(displayData, activeTabId, groups) {
        const currentGroupIndex = parseInt(String(activeTabId || '').split('-')[2], 10);
        const currentGroupName = groups[currentGroupIndex];
        const groupItems = (displayData || []).filter(item => (item.group || '默认分组') === currentGroupName);

        return { currentGroupName, groupItems };
    }

    function getBeijingDateParts(value) {
        const date = value instanceof Date ? value : new Date(value);
        const bjTime = new Date(date.getTime() + 8 * 3600 * 1000);
        return {
            year: bjTime.getUTCFullYear(),
            month: bjTime.getUTCMonth() + 1,
            day: bjTime.getUTCDate(),
            hour: bjTime.getUTCHours()
        };
    }

    function formatBeijingDate(parts) {
        return parts.year + '-' +
            String(parts.month).padStart(2, '0') + '-' +
            String(parts.day).padStart(2, '0');
    }

    function isSameDaySettlementEligible(actualDateStr, now = new Date()) {
        const nowParts = getBeijingDateParts(now);
        const todayStr = formatBeijingDate(nowParts);
        return actualDateStr !== todayStr || nowParts.hour >= 23;
    }

    function parseBrowserHistoryGlobals(source) {
        const name = String(source && source.name || '').trim();
        const income = source && source.millionCopiesIncome;
        const isMoneyFund = Boolean(source && source.isMoneyFund)
            || (Array.isArray(income) && income.length > 0);

        if (isMoneyFund && Array.isArray(income) && income.length > 0) {
            const latest = income[income.length - 1];
            const previous = income.length > 1 ? income[income.length - 2] : latest;
            if (!Array.isArray(latest) || !Number.isFinite(Number(latest[0]))) return null;
            return {
                name,
                latest: 1,
                prev: 1,
                dateMs: Number(latest[0]),
                isMoneyFund: true,
                millionIncome: Number(latest[1]) || 0,
                prevMillionIncome: Array.isArray(previous) ? Number(previous[1]) || 0 : 0
            };
        }

        const trend = source && source.netWorthTrend;
        if (!Array.isArray(trend) || trend.length === 0) return null;
        const latest = trend[trend.length - 1];
        const previous = trend.length > 1 ? trend[trend.length - 2] : latest;
        const latestNav = Number(latest && latest.y);
        const previousNav = Number(previous && previous.y);
        const dateMs = Number(latest && latest.x);
        if (!Number.isFinite(latestNav) || latestNav <= 0 || !Number.isFinite(dateMs)) return null;
        return {
            name,
            latest: latestNav,
            prev: Number.isFinite(previousNav) && previousNav > 0 ? previousNav : latestNav,
            dateMs,
            isMoneyFund: false
        };
    }

    function buildFundResult(fund, hist, rt, options = {}) {
        if (!hist && !rt) {
            return {
                code: fund.code,
                group: fund.group,
                name: `基金 ${fund.code}`,
                gztime: '暂无盘中估算',
                valid: true,
                isUnavailable: true,
                isActual: true,
                isBackup: true
            };
        }

        const shares = parseFloat(fund.shares) || 0;
        const cost = parseFloat(fund.cost) || 0;

        if (hist) {
            const actualParts = getBeijingDateParts(hist.dateMs);
            const actualDateStr = formatBeijingDate(actualParts);
            const settlementEligible = isSameDaySettlementEligible(actualDateStr, options.now || new Date());

            let currentNav;
            let prevNav;
            let rate;
            let isActual;
            let timeStr;

            if (hist.isMoneyFund) {
                const badgeDate = String(actualParts.month).padStart(2, '0') + '-' +
                    String(actualParts.day).padStart(2, '0');
                const millionIncome = Number(hist.millionIncome);
                const dailyProfit = Number.isFinite(millionIncome) ? (millionIncome * shares / 10000) : 0;

                return {
                    code: fund.code,
                    group: fund.group,
                    name: rt ? rt.name : hist.name,
                    estRate: 0,
                    estNav: 1,
                    dailyProfit,
                    holdProfit: cost > 0 ? (1 - cost) * shares : 0,
                    totalAsset: shares,
                    gztime: '\u8d27\u5e01\u6536\u76ca(' + badgeDate + ')',
                    isActual: true,
                    isBackup: !rt,
                    isMoneyFund: true,
                    valid: true
                };
            }

            const gzDateStr = rt && rt.gztime ? rt.gztime.split(' ')[0] : '';
            if (rt && (gzDateStr > actualDateStr || !settlementEligible)) {
                currentNav = parseFloat(rt.gsz);
                prevNav = settlementEligible ? hist.latest : hist.prev;
                rate = parseFloat(rt.gszzl);
                timeStr = rt.gztime;
                isActual = false;
            } else if (!settlementEligible) {
                currentNav = hist.prev;
                prevNav = hist.prev;
                rate = 0;
                timeStr = '等待正式净值';
                isActual = false;
            } else {
                currentNav = hist.latest;
                prevNav = hist.prev;
                rate = prevNav > 0 ? ((currentNav - prevNav) / prevNav * 100) : 0;
                const badgeDate = String(actualParts.month).padStart(2, '0') + '-' +
                    String(actualParts.day).padStart(2, '0');
                timeStr = '实际净值 (' + badgeDate + ')';
                isActual = true;
            }

            const holdNav = isActual ? currentNav : (settlementEligible ? hist.latest : hist.prev);

            return {
                code: fund.code,
                group: fund.group,
                name: rt ? rt.name : hist.name,
                estRate: rate,
                estNav: currentNav,
                dailyProfit: (currentNav - prevNav) * shares,
                holdProfit: cost > 0 ? (holdNav - cost) * shares : 0,
                totalAsset: currentNav * shares,
                gztime: timeStr,
                isActual,
                isBackup: !rt,
                valid: true
            };
        }

        const rtNav = parseFloat(rt.gsz);
        const previousNav = parseFloat(rt.dwjz);

        return {
            code: fund.code,
            group: fund.group,
            name: rt.name,
            estRate: parseFloat(rt.gszzl),
            estNav: rtNav,
            dailyProfit: (rtNav - previousNav) * shares,
            holdProfit: cost > 0 ? (previousNav - cost) * shares : 0,
            totalAsset: rtNav * shares,
            gztime: rt.gztime,
            isActual: false,
            isBackup: false,
            valid: true
        };
    }

    return {
        getGroups,
        getImportCandidateReviewRank,
        sortImportCandidatesForReview,
        evaluateExistingShareCalibration,
        hasCompleteDisplayMetrics,
        getCloudSnapshotApplyDecision,
        normalizeActiveTab,
        buildDisplayData,
        summarizeDisplayData,
        getCurrentGroupItems,
        parseBrowserHistoryGlobals,
        buildFundResult
    };
});
