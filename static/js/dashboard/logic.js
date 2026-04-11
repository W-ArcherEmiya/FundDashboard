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
            if (data.valid && !data.isLoading && !data.isUnavailable) {
                totalDaily += data.dailyProfit;
                totalHold += data.holdProfit;
                totalAssets += data.totalAsset;

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

    function buildFundResult(fund, hist, rt) {
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
            const bjTime = new Date(hist.dateMs + 8 * 3600 * 1000);
            const actualDateStr = bjTime.getUTCFullYear() + '-' +
                String(bjTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
                String(bjTime.getUTCDate()).padStart(2, '0');

            let currentNav;
            let prevNav;
            let rate;
            let isActual;
            let timeStr;

            const gzDateStr = rt && rt.gztime ? rt.gztime.split(' ')[0] : '';
            if (rt && gzDateStr > actualDateStr) {
                currentNav = parseFloat(rt.gsz);
                prevNav = hist.latest;
                rate = parseFloat(rt.gszzl);
                timeStr = rt.gztime;
                isActual = false;
            } else {
                currentNav = hist.latest;
                prevNav = hist.prev;
                rate = prevNav > 0 ? ((currentNav - prevNav) / prevNav * 100) : 0;
                const badgeDate = String(bjTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
                    String(bjTime.getUTCDate()).padStart(2, '0');
                timeStr = '实际净值 (' + badgeDate + ')';
                isActual = true;
            }

            return {
                code: fund.code,
                group: fund.group,
                name: rt ? rt.name : hist.name,
                estRate: rate,
                estNav: currentNav,
                dailyProfit: (currentNav - prevNav) * shares,
                holdProfit: cost > 0 ? (currentNav - cost) * shares : 0,
                totalAsset: currentNav * shares,
                gztime: timeStr,
                isActual,
                isBackup: !rt,
                valid: true
            };
        }

        return {
            code: fund.code,
            group: fund.group,
            name: rt.name,
            estRate: parseFloat(rt.gszzl),
            estNav: parseFloat(rt.gsz),
            dailyProfit: (parseFloat(rt.gsz) - parseFloat(rt.dwjz)) * shares,
            holdProfit: cost > 0 ? (parseFloat(rt.gsz) - cost) * shares : 0,
            totalAsset: parseFloat(rt.gsz) * shares,
            gztime: rt.gztime,
            isActual: false,
            isBackup: false,
            valid: true
        };
    }

    return {
        getGroups,
        normalizeActiveTab,
        buildDisplayData,
        summarizeDisplayData,
        getCurrentGroupItems,
        buildFundResult
    };
});
