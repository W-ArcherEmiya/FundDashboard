(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state, utils, logic } = app;
    const DISTRIBUTION_TONES = ['tone-0', 'tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5'];

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

    function renderAmountText(value, options = {}) {
        const { forceSign = false, currency = false, compact = true } = options;
        const fullText = utils.formatAmount(value, { forceSign, compact: false });
        const compactText = utils.formatAmount(value, { forceSign, compact });
        const displayText = currency ? `¥${compactText}` : compactText;
        const titleText = currency ? `¥${fullText}` : fullText;

        return `<span class="num-fit" title="${utils.escapeHtml(titleText)}">${utils.escapeHtml(displayText)}</span>`;
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

        let tabsHtml = `
            <li class="nav-item">
                <button class="nav-link ${state.activeTabId === 'tab-summary' ? 'active' : ''}" data-action="switch-tab" data-tab-id="tab-summary">
                    <span class="nav-link-text">概览</span>
                </button>
            </li>`;

        groups.forEach((group, index) => {
            const tabId = `tab-group-${index}`;
            tabsHtml += `
                <li class="nav-item">
                    <button class="nav-link ${state.activeTabId === tabId ? 'active' : ''}" data-action="switch-tab" data-tab-id="${utils.escapeHtml(tabId)}" data-group-name="${utils.escapeHtml(group)}">
                        <span class="nav-link-text">${utils.escapeHtml(group)}</span>
                    </button>
                </li>`;
        });

        tabContainer.innerHTML = tabsHtml;
        document.getElementById('contentArea').innerHTML = generateCurrentTabContent(groups, isLoading);
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
            return renderSummaryTab(displayData, groups);
        }

        return renderGroupTab(displayData, groups);
    }

    function renderSummaryTab(displayData, groups) {
        if (state.myFunds.length === 0) {
            const savedSyncCode = localStorage.getItem('lastSyncCode');
            const restoreAction = savedSyncCode
                ? `<button class="action-btn action-btn-secondary" data-action="restore-sync">从云端恢复</button>`
                : '';

            return `
                <section class="page-shell page-shell-summary">
                    <div class="panel empty-state">
                        <div class="empty-illustration" aria-hidden="true">
                            <span class="empty-illustration-card"></span>
                            <span class="empty-illustration-chip"></span>
                            <span class="empty-illustration-line empty-illustration-line-long"></span>
                            <span class="empty-illustration-line"></span>
                        </div>
                        <div class="empty-state-title">还没有持仓</div>
                        <p class="empty-state-desc">添加基金后，这里会自动汇总资产、分组表现和当日盈亏。你也可以用同步码把数据恢复到当前设备。</p>
                        <div class="empty-state-actions">
                            <button class="action-btn action-btn-primary" data-action="open-add">添加第一笔资产</button>
                            ${restoreAction}
                        </div>
                    </div>
                </section>`;
        }

        const { totalDaily, totalHold, totalAssets, lastTime, groupStats } = logic.summarizeDisplayData(displayData);
        const distribution = buildAssetDistribution(displayData);
        const settledCount = displayData.filter(item => !item.isLoading).length;
        const unavailableCount = displayData.filter(item => item.isUnavailable).length;
        const groupRows = renderSummaryGroupFolds(displayData, distribution, groupStats);

        const stripSegments = distribution.map((item, index) => {
            const tone = DISTRIBUTION_TONES[index % DISTRIBUTION_TONES.length];
            return `<span class="asset-strip-segment ${tone}" style="width:${item.percent.toFixed(2)}%"></span>`;
        }).join('');

        const lastSyncUpdatedAt = localStorage.getItem('lastSyncUpdatedAt');
        const syncHint = localStorage.getItem('lastSyncCode')
            ? `本机已记住同步码${lastSyncUpdatedAt ? `，最近云端更新时间 ${utils.formatSyncTime(lastSyncUpdatedAt)}。` : '，可直接恢复云端数据。'}`
            : '当前设备还没有保存同步码。';

        return `
            <section class="page-shell page-shell-summary">
                <div class="summary-main">
                    <div class="panel summary-hero">
                        <div class="panel-kicker">资金看板</div>
                        <div class="summary-header">
                            <div>
                                <div class="summary-title">总资产</div>
                                <div class="summary-main-num">${renderAmountText(totalAssets, { currency: true })}</div>
                            </div>
                            <div class="summary-status ${settledCount === displayData.length ? 'summary-status-ready' : 'summary-status-loading'}">
                                ${settledCount === displayData.length ? '已完成本轮计算' : '正在补齐净值'}
                            </div>
                        </div>
                        <div class="summary-metrics">
                            <div class="metric-card">
                                <div class="metric-label">当日盈亏</div>
                                <div class="metric-value ${utils.getColorClass(totalDaily)}">${renderAmountText(totalDaily, { forceSign: true })}</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">持有盈亏</div>
                                <div class="metric-value ${utils.getColorClass(totalHold)}">${renderAmountText(totalHold, { forceSign: true })}</div>
                            </div>
                        </div>
                        <div class="distribution-block">
                            <div class="section-head">
                                <div>
                                    <div class="section-title">资产分布</div>
                                    <div class="section-subtitle">按分组查看当前资产占比与分组概览</div>
                                </div>
                                <div class="section-meta">${groups.length} 个分组</div>
                            </div>
                            <div class="asset-strip">${stripSegments}</div>
                            <div class="asset-legend">${groupRows || '<div class="empty-inline">本轮还没有可展示的分组数据</div>'}</div>
                        </div>
                    </div>
                </div>
                <aside class="summary-side">
                    <div class="panel quick-panel">
                        <div class="section-head">
                            <div>
                                <div class="section-title">快捷工具</div>
                                <div class="section-subtitle">高频动作保持在当前页完成</div>
                            </div>
                        </div>
                        <div class="quick-actions-grid">
                            <button class="action-btn action-btn-primary" data-action="open-add">添加资产</button>
                            <button class="action-btn action-btn-secondary" data-action="open-sync">同步数据</button>
                            <button class="action-btn action-btn-secondary" data-action="refresh-data">刷新净值</button>
                        </div>
                    </div>
                    <div class="panel fact-panel">
                        <div class="section-head">
                            <div>
                                <div class="section-title">当前状态</div>
                                <div class="section-subtitle">首屏数据与同步状态</div>
                            </div>
                        </div>
                        <div class="fact-list">
                            <div class="fact-item">
                                <span class="fact-label">持仓数量</span>
                                <span class="fact-value">${state.myFunds.length}</span>
                            </div>
                            <div class="fact-item">
                                <span class="fact-label">已完成计算</span>
                                <span class="fact-value">${settledCount}/${displayData.length}</span>
                            </div>
                            <div class="fact-item">
                                <span class="fact-label">暂无估算</span>
                                <span class="fact-value">${unavailableCount}</span>
                            </div>
                            <div class="fact-item">
                                <span class="fact-label">最近更新时间</span>
                                <span class="fact-value">${utils.escapeHtml(lastTime)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="panel note-panel">
                        <div class="section-head">
                            <div>
                                <div class="section-title">同步提示</div>
                                <div class="section-subtitle">跨设备使用时建议保留同步码</div>
                            </div>
                        </div>
                        <p class="note-copy">${utils.escapeHtml(syncHint)}</p>
                    </div>
                </aside>
            </section>`;
    }

    function renderSummaryGroupFolds(displayData, distribution, groupStats) {
        if (!distribution.length) return '';

        return distribution.map((item, index) => {
            const tone = DISTRIBUTION_TONES[index % DISTRIBUTION_TONES.length];
            const dailyProfit = groupStats[item.name] || 0;
            const holdProfit = displayData
                .filter(entry => entry.valid && !entry.isLoading && !entry.isUnavailable && (entry.group || '默认分组') === item.name)
                .reduce((sum, entry) => sum + entry.holdProfit, 0);
            const isOpen = (state.summaryFoldOpenGroups || []).includes(item.name);

            return `
                <details class="group-fold" data-group-name="${utils.escapeHtml(item.name)}" ${isOpen ? 'open' : ''}>
                    <summary class="group-fold-summary">
                        <div class="group-row-left">
                            <span class="legend-dot ${tone}"></span>
                            <div>
                                <div class="group-row-name">${utils.escapeHtml(item.name)}</div>
                                <div class="group-row-meta">${item.count} 项资产 · ${item.shareLabel}</div>
                            </div>
                        </div>
                        <div class="group-row-right">
                            <div class="group-row-asset">${renderAmountText(item.assets, { currency: true })}</div>
                            <div class="group-row-profit ${utils.getColorClass(dailyProfit)}">${renderAmountText(dailyProfit, { forceSign: true })}</div>
                        </div>
                        <span class="group-fold-arrow" aria-hidden="true"></span>
                    </summary>
                    <div class="group-fold-body">
                        <div class="group-hero-stats group-hero-stats-compact">
                            <div class="hero-stat">
                                <span class="hero-stat-label">分组资产</span>
                                <span class="hero-stat-value">${renderAmountText(item.assets, { currency: true })}</span>
                            </div>
                            <div class="hero-stat">
                                <span class="hero-stat-label">当日盈亏</span>
                                <span class="hero-stat-value ${utils.getColorClass(dailyProfit)}">${renderAmountText(dailyProfit, { forceSign: true })}</span>
                            </div>
                            <div class="hero-stat">
                                <span class="hero-stat-label">持有盈亏</span>
                                <span class="hero-stat-value ${utils.getColorClass(holdProfit)}">${renderAmountText(holdProfit, { forceSign: true })}</span>
                            </div>
                        </div>
                    </div>
                </details>`;
        }).join('');
    }

    function renderGroupTab(displayData, groups) {
        const { currentGroupName, groupItems } = logic.getCurrentGroupItems(displayData, state.activeTabId, groups);

        if (groupItems.length === 0) {
            return `
                <section class="page-shell page-shell-group">
                    <div class="panel empty-state">
                        <div class="empty-illustration" aria-hidden="true">
                            <span class="empty-illustration-card"></span>
                            <span class="empty-illustration-chip"></span>
                            <span class="empty-illustration-line empty-illustration-line-long"></span>
                            <span class="empty-illustration-line"></span>
                        </div>
                        <div class="empty-state-title">${utils.escapeHtml(currentGroupName || '默认分组')}</div>
                        <p class="empty-state-desc">这个分组还没有资产。你可以直接添加到当前分组，页面会自动归类并刷新数据。</p>
                        <div class="empty-state-actions">
                            <button class="action-btn action-btn-primary" data-action="open-add" data-default-group="${utils.escapeHtml(currentGroupName || '默认分组')}">添加资产</button>
                            <button class="action-btn action-btn-secondary" data-action="open-sync">同步数据</button>
                        </div>
                    </div>
                </section>`;
        }

        const cardsHtml = groupItems.map(renderFundCard).join('');

        return `
            <section class="page-shell page-shell-group">
                <div class="fund-grid">
                    ${cardsHtml}
                    <button class="add-tile" data-action="open-add" data-default-group="${utils.escapeHtml(currentGroupName)}">
                        <span class="add-tile-icon">+</span>
                        <span class="add-tile-title">添加到 ${utils.escapeHtml(currentGroupName)}</span>
                        <span class="add-tile-copy">继续扩展这个分组的持仓</span>
                    </button>
                </div>
            </section>`;
    }

    function renderFundCard(item) {
        if (item.isLoading) {
            return `
                <article class="fund-card fund-card-loading">
                    <div class="fund-card-loading-row">
                        <span class="spinner-border spinner-border-sm text-primary"></span>
                        <span class="loading-text">正在刷新这只基金的最新净值…</span>
                    </div>
                </article>`;
        }

        if (!item.valid) {
            return `
                <article class="fund-card fund-card-error" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                    <div class="fund-card-header">
                        <div>
                            <div class="fund-card-title danger-text">加载失败 ${utils.escapeHtml(item.code)}</div>
                            <div class="fund-card-subtitle">点击卡片可检查代码、份额或分组配置。</div>
                        </div>
                        <div class="status-pill status-pill-up">异常</div>
                    </div>
                </article>`;
        }

        if (item.isUnavailable) {
            return `
                <article class="fund-card fund-card-unavailable" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                    <div class="fund-card-header">
                        <div>
                            <div class="fund-card-title">${utils.escapeHtml(item.name)}</div>
                            <div class="fund-card-subtitle">${utils.escapeHtml(item.code)}</div>
                        </div>
                        <div class="status-pill status-pill-flat">待更新</div>
                    </div>
                    <p class="unavailable-copy">暂无可靠盘中估算，等待实际净值或下次缓存命中。</p>
                </article>`;
        }

        const pillClass = item.estRate > 0 ? 'status-pill-up' : (item.estRate < 0 ? 'status-pill-down' : 'status-pill-flat');
        const badgeText = `${item.isActual ? '实' : '估'} ${utils.formatNumber(item.estRate, true)}%`;
        const itemClass = item.isBackup ? 'fund-card-backup' : '';
        const navLabel = item.isActual ? '实际净值' : '估算净值';
        const dailyLabel = item.isActual ? '当日(实)' : '当日(估)';

        return `
            <article class="fund-card ${itemClass}" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                <div class="fund-card-header">
                    <div>
                        <div class="fund-card-title">${utils.escapeHtml(item.name)}</div>
                        <div class="fund-card-subtitle">${utils.escapeHtml(item.code)} · ${utils.escapeHtml(item.gztime)}</div>
                    </div>
                    <div class="status-pill ${pillClass}">${badgeText}</div>
                </div>
                <div class="fund-stats">
                    <div class="stat-field">
                        <div class="stat-field-label">${navLabel}</div>
                        <div class="stat-field-value">${item.estNav.toFixed(4)}</div>
                    </div>
                    <div class="stat-field">
                        <div class="stat-field-label">${dailyLabel}</div>
                        <div class="stat-field-value ${utils.getColorClass(item.dailyProfit)}">${renderAmountText(item.dailyProfit, { forceSign: true })}</div>
                    </div>
                    <div class="stat-field">
                        <div class="stat-field-label">持有盈亏</div>
                        <div class="stat-field-value ${utils.getColorClass(item.holdProfit)}">${renderAmountText(item.holdProfit, { forceSign: true })}</div>
                    </div>
                    <div class="stat-field">
                        <div class="stat-field-label">总金额</div>
                        <div class="stat-field-value">${renderAmountText(item.totalAsset, { currency: true })}</div>
                    </div>
                </div>
            </article>`;
    }

    function buildAssetDistribution(displayData) {
        const totals = new Map();

        (displayData || []).forEach(item => {
            if (!item.valid || item.isLoading || item.isUnavailable) return;

            const groupName = item.group || '默认分组';
            const prev = totals.get(groupName) || { name: groupName, assets: 0, count: 0 };
            prev.assets += item.totalAsset;
            prev.count += 1;
            totals.set(groupName, prev);
        });

        const entries = Array.from(totals.values()).sort((a, b) => b.assets - a.assets);
        const totalAssets = entries.reduce((sum, item) => sum + item.assets, 0);

        return entries.map(item => ({
            ...item,
            percent: totalAssets > 0 ? (item.assets / totalAssets) * 100 : 0,
            shareLabel: totalAssets > 0 ? `${((item.assets / totalAssets) * 100).toFixed(1)}%` : '0.0%'
        }));
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
        const code = document.getElementById('inputCode').value.trim();
        const shares = document.getElementById('inputShares').value.trim();
        const cost = document.getElementById('inputCost').value.trim();
        const group = document.getElementById('inputGroup').value.trim() || '默认分组';
        const index = parseInt(document.getElementById('editIndex').value, 10);

        if (!/^\d{6}$/.test(code)) {
            showNotice('请输入 6 位数字基金代码', 'error');
            return;
        }
        if (shares === '' || Number.isNaN(Number(shares)) || Number(shares) < 0) {
            showNotice('份额必须是非负数字', 'error');
            return;
        }
        if (cost !== '' && (Number.isNaN(Number(cost)) || Number(cost) < 0)) {
            showNotice('成本必须为空或非负数字', 'error');
            return;
        }
        if (group.length > 32) {
            showNotice('分组名称不能超过 32 个字符', 'error');
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
        if (confirm('确定删除这笔资产？')) {
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
