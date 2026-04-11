(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state } = app;

    document.addEventListener('DOMContentLoaded', () => {
        state.addModal = new bootstrap.Modal(document.getElementById('addModal'));
        state.syncModal = new bootstrap.Modal(document.getElementById('syncModal'));

        const savedSyncCode = localStorage.getItem('lastSyncCode');
        if (savedSyncCode) document.getElementById('syncCodeInput').value = savedSyncCode;

        if (state.myFunds.length > 0) app.ui.renderUI(true);
        app.data.refreshNetworkData();
        setInterval(app.data.refreshNetworkData, 60000);
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
            case 'upload-sync':
                app.data.uploadSyncData();
                break;
            case 'download-sync':
                app.data.downloadSyncData();
                break;
            case 'switch-tab':
                app.ui.switchTab(tabId, groupName);
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
            case 'save-fund':
                app.ui.saveFund();
                break;
            case 'delete-fund':
                app.ui.deleteFund();
                break;
        }
    });
})();
