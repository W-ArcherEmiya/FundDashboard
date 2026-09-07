(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { keys, read, readJson, write, writeJson } = app.storage;
    const isArray = Array.isArray;
    const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

    app.state = {
        myFunds: readJson(keys.funds, [], isArray),
        cachedResults: [],
        activeTabId: read(keys.activeTab, 'tab-summary'),
        currentActiveGroup: null,
        groupListSort: readJson(keys.groupListSort, { key: 'dailyProfit', direction: 'desc' }, isObject),
        summaryFoldOpenGroups: readJson(keys.summaryFolds, [], isArray),
        syncSnapshotOverrides: readJson(keys.syncSnapshotOverrides, {}, isObject),
        cloudSyncDirty: read(keys.cloudSyncDirty, 'false') === 'true',
        addModal: null,
        watchlistModal: null,
        watchlistSearchResult: null,
        watchlistSearchInFlight: false,
        syncModal: null,
        importModal: null,
        importCandidates: [],
        importAutoUpdatedCount: 0,
        importEditingIndex: null,
        importListScrollPosition: null,
        refreshInFlight: false,
        refreshPending: false,
        refreshPendingOptions: null,
        noticeTimer: null
    };

    app.persistFunds = (options = {}) => {
        writeJson(keys.funds, app.state.myFunds);
        app.state.cloudSyncDirty = options.synced !== true;
        write(keys.cloudSyncDirty, app.state.cloudSyncDirty);
    };

    app.markCloudSyncClean = () => {
        app.state.cloudSyncDirty = false;
        write(keys.cloudSyncDirty, false);
    };

    app.persistActiveTab = () => {
        write(keys.activeTab, app.state.activeTabId);
    };

    app.persistSummaryFolds = () => {
        writeJson(keys.summaryFolds, app.state.summaryFoldOpenGroups);
    };

    app.persistGroupListSort = () => {
        writeJson(keys.groupListSort, app.state.groupListSort);
    };

    app.persistSyncSnapshotOverrides = () => {
        writeJson(keys.syncSnapshotOverrides, app.state.syncSnapshotOverrides || {});
    };
})();
