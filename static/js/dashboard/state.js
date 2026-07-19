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
        cloudSyncDirty: localStorage.getItem('cloudSyncDirty_v1') === 'true',
        addModal: null,
        syncModal: null,
        importModal: null,
        importCandidates: [],
        importAutoUpdatedCount: 0,
        importEditingIndex: null,
        refreshInFlight: false,
        refreshPending: false,
        refreshPendingOptions: null,
        noticeTimer: null
    };

    app.persistFunds = (options = {}) => {
        localStorage.setItem('myFunds_v2', JSON.stringify(app.state.myFunds));
        app.state.cloudSyncDirty = options.synced !== true;
        localStorage.setItem('cloudSyncDirty_v1', app.state.cloudSyncDirty ? 'true' : 'false');
    };

    app.markCloudSyncClean = () => {
        app.state.cloudSyncDirty = false;
        localStorage.setItem('cloudSyncDirty_v1', 'false');
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
