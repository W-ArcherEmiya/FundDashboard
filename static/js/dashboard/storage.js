(function(root, factory) {
    let localStorage = null;
    try {
        localStorage = root.localStorage;
    } catch {
        // Some privacy modes expose localStorage but reject access to it.
    }
    const storage = factory(localStorage);

    if (typeof module === 'object' && module.exports) {
        module.exports = { createStorage: factory };
    }

    const app = root.FundDashboard = root.FundDashboard || {};
    app.storage = storage;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(localStorage) {
    const keys = Object.freeze({
        funds: 'myFunds_v2',
        activeTab: 'lastActiveTab',
        groupListSort: 'groupListSort_v1',
        summaryFolds: 'summaryFoldOpen_v1',
        syncSnapshotOverrides: 'syncSnapshotOverrides_v1',
        cloudSyncDirty: 'cloudSyncDirty_v1'
    });

    function read(key, fallback = null) {
        try {
            const value = localStorage && localStorage.getItem(key);
            return value === null || value === undefined ? fallback : value;
        } catch {
            return fallback;
        }
    }

    function readJson(key, fallback, isValid = () => true) {
        try {
            const value = JSON.parse(read(key, ''));
            return isValid(value) ? value : fallback;
        } catch {
            return fallback;
        }
    }

    function write(key, value) {
        try {
            if (!localStorage) return false;
            localStorage.setItem(key, String(value));
            return true;
        } catch {
            return false;
        }
    }

    function writeJson(key, value) {
        try {
            return write(key, JSON.stringify(value));
        } catch {
            return false;
        }
    }

    return { keys, read, readJson, write, writeJson };
});
