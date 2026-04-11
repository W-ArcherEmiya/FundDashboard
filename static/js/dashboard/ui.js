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

    function renderUI(isLoading = false) {
        const tabContainer = document.getElementById('fundTabs');
        state.activeTabId = 'tab-summary';
        state.currentActiveGroup = null;
        app.persistActiveTab();

        let tabsHtml = `
            <li class="nav-item">
                <button class="nav-link active" data-action="switch-tab" data-tab-id="tab-summary">
                    <span class="nav-link-text">概览</span>
                </button>
            </li>`;

        tabContainer.innerHTML = tabsHtml;
        document.getElementById('contentArea').innerHTML = generateCurrentTabContent(isLoading);
    }

    function switchTab(tabId, groupName) {
        state.activeTabId = tabId;
        state.currentActiveGroup = groupName || null;
        app.persistActiveTab();
        renderUI(false);
    }

    function generateCurrentTabContent(isLoading) {
        const displayData = logic.buildDisplayData(state.myFunds, state.cachedResults, isLoading);
        const groups = logic.getGroups(state.myFunds);
        return renderSummaryTab(displayData, groups);
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
        const groupRows = distribution.map((item, index) => {
            const tone = DISTRIBUTION_TONES[index % DISTRIBUTION_TONES.length];
            const dailyProfit = groupStats[item.name] || 0;
            return `
                <div class="group-row">
                    <div class="group-row-left">
                        <span class="legend-dot ${tone}"></span>
                        <div>
                            <div class="group-row-name">${utils.escapeHtml(item.name)}</div>
                            <div class="group-row-meta">${item.count} 项资产 · ${item.shareLabel}</div>
                        </div>
                    </div>
                    <div class="group-row-right">
                        <div class="group-row-asset">¥${utils.formatNumber(item.assets, false)}</div>
                        <div class="group-row-profit ${utils.getColorClass(dailyProfit)}">${utils.formatNumber(dailyProfit, true)}</div>
                    </div>
                </div>`;
        }).join('');

        const stripSegments = distribution.map((item, index) => {
            const tone = DISTRIBUTION_TONES[index % DISTRIBUTION_TONES.length];
            return `<span class="asset-strip-segment ${tone}" style="width:${item.percent.toFixed(2)}%"></span>`;
        }).join('');
        const groupFoldHtml = renderGroupFolds(displayData, distribution, groupStats);

        const syncHint = localStorage.getItem('lastSyncCode')
            ? '本机已记住同步码，可直接恢复云端数据。'
            : '当前设备还没有保存同步码。';

        return `
            <section class="page-shell page-shell-summary">
                <div class="summary-main">
                    <div class="panel summary-hero">
                        <div class="panel-kicker">资金看板</div>
                        <div class="summary-header">
                            <div>
                                <div class="summary-title">总资产</div>
                                <div class="summary-main-num">¥${utils.formatNumber(totalAssets, false)}</div>
                            </div>
                            <div class="summary-status ${settledCount === displayData.length ? 'summary-status-ready' : 'summary-status-loading'}">
                                ${settledCount === displayData.length ? '已完成本轮计算' : '正在补齐净值'}
                            </div>
                        </div>
                        <div class="summary-metrics">
                            <div class="metric-card">
                                <div class="metric-label">当日盈亏</div>
                                <div class="metric-value ${utils.getColorClass(totalDaily)}">${utils.formatNumber(totalDaily, true)}</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">持有盈亏</div>
                                <div class="metric-value ${utils.getColorClass(totalHold)}">${utils.formatNumber(totalHold, true)}</div>
                            </div>
                        </div>
                        <div class="distribution-block">
                            <div class="section-head">
                                <div>
                                    <div class="section-title">资产分布</div>
                                    <div class="section-subtitle">按分组查看当前资产占比</div>
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
                <section class="summary-fold-section">
                    <div class="panel summary-fold-panel">
                        <div class="section-head">
                            <div>
                                <div class="section-title">分组持仓</div>
                                <div class="section-subtitle">每个分组可展开查看当前持仓明细</div>
                            </div>
                            <div class="section-meta">${distribution.length} 个折叠板块</div>
                        </div>
                        <div class="group-fold-list">
                            ${groupFoldHtml}
                        </div>
                    </div>
                </section>
            </section>`;
    }

    function renderGroupFolds(displayData, distribution, groupStats) {
        if (distribution.length === 0) {
            return '<div class="empty-inline">当前还没有可展开的分组持仓。</div>';
        }

        return distribution.map((group, index) => {
            const tone = DISTRIBUTION_TONES[index % DISTRIBUTION_TONES.length];
            const groupItems = displayData.filter(item => (item.group || '默认分组') === group.name);
            const groupSummary = groupItems.reduce((acc, item) => {
                if (item.valid && !item.isLoading && !item.isUnavailable) {
                    acc.assets += item.totalAsset;
                    acc.daily += item.dailyProfit;
                    acc.hold += item.holdProfit;
                }
                return acc;
            }, { assets: 0, daily: 0, hold: 0 });
            const cardsHtml = groupItems.map(renderFundCard).join('');

            return `
                <details class="group-fold" ${index === 0 ? 'open' : ''}>
                    <summary class="group-fold-summary">
                        <div class="group-fold-summary-main">
                            <span class="legend-dot ${tone}"></span>
                            <div>
                                <div class="group-fold-title">${utils.escapeHtml(group.name)}</div>
                                <div class="group-fold-meta">${group.count} 项资产 · 占总资产 ${group.shareLabel}</div>
                            </div>
                        </div>
                        <div class="group-fold-summary-side">
                            <div class="group-fold-asset">¥${utils.formatNumber(groupSummary.assets, false)}</div>
                            <div class="group-fold-profit ${utils.getColorClass(groupStats[group.name] || 0)}">${utils.formatNumber(groupStats[group.name] || 0, true)}</div>
                        </div>
                        <span class="group-fold-arrow" aria-hidden="true"></span>
                    </summary>
                    <div class="group-fold-body">
                        <div class="group-fold-stats">
                            <div class="hero-stat">
                                <span class="hero-stat-label">分组资产</span>
                                <span class="hero-stat-value">¥${utils.formatNumber(groupSummary.assets, false)}</span>
                            </div>
                            <div class="hero-stat">
                                <span class="hero-stat-label">当日盈亏</span>
                                <span class="hero-stat-value ${utils.getColorClass(groupSummary.daily)}">${utils.formatNumber(groupSummary.daily, true)}</span>
                            </div>
                            <div class="hero-stat">
                                <span class="hero-stat-label">持有盈亏</span>
                                <span class="hero-stat-value ${utils.getColorClass(groupSummary.hold)}">${utils.formatNumber(groupSummary.hold, true)}</span>
                            </div>
                        </div>
                        <div class="fund-grid group-fold-grid">
                            ${cardsHtml}
                            <button class="add-tile" data-action="open-add" data-default-group="${utils.escapeHtml(group.name)}">
                                <span class="add-tile-icon">+</span>
                                <span class="add-tile-title">添加到 ${utils.escapeHtml(group.name)}</span>
                                <span class="add-tile-copy">继续扩展这个分组的持仓</span>
                            </button>
                        </div>
                    </div>
                </details>`;
        }).join('');
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
                        <div class="stat-field-value ${utils.getColorClass(item.dailyProfit)}">${utils.formatNumber(item.dailyProfit, true)}</div>
                    </div>
                    <div class="stat-field">
                        <div class="stat-field-label">持有盈亏</div>
                        <div class="stat-field-value ${utils.getColorClass(item.holdProfit)}">${utils.formatNumber(item.holdProfit, true)}</div>
                    </div>
                    <div class="stat-field">
                        <div class="stat-field-label">总金额</div>
                        <div class="stat-field-value">¥${utils.formatNumber(item.totalAsset, false)}</div>
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
