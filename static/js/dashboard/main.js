(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state } = app;
    const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

    document.addEventListener('DOMContentLoaded', async () => {
        state.addModal = new bootstrap.Modal(document.getElementById('addModal'));
        state.syncModal = new bootstrap.Modal(document.getElementById('syncModal'));
        state.importModal = new bootstrap.Modal(document.getElementById('importModal'));

        const savedSyncCode = localStorage.getItem('lastSyncCode');
        if (savedSyncCode) document.getElementById('syncCodeInput').value = savedSyncCode;

        const restoredFromCloud = savedSyncCode ? await app.data.autoRestoreCloudData(savedSyncCode) : false;
        if (!restoredFromCloud) {
            if (state.myFunds.length > 0) app.ui.renderUI(true);
            app.data.refreshNetworkData();
        }
        setInterval(() => app.data.refreshNetworkData({ allowQueue: false }), AUTO_REFRESH_INTERVAL_MS);
    });

    document.addEventListener('click', event => {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl) return;

        const { action, tabId, groupName, code, defaultGroup } = actionEl.dataset;
        if (action === 'select-group') event.preventDefault();

        switch (action) {
            case 'open-sync':
                app.data.openSyncModal();
                break;
            case 'open-import':
                app.ui.openImportModal();
                break;
            case 'upload-sync':
                app.data.uploadSyncData();
                break;
            case 'download-sync':
                app.data.downloadSyncData();
                break;
            case 'restore-sync':
                app.data.restoreLastSyncData();
                break;
            case 'export-analysis-csv':
                app.data.exportAnalysisCsv();
                break;
            case 'refresh-data':
                app.data.refreshNetworkData({ forceHist: true });
                break;
            case 'switch-tab':
                app.ui.switchTab(tabId, groupName);
                break;
            case 'switch-first-group':
                app.ui.switchToHoldings();
                break;
            case 'open-add':
                app.ui.openAddModal(defaultGroup);
                break;
            case 'open-edit':
                app.ui.openEditModal(code);
                break;
            case 'select-group':
                app.ui.selectGroup(groupName);
                break;
            case 'reset-import':
                app.ui.resetImportModal();
                break;
            case 'add-import-selected':
                app.ui.addImportSelected();
                break;
            case 'recalc-import-row':
                app.ui.recalculateImportCandidate(Number(actionEl.dataset.importIndex));
                break;
            case 'sort-group-list':
                app.ui.sortGroupList(actionEl.dataset.sortKey);
                break;
            case 'save-fund':
                app.ui.saveFund();
                break;
            case 'delete-fund':
                app.ui.deleteFund();
                break;
        }
    });

    document.addEventListener('change', event => {
        if (event.target.id === 'importImageInput') {
            const files = Array.from(event.target.files || []);
            app.ui.importFromScreenshot(files);
        }

        if (event.target.classList.contains('import-suggestion')) {
            const index = Number(event.target.dataset.importIndex);
            app.ui.applyImportSuggestion(index, event.target.value);
        }
    });

    document.addEventListener('toggle', event => {
        const fold = event.target;
        if (!(fold instanceof HTMLDetailsElement) || !fold.classList.contains('group-fold')) return;

        const groupName = fold.dataset.groupName;
        if (!groupName) return;

        const openGroups = new Set(state.summaryFoldOpenGroups || []);
        if (fold.open) openGroups.add(groupName);
        else openGroups.delete(groupName);

        state.summaryFoldOpenGroups = [...openGroups];
        app.persistSummaryFolds();
    }, true);
})();
