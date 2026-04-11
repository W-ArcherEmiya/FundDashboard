(() => {
    const app = window.FundDashboard = window.FundDashboard || {};

    app.state = {
        myFunds: JSON.parse(localStorage.getItem('myFunds_v2') || '[]'),
        cachedResults: [],
        activeTabId: localStorage.getItem('lastActiveTab') || 'tab-summary',
        currentActiveGroup: null,
        addModal: null,
        syncModal: null,
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
})();
