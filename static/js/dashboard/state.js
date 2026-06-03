(() => {
    const app = window.FundDashboard = window.FundDashboard || {};

    app.state = {
        myFunds: JSON.parse(localStorage.getItem('myFunds_v2') || '[]'),
        cachedResults: [],
        activeTabId: localStorage.getItem('lastActiveTab') || 'tab-summary',
        currentActiveGroup: null,
        groupListSort: JSON.parse(localStorage.getItem('groupListSort_v1') || '{"key":"dailyProfit","direction":"desc"}'),
        summaryFoldOpenGroups: JSON.parse(localStorage.getItem('summaryFoldOpen_v1') || '[]'),
        syncSnapshotOverrides: JSON.parse(localStorage.getItem('syncSnapshotOverrides_v1') || '{}'),
        addModal: null,
        syncModal: null,
        importModal: null,
        importCandidates: [],
        importAutoUpdatedCount: 0,
        refreshInFlight: false,
        refreshPending: false,
        noticeTimer: null
    };

    app.persistFunds = () => {
        localStorage.setItem('myFunds_v2', JSON.stringify(app.state.myFunds));
    };

    app.persistActiveTab = () => {
        localStorage.setItem('lastActiveTab', app.state.activeTabId);
    };

    app.persistSummaryFolds = () => {
        localStorage.setItem('summaryFoldOpen_v1', JSON.stringify(app.state.summaryFoldOpenGroups));
    };

    app.persistGroupListSort = () => {
        localStorage.setItem('groupListSort_v1', JSON.stringify(app.state.groupListSort));
    };

    app.persistSyncSnapshotOverrides = () => {
        localStorage.setItem('syncSnapshotOverrides_v1', JSON.stringify(app.state.syncSnapshotOverrides || {}));
    };
})();
