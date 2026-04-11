(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state, utils, logic } = app;

    function showNotice(message, tone = 'info', timeoutMs = 3000) {
        const area = document.getElementById('noticeArea');
        if (!area) return;

        area.innerHTML = `<div class="notice-banner notice-${tone}">${utils.escapeHtml(message)}</div>`;

        if (state.noticeTimer) {
            clearTimeout(state.noticeTimer);
            state.noticeTimer = null;
        }

        if (timeoutMs > 0) {
            state.noticeTimer = setTimeout(() => {
                area.innerHTML = '';
                state.noticeTimer = null;
            }, timeoutMs);
        }
    }

    function renderUI(isLoading = false) {
        const groups = logic.getGroups(state.myFunds);
        const tabContainer = document.getElementById('fundTabs');
        const normalizedTab = logic.normalizeActiveTab(state.activeTabId, groups);

        if (normalizedTab.activeTabId !== state.activeTabId || normalizedTab.currentActiveGroup !== state.currentActiveGroup) {
            state.activeTabId = normalizedTab.activeTabId;
            state.currentActiveGroup = normalizedTab.currentActiveGroup;
            app.persistActiveTab();
        }

        let tabsHtml = `<li class="nav-item"><button class="nav-link ${state.activeTabId === 'tab-summary' ? 'active' : ''}" data-action="switch-tab" data-tab-id="tab-summary">概览</button></li>`;
        groups.forEach((group, index) => {
            const tabId = `tab-group-${index}`;
            tabsHtml += `<li class="nav-item"><button class="nav-link ${state.activeTabId === tabId ? 'active' : ''}" data-action="switch-tab" data-tab-id="${utils.escapeHtml(tabId)}" data-group-name="${utils.escapeHtml(group)}">${utils.escapeHtml(group)}</button></li>`;
        });

        tabContainer.innerHTML = tabsHtml;
        const contentArea = document.getElementById('contentArea');
        contentArea.innerHTML = generateCurrentTabContent(groups, isLoading);
    }

    function switchTab(tabId, groupName) {
        state.activeTabId = tabId;
        state.currentActiveGroup = groupName || null;
        app.persistActiveTab();
        renderUI(false);
    }

    function generateCurrentTabContent(groups, isLoading) {
        const displayData = logic.buildDisplayData(state.myFunds, state.cachedResults, isLoading);

        if (state.activeTabId === 'tab-summary') {
            if (state.myFunds.length === 0) {
                const savedSyncCode = localStorage.getItem('lastSyncCode');
                const restoreAction = savedSyncCode
                    ? `<button class="empty-state-secondary" data-action="restore-sync">从云端恢复</button>`
                    : '';

                return `
                <div class="dashboard-card empty-state">
                    <div class="empty-state-title">还没有持仓</div>
                    <p class="empty-state-desc">先添加一只基金，之后页面会自动拉取估算净值、计算盈亏，并支持同步到其他设备。</p>
                    <div class="empty-state-actions">
                        <button class="empty-state-action" data-action="open-add">添加第一笔资产</button>
                        ${restoreAction}
                    </div>
                </div>`;
            }

            const { totalDaily, totalHold, totalAssets, lastTime, groupStats } = logic.summarizeDisplayData(displayData);

            let groupHtml = '';
            for (const [groupName, profit] of Object.entries(groupStats)) {
                groupHtml += `<div class="g-row"><span class="g-name">${utils.escapeHtml(groupName)}</span><span class="g-val ${utils.getColorClass(profit)}">${utils.formatNumber(profit, true)}</span></div>`;
            }

            return `
            <div class="dashboard-card">
                <div class="dashboard-label">总资产</div>
                <div class="dashboard-main-num">¥${utils.formatNumber(totalAssets, false)}</div>
                <hr class="card-divider">
                <div class="stat-grid">
                    <div class="stat-item">
                        <div class="stat-label">当日盈亏</div>
                        <div class="stat-val ${utils.getColorClass(totalDaily)}">${utils.formatNumber(totalDaily, true)}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">持有盈亏</div>
                        <div class="stat-val ${utils.getColorClass(totalHold)}">${utils.formatNumber(totalHold, true)}</div>
                    </div>
                </div>
                <div class="group-breakdown">
                    <div class="group-breakdown-title">分组盈亏分布</div>
                    <div class="group-list">${groupHtml}</div>
                </div>
                <div class="update-time">状态追踪: ${lastTime}</div>
            </div>`;
        }

        const { currentGroupName, groupItems } = logic.getCurrentGroupItems(displayData, state.activeTabId, groups);

        if (groupItems.length === 0) {
            return `
            <div class="dashboard-card empty-state">
                <div class="empty-state-title">${utils.escapeHtml(currentGroupName || '默认分组')}</div>
                <p class="empty-state-desc">这个分组里还没有资产，可以直接新增到当前分组。</p>
                <button class="empty-state-action" data-action="open-add" data-default-group="${utils.escapeHtml(currentGroupName || '默认分组')}">添加资产</button>
            </div>`;
        }

        let html = '';
        groupItems.forEach(item => {
            if (item.isLoading) {
                html += `<div class="fund-item fund-item-loading"><span class="spinner-border spinner-border-sm text-primary"></span><span class="loading-text">加载中...</span></div>`;
                return;
            }

            if (!item.valid) {
                html += `<div class="fund-item fund-item-error" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}"><div class="f-name danger-text">加载失败 ${utils.escapeHtml(item.code)}</div></div>`;
                return;
            }

            const rateClass = item.estRate > 0 ? 'bg-up' : (item.estRate < 0 ? 'bg-down' : 'bg-flat');
            const badgeText = (item.isActual ? '实 ' : '估 ') + utils.formatNumber(item.estRate, true) + '%';
            const itemClass = item.isBackup ? 'item-backup' : '';

            html += `
            <div class="fund-item ${itemClass}" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                <div class="f-header">
                    <div class="f-header-main">
                        <span class="f-name">${utils.escapeHtml(item.name)}</span>
                        <span class="f-code">${utils.escapeHtml(item.code)}</span>
                    </div>
                    <div class="rate-val ${rateClass}">${badgeText}</div>
                </div>
                <div class="f-data-grid">
                    <div class="text-start">
                        <div class="data-label">${item.isActual ? '实际净值' : '估算净值'}</div>
                        <div class="data-val">${item.estNav.toFixed(4)}</div>
                    </div>
                    <div class="text-center">
                        <div class="data-label">${item.isActual ? '当日(实)' : '当日(估)'}</div>
                        <div class="data-val ${utils.getColorClass(item.dailyProfit)}">${utils.formatNumber(item.dailyProfit, true)}</div>
                    </div>
                    <div class="text-center">
                        <div class="data-label">持有</div>
                        <div class="data-val ${utils.getColorClass(item.holdProfit)}">${utils.formatNumber(item.holdProfit, true)}</div>
                    </div>
                    <div class="text-end">
                        <div class="data-label">总金额</div>
                        <div class="data-val">${utils.formatNumber(item.totalAsset, false)}</div>
                    </div>
                </div>
            </div>`;
        });

        html += `<button class="btn btn-add-group w-100 mt-2 mb-4" data-action="open-add" data-default-group="${utils.escapeHtml(currentGroupName)}">+ 添加资产到 ${utils.escapeHtml(currentGroupName)}</button>`;
        return html;
    }

    function openAddModal(defaultGroup) {
        document.getElementById('fundForm').reset();
        document.getElementById('inputGroup').value = defaultGroup || state.currentActiveGroup || '默认分组';
        document.getElementById('editIndex').value = '-1';
        document.getElementById('btnDelete').classList.add('d-none');
        updateDropdownList();
        state.addModal.show();
    }

    function openEditModal(code) {
        const index = state.myFunds.findIndex(fund => fund.code === code);
        if (index === -1) return;

        const fund = state.myFunds[index];
        document.getElementById('inputCode').value = fund.code;
        document.getElementById('inputShares').value = fund.shares;
        document.getElementById('inputCost').value = fund.cost;
        document.getElementById('inputGroup').value = fund.group || '默认分组';
        document.getElementById('editIndex').value = index;
        document.getElementById('btnDelete').classList.remove('d-none');
        updateDropdownList();
        state.addModal.show();
    }

    function updateDropdownList() {
        const list = document.getElementById('groupDropdownList');
        const groups = new Set(state.myFunds.map(fund => fund.group || '默认分组'));
        let html = '';

        if (groups.size === 0) {
            html = '<li><span class="dropdown-item text-muted">暂无分组</span></li>';
        } else {
            groups.forEach(group => {
                html += `<li><a class="dropdown-item dropdown-item-clean" href="#" data-action="select-group" data-group-name="${utils.escapeHtml(group)}">${utils.escapeHtml(group)}</a></li>`;
            });
        }

        list.innerHTML = html;
    }

    function selectGroup(value) {
        document.getElementById('inputGroup').value = value;
    }

    function saveFund() {
        const code = document.getElementById('inputCode').value;
        const shares = document.getElementById('inputShares').value;
        const cost = document.getElementById('inputCost').value;
        const group = document.getElementById('inputGroup').value || '默认分组';
        const index = parseInt(document.getElementById('editIndex').value, 10);

        if (code.length !== 6) {
            showNotice('请输入 6 位基金代码', 'error');
            return;
        }

        const newFund = { code, shares, cost, group };
        if (index === -1) {
            if (state.myFunds.some(fund => fund.code === code)) {
                showNotice('该基金代码已存在', 'error');
                return;
            }
            state.myFunds.push(newFund);
        } else {
            state.myFunds[index] = newFund;
        }

        app.persistFunds();
        state.addModal.hide();
        renderUI(true);
        app.data.refreshNetworkData();
    }

    function deleteFund() {
        if (confirm('确定删除该资产？')) {
            state.myFunds.splice(document.getElementById('editIndex').value, 1);
            app.persistFunds();
            state.addModal.hide();
            renderUI(true);
            app.data.refreshNetworkData();
        }
    }

    app.ui = {
        renderUI,
        showNotice,
        switchTab,
        openAddModal,
        openEditModal,
        selectGroup,
        saveFund,
        deleteFund
    };
})();
