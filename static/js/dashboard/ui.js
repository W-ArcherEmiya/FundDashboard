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
                            <button class="action-btn action-btn-secondary" data-action="open-import">截图导入</button>
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
                            <button class="action-btn action-btn-secondary" data-action="open-import">截图导入</button>
                            <button class="action-btn action-btn-secondary" data-action="open-sync">同步数据</button>
                            <button class="action-btn action-btn-secondary" data-action="refresh-data">刷新净值</button>
                            <button class="action-btn action-btn-secondary" data-action="export-analysis-csv">导出表格</button>
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

        const sortedItems = sortGroupItems(groupItems);
        const itemsHtml = sortedItems.map(renderFundListItem).join('');

        return `
            <section class="page-shell page-shell-group">
                <div class="panel fund-list-panel">
                    <div class="fund-list-head">
                        <div class="fund-list-head-main">基金</div>
                        ${renderSortableHead('estNav', '估算/实际净值')}
                        ${renderSortableHead('dailyProfit', '当日(估)')}
                        ${renderSortableHead('holdProfit', '持有盈亏')}
                    </div>
                    <div class="fund-list">
                        ${itemsHtml}
                        <button class="fund-list-add" data-action="open-add" data-default-group="${utils.escapeHtml(currentGroupName)}">
                            <span class="add-tile-icon">+</span>
                            <span class="fund-list-add-copy">添加到 ${utils.escapeHtml(currentGroupName)}</span>
                        </button>
                    </div>
                </div>
            </section>`;
    }

    function renderSortableHead(key, label) {
        const sort = state.groupListSort || {};
        const isActive = sort.key === key;
        const direction = isActive ? sort.direction : 'desc';
        const title = `${label}${direction === 'asc' ? '升序' : '降序'}`;

        return `
            <div class="fund-head-sort">
                <span>${utils.escapeHtml(label)}</span>
                <button class="fund-sort-btn ${isActive ? 'fund-sort-btn-active' : ''}" data-action="sort-group-list" data-sort-key="${utils.escapeHtml(key)}" title="${utils.escapeHtml(title)}" aria-label="${utils.escapeHtml(title)}">
                    <span class="sort-triangle sort-triangle-up ${isActive && direction === 'asc' ? 'sort-triangle-active' : ''}" aria-hidden="true"></span>
                    <span class="sort-triangle sort-triangle-down ${isActive && direction === 'desc' ? 'sort-triangle-active' : ''}" aria-hidden="true"></span>
                </button>
            </div>`;
    }

    function sortGroupItems(items) {
        const sort = state.groupListSort || {};
        const key = ['estNav', 'dailyProfit', 'holdProfit'].includes(sort.key) ? sort.key : 'dailyProfit';
        const direction = sort.direction === 'asc' ? 'asc' : 'desc';
        const factor = direction === 'asc' ? 1 : -1;

        return [...items].sort((a, b) => {
            const aValue = Number(a[key]);
            const bValue = Number(b[key]);
            const aRank = Number.isFinite(aValue) && a.valid && !a.isLoading && !a.isUnavailable ? 0 : 1;
            const bRank = Number.isFinite(bValue) && b.valid && !b.isLoading && !b.isUnavailable ? 0 : 1;
            if (aRank !== bRank) return aRank - bRank;
            if (aRank === 1) return 0;
            if (aValue === bValue) return 0;
            return aValue > bValue ? factor : -factor;
        });
    }

    function sortGroupList(key) {
        const current = state.groupListSort || {};
        const nextDirection = current.key === key && current.direction === 'desc' ? 'asc' : 'desc';
        state.groupListSort = { key, direction: nextDirection };
        app.persistGroupListSort();
        renderUI(false);
    }

    function renderFundListItem(item) {
        if (item.isLoading) {
            return `
                <article class="fund-list-row fund-list-row-loading">
                    <div class="fund-list-main">
                        <span class="spinner-border spinner-border-sm text-primary"></span>
                        <span class="loading-text">正在刷新这只基金的最新净值…</span>
                    </div>
                </article>`;
        }

        if (!item.valid) {
            return `
                <article class="fund-list-row fund-list-row-error" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                    <div class="fund-list-main">
                        <div>
                            <div class="fund-card-title danger-text">加载失败 ${utils.escapeHtml(item.code)}</div>
                            <div class="fund-card-subtitle">点击行可检查代码、份额或分组配置。</div>
                        </div>
                    </div>
                    <div class="fund-list-status"><span class="status-pill status-pill-up">异常</span></div>
                </article>`;
        }

        if (item.isUnavailable) {
            return `
                <article class="fund-list-row fund-list-row-unavailable" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                    <div class="fund-list-main fund-list-main-wide">
                        <div>
                            <div class="fund-card-title">${utils.escapeHtml(item.name)}</div>
                            <div class="fund-list-total">总金额 暂无数据</div>
                        </div>
                    </div>
                    <div class="fund-list-status"><span class="status-pill status-pill-flat">待更新</span></div>
                </article>`;
        }

        const pillClass = item.estRate > 0 ? 'status-pill-up' : (item.estRate < 0 ? 'status-pill-down' : 'status-pill-flat');
        const badgeText = `${item.isActual ? '实' : '估'} ${utils.formatNumber(item.estRate, true)}%`;
        const itemClass = item.isBackup ? 'fund-list-row-backup' : '';
        const navLabel = item.isActual ? '实际净值' : '估算净值';
        const dailyLabel = item.isActual ? '当日(实)' : '当日(估)';

        return `
            <article class="fund-list-row ${itemClass}" data-action="open-edit" data-code="${utils.escapeHtml(item.code)}">
                <div class="fund-list-main">
                    <div>
                        <div class="fund-card-title">${utils.escapeHtml(item.name)}</div>
                        <div class="fund-list-total">总金额 ${renderAmountText(item.totalAsset, { currency: true })}</div>
                    </div>
                </div>
                <div class="fund-list-cell">
                    <span class="fund-list-label">${navLabel}</span>
                    <span class="fund-list-value">${item.estNav.toFixed(4)}</span>
                    <span class="status-pill fund-list-rate ${pillClass}">${badgeText}</span>
                </div>
                <div class="fund-list-cell">
                    <span class="fund-list-label">${dailyLabel}</span>
                    <span class="fund-list-value ${utils.getColorClass(item.dailyProfit)}">${renderAmountText(item.dailyProfit, { forceSign: true })}</span>
                </div>
                <div class="fund-list-cell">
                    <span class="fund-list-label">持有盈亏</span>
                    <span class="fund-list-value ${utils.getColorClass(item.holdProfit)}">${renderAmountText(item.holdProfit, { forceSign: true })}</span>
                </div>
            </article>`;
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

    function openImportModal() {
        resetImportModal();
        state.importModal.show();
    }

    function resetImportModal() {
        const input = document.getElementById('importImageInput');
        const status = document.getElementById('importStatus');
        const progress = document.getElementById('importProgress');
        const bar = document.getElementById('importProgressBar');
        const results = document.getElementById('importResults');

        state.importCandidates = [];
        state.importAutoUpdatedCount = 0;
        if (input) input.value = '';
        if (status) status.textContent = '选择一张或多张截图后识别基金名称、匹配代码，并用金额/净值反推份额。';
        if (progress) progress.classList.add('d-none');
        if (bar) bar.style.width = '0%';
        if (results) {
            results.innerHTML = '';
            results.classList.add('d-none');
        }
    }

    async function fillSharesFromAmount(code, amount) {
        const holdingAmount = Number(amount);
        if (!code || !Number.isFinite(holdingAmount) || holdingAmount <= 0) return false;

        const nav = await app.ocr.fetchLatestNav(code);
        if (!nav) return false;

        const shares = holdingAmount / nav;
        return {
            shares: shares.toFixed(2),
            nav: nav.toFixed(4)
        };
    }

    function inferCostFromProfit(amount, holdProfit, shares) {
        const amountValue = Number(amount);
        const profitValue = Number(holdProfit);
        const sharesValue = Number(shares);

        if (!Number.isFinite(amountValue) || !Number.isFinite(profitValue) || !Number.isFinite(sharesValue) || sharesValue <= 0) {
            return '';
        }

        const totalCost = amountValue - profitValue;
        if (totalCost < 0) return '';

        return (totalCost / sharesValue).toFixed(4);
    }

    function storeCandidateSnapshotOverride(code, candidate) {
        const amount = Number(candidate && candidate.amount);
        const holdProfit = Number(candidate && candidate.holdProfit);
        if (!/^\d{6}$/.test(code || '') || !Number.isFinite(amount) || !Number.isFinite(holdProfit)) return;

        state.syncSnapshotOverrides = state.syncSnapshotOverrides || {};
        state.syncSnapshotOverrides[code] = {
            ...(state.syncSnapshotOverrides[code] || {}),
            totalAsset: amount,
            holdProfit,
            updatedAt: new Date().toISOString()
        };
        app.persistSyncSnapshotOverrides();
    }

    function clearSnapshotOverride(code) {
        if (!/^\d{6}$/.test(code || '') || !state.syncSnapshotOverrides || !state.syncSnapshotOverrides[code]) return;
        delete state.syncSnapshotOverrides[code];
        app.persistSyncSnapshotOverrides();
    }

    function getDefaultImportGroup() {
        return state.currentActiveGroup || '默认分组';
    }

    function getExistingFundByCode(code) {
        return state.myFunds.find(fund => fund.code === code) || null;
    }

    function updateExistingFundFromCandidate(candidate) {
        if (!candidate || !/^\d{6}$/.test(candidate.code || '') || !candidate.shares) return false;

        const index = state.myFunds.findIndex(fund => fund.code === candidate.code);
        if (index === -1) return false;

        state.myFunds[index] = {
            ...state.myFunds[index],
            shares: candidate.shares,
            cost: candidate.cost !== '' ? candidate.cost : state.myFunds[index].cost
        };
        return true;
    }

    function buildImportSuggestionControl(candidate, index) {
        const suggestions = Array.isArray(candidate.suggestions) ? candidate.suggestions : [];
        if (!suggestions.length || /^\d{6}$/.test(candidate.code || '')) return '';

        const options = suggestions.map(suggestion => {
            const label = `${suggestion.code} ${suggestion.name}`;
            return `<option value="${utils.escapeHtml(suggestion.code)}">${utils.escapeHtml(label)}</option>`;
        }).join('');

        return `
            <div class="import-suggestion-control">
                <label class="form-label form-label-soft">候选匹配</label>
                <select class="form-control import-suggestion" data-import-index="${index}">
                    <option value="">选择候选基金</option>
                    ${options}
                </select>
            </div>`;
    }

    function getImportSourceLabel(candidate) {
        const source = String(candidate && candidate.source || '');
        if (source === 'layout') return '坐标解析';
        if (source === 'text') return '文本兜底';
        if (source === 'textFallback') return '文本回填';
        if (source === 'layoutCandidate') return '坐标候选';
        if (source === 'textCandidate') return '文本候选';
        if (source === 'layoutUnmatched') return '坐标未匹配';
        if (source === 'textUnmatched') return '文本未匹配';
        if (source === 'selectedCandidate') return '手选候选';
        if (source === 'manualCode') return '手动代码';
        if (source === 'detail') return '详情页';
        return '';
    }

    function buildImportRow(candidate, index) {
        const group = candidate.group || getDefaultImportGroup();
        const hasCode = /^\d{6}$/.test(candidate.code || '');
        const hasSuggestions = Array.isArray(candidate.suggestions) && candidate.suggestions.length > 0 && !hasCode;
        const disabledNote = candidate.shares
            ? ''
            : `<div class="import-row-warning">${hasCode ? '未能反推份额，请检查代码或手动填写。' : (hasSuggestions ? '存在多个相似候选，请选择正确基金。' : '无法匹配基金代码，请输入代码后重新计算份额和成本。')}</div>`;
        const matchStatus = hasCode ? utils.escapeHtml(candidate.code) : (hasSuggestions ? '待选择候选' : '无法匹配');
        const existingBadge = candidate.existing ? ' · 已持仓' : '';
        const sourceLabel = getImportSourceLabel(candidate);
        const sourceBadge = sourceLabel ? `<span class="import-source-badge">${utils.escapeHtml(sourceLabel)}</span>` : '';

        return `
            <article class="import-row" data-import-index="${index}">
                <label class="import-row-check">
                    <input type="checkbox" class="import-select" ${candidate.selected ? 'checked' : ''}>
                </label>
                <div class="import-row-main">
                    <div class="import-row-title">
                        <div class="import-row-name">${utils.escapeHtml(candidate.name)}</div>
                        ${sourceBadge}
                    </div>
                    <div class="import-row-meta">
                        ${matchStatus}
                        ${existingBadge}
                        ${candidate.amount ? ` · 金额 ${utils.escapeHtml(candidate.amount)}` : ''}
                        ${candidate.holdProfit ? ` · 持有收益 ${utils.escapeHtml(candidate.holdProfit)}` : ''}
                        ${candidate.nav ? ` · 净值 ${utils.escapeHtml(candidate.nav)}` : ''}
                    </div>
                    ${disabledNote}
                    ${buildImportSuggestionControl(candidate, index)}
                </div>
                <div class="import-row-field import-code-field">
                    <label class="form-label form-label-soft">基金代码</label>
                    <div class="import-code-control">
                        <input type="text" inputmode="numeric" maxlength="6" class="form-control import-code" value="${utils.escapeHtml(candidate.code || '')}" placeholder="6位代码">
                        <button type="button" class="btn btn-light import-recalc-btn" data-action="recalc-import-row" data-import-index="${index}">重算</button>
                    </div>
                </div>
                <div class="import-row-field">
                    <label class="form-label form-label-soft">份额</label>
                    <input type="number" class="form-control import-shares" value="${utils.escapeHtml(candidate.shares || '')}" placeholder="手动填写">
                </div>
                <div class="import-row-field">
                    <label class="form-label form-label-soft">成本</label>
                    <input type="number" class="form-control import-cost" value="${utils.escapeHtml(candidate.cost || '')}" placeholder="选填">
                </div>
                <div class="import-row-field">
                    <label class="form-label form-label-soft">分组</label>
                    <input type="text" class="form-control import-group" value="${utils.escapeHtml(group)}" placeholder="默认分组">
                </div>
            </article>`;
    }

    function renderImportResults(candidates) {
        const results = document.getElementById('importResults');
        if (!results) return;
        const updatedCount = state.importAutoUpdatedCount || 0;
        const updatedNote = updatedCount
            ? `<div class="import-result-note">已更新 ${updatedCount} 只已有基金，并从识别列表移除。</div>`
            : '';

        if (!candidates.length) {
            results.innerHTML = `
                ${updatedNote}
                <div class="import-empty">${updatedCount ? '本次截图中的基金已处理完。' : '没有识别到可添加的基金。'}</div>`;
            results.classList.remove('d-none');
            return;
        }

        results.innerHTML = `
            <div class="import-result-head">
                <div>
                    <div class="section-title">已读取基金</div>
                    <div class="section-subtitle">已持仓基金会自动填入原分组；勾选后确认，选中项会按分组处理。</div>
                </div>
                <div class="section-meta">${candidates.length} 项</div>
            </div>
            ${updatedNote}
            <div class="import-list">
                ${candidates.map(buildImportRow).join('')}
            </div>`;
        results.classList.remove('d-none');
    }

    function renderImportDiagnostics(parsed) {
        const results = document.getElementById('importResults');
        if (!results) return;

        const text = String(parsed.rawText || '').slice(0, 600);
        const textBlock = text
            ? `<pre class="import-debug-text">${utils.escapeHtml(text)}</pre>`
            : '<div class="import-debug-empty">OCR 没有读出可用文字。</div>';

        results.innerHTML = `
            <div class="import-debug">
                <div class="section-title">未读取到可添加基金</div>
                <div class="section-subtitle">${utils.escapeHtml(parsed.message || '未匹配到基金代码。')}</div>
                <div class="import-debug-facts">
                    <div>OCR 文字长度：${utils.escapeHtml(parsed.ocrTextLength || 0)}</div>
                    <div>代码表状态：${utils.escapeHtml(parsed.catalogError || (parsed.catalogSize ? `已加载 ${parsed.catalogSize} 条` : '未命中'))}</div>
                </div>
                ${textBlock}
            </div>`;
        results.classList.remove('d-none');
    }

    async function hydrateImportCandidates(candidates) {
        const status = document.getElementById('importStatus');
        const uniqueCandidates = [];
        const seenCodes = new Set();

        const seenUnmatched = new Set();

        const getMetricKey = candidate => {
            const amount = Number(candidate.amount);
            const holdProfit = Number(candidate.holdProfit);
            if (!Number.isFinite(amount) || !Number.isFinite(holdProfit)) return '';
            return `${amount.toFixed(2)}|${holdProfit.toFixed(2)}`;
        };

        candidates.forEach(candidate => {
            if (candidate.code && seenCodes.has(candidate.code)) return;
            const metricKey = getMetricKey(candidate);
            if (candidate.code) {
                seenCodes.add(candidate.code);
                for (let index = uniqueCandidates.length - 1; index >= 0; index -= 1) {
                    const existing = uniqueCandidates[index];
                    if (!existing.code && metricKey && getMetricKey(existing) === metricKey) {
                        uniqueCandidates.splice(index, 1);
                    }
                }
            }
            if (!candidate.code) {
                if (metricKey && uniqueCandidates.some(existing => existing.code && getMetricKey(existing) === metricKey)) return;
                const unmatchedKey = [
                    String(candidate.name || '').replace(/\s+/g, ''),
                    String(candidate.amount || ''),
                    String(candidate.holdProfit || '')
                ].join('|');
                if (seenUnmatched.has(unmatchedKey)) return;
                seenUnmatched.add(unmatchedKey);
            }
            const existingFund = candidate.code ? getExistingFundByCode(candidate.code) : null;
            uniqueCandidates.push({
                code: candidate.code || '',
                name: candidate.name || (candidate.code ? `基金 ${candidate.code}` : '无法匹配的基金'),
                amount: candidate.amount || '',
                holdProfit: candidate.holdProfit || '',
                type: candidate.type || '',
                suggestions: Array.isArray(candidate.suggestions) ? candidate.suggestions : [],
                source: candidate.source || '',
                unmatched: Boolean(candidate.unmatched || !candidate.code),
                existing: Boolean(existingFund),
                group: existingFund ? (existingFund.group || '默认分组') : getDefaultImportGroup(),
                shares: '',
                cost: '',
                nav: '',
                selected: true
            });
        });

        for (let index = 0; index < uniqueCandidates.length; index += 1) {
            const candidate = uniqueCandidates[index];
            if (status) status.textContent = `正在反推份额 ${index + 1}/${uniqueCandidates.length}`;
            if (candidate.code) {
                const inferred = await fillSharesFromAmount(candidate.code, candidate.amount);
                if (inferred) {
                    candidate.shares = inferred.shares;
                    candidate.nav = inferred.nav;
                    candidate.cost = inferCostFromProfit(candidate.amount, candidate.holdProfit, candidate.shares);
                }
            }
        }

        state.importAutoUpdatedCount = 0;
        state.importCandidates = uniqueCandidates;
        renderImportResults(uniqueCandidates);
        if (status) {
            const existingCount = uniqueCandidates.filter(candidate => candidate.existing).length;
            status.textContent = uniqueCandidates.length
                ? `已读取 ${uniqueCandidates.length} 只基金${existingCount ? `，其中 ${existingCount} 只已持仓并已填入原分组` : ''}`
                : '没有识别到可添加的基金';
        }
    }

    function normalizeImportFiles(input) {
        return (Array.isArray(input) ? input : [input]).filter(Boolean);
    }

    function buildCandidatesFromParsed(parsed) {
        if (parsed.candidates && parsed.candidates.length) return parsed.candidates;
        if (parsed.code) {
            return [{
                code: parsed.code,
                name: parsed.matchedName || `基金 ${parsed.code}`,
                amount: parsed.amount || '',
                holdProfit: parsed.holdProfit || '',
                source: 'detail'
            }];
        }
        return [];
    }

    function buildBatchImportDiagnostics(parsedResults) {
        const rawText = parsedResults
            .map((parsed, index) => `截图 ${index + 1}\n${parsed.rawText || ''}`)
            .join('\n\n')
            .slice(0, 1200);
        const totalTextLength = parsedResults.reduce((sum, parsed) => sum + Number(parsed.ocrTextLength || 0), 0);
        const catalogSize = parsedResults.find(parsed => parsed.catalogSize)?.catalogSize || '';
        const catalogError = parsedResults.find(parsed => parsed.catalogError)?.catalogError || '';
        const messages = parsedResults
            .map(parsed => parsed.message)
            .filter(Boolean);

        return {
            rawText,
            ocrTextLength: totalTextLength,
            catalogSize,
            catalogError,
            message: messages[0] || '未匹配到可添加的基金。'
        };
    }

    async function importFromScreenshot(input) {
        const files = normalizeImportFiles(input);
        if (!files.length) return;

        const status = document.getElementById('importStatus');
        const progress = document.getElementById('importProgress');
        const bar = document.getElementById('importProgressBar');

        if (files.some(file => !file.type.startsWith('image/'))) {
            showNotice('请选择图片文件', 'error');
            resetImportModal();
            return;
        }

        if (files.some(file => file.size > 8 * 1024 * 1024)) {
            showNotice('单张截图文件不能超过 8MB', 'error');
            resetImportModal();
            return;
        }

        status.textContent = files.length > 1 ? `正在识别 1/${files.length}...` : '正在识别...';
        progress.classList.remove('d-none');
        bar.style.width = '8%';

        try {
            const parsedResults = [];
            const allCandidates = [];

            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                const parsed = await app.ocr.recognizeBestAlipayScreenshot(file, (percent, label) => {
                    const currentPercent = Math.max(8, Math.min(100, percent || 0));
                    const overallPercent = Math.round(((index + currentPercent / 100) / files.length) * 100);
                    bar.style.width = `${Math.max(8, overallPercent)}%`;
                    status.textContent = files.length > 1
                        ? `正在识别 ${index + 1}/${files.length}：${label || `${currentPercent}%`}`
                        : (label || `正在识别 ${currentPercent}%`);
                });

                parsedResults.push(parsed);
                allCandidates.push(...buildCandidatesFromParsed(parsed));
            }

            bar.style.width = '100%';

            await hydrateImportCandidates(allCandidates);

            if (!state.importCandidates.length) {
                const diagnostics = buildBatchImportDiagnostics(parsedResults);
                renderImportDiagnostics(diagnostics);
                status.textContent = diagnostics.message || '未识别到可填字段';
                showNotice(diagnostics.message || '未识别到基金代码、份额或成本，请手动填写', 'error', 5000);
            } else {
                const engines = [...new Set(parsedResults.map(parsed => parsed.ocrEngine).filter(Boolean))];
                const engineText = engines.length ? `（${engines.join('、')}）` : '';
                showNotice(`${files.length > 1 ? '批量截图' : '截图'}读取完成${engineText}，已持仓基金已自动填入原分组`, 'success', 5000);
            }
        } catch (error) {
            console.error('importFromScreenshot failed', error);
            const message = error && error.message ? error.message : '未知错误';
            status.textContent = `识别失败：${message}`;
            showNotice(`截图识别失败：${message}`, 'error', 5000);
        }
    }

    function syncImportRowsToState() {
        const rows = Array.from(document.querySelectorAll('.import-row'));
        rows.forEach(row => {
            const index = Number(row.dataset.importIndex);
            const candidate = state.importCandidates[index];
            if (!candidate) return;

            candidate.selected = Boolean(row.querySelector('.import-select') && row.querySelector('.import-select').checked);
            candidate.code = (row.querySelector('.import-code')?.value || '').trim();
            candidate.shares = (row.querySelector('.import-shares')?.value || '').trim();
            candidate.cost = (row.querySelector('.import-cost')?.value || '').trim();
            candidate.group = (row.querySelector('.import-group')?.value || '').trim() || getDefaultImportGroup();
        });
    }

    async function applyImportSuggestion(index, code) {
        syncImportRowsToState();

        const candidate = state.importCandidates[index];
        if (!candidate || !/^\d{6}$/.test(code || '')) return;

        const suggestion = (candidate.suggestions || []).find(item => item.code === code);
        if (!suggestion) return;

        candidate.code = suggestion.code;
        candidate.name = suggestion.name;
        candidate.type = suggestion.type || candidate.type || '';
        candidate.unmatched = false;
        candidate.source = 'selectedCandidate';
        candidate.selected = true;

        const existingFund = getExistingFundByCode(candidate.code);
        candidate.existing = Boolean(existingFund);
        if (existingFund) candidate.group = existingFund.group || '默认分组';

        const status = document.getElementById('importStatus');
        if (status) status.textContent = `正在用 ${candidate.code} 重新计算份额和成本`;

        const inferred = await fillSharesFromAmount(candidate.code, candidate.amount);
        if (inferred) {
            candidate.shares = inferred.shares;
            candidate.nav = inferred.nav;
            candidate.cost = inferCostFromProfit(candidate.amount, candidate.holdProfit, candidate.shares);
        }

        renderImportResults(state.importCandidates);
        if (status) status.textContent = '已选择候选基金';
        showNotice('已选择候选基金并重新计算', 'success', 3500);
    }

    async function recalculateImportCandidate(index) {
        syncImportRowsToState();

        const candidate = state.importCandidates[index];
        if (!candidate) return;

        const code = String(candidate.code || '').trim();
        if (!/^\d{6}$/.test(code)) {
            showNotice('请输入 6 位基金代码后再重算', 'error', 4000);
            return;
        }

        if (!candidate.amount || Number.isNaN(Number(candidate.amount)) || Number(candidate.amount) <= 0) {
            showNotice('截图中没有可用于反推的持有金额', 'error', 4000);
            return;
        }

        const status = document.getElementById('importStatus');
        if (status) status.textContent = `正在用 ${code} 重新计算份额和成本`;

        const inferred = await fillSharesFromAmount(code, candidate.amount);
        if (!inferred) {
            showNotice('未能拉取该基金净值，请检查代码是否正确', 'error', 5000);
            return;
        }

        candidate.code = code;
        candidate.unmatched = false;
        candidate.source = 'manualCode';
        candidate.shares = inferred.shares;
        candidate.nav = inferred.nav;
        candidate.cost = inferCostFromProfit(candidate.amount, candidate.holdProfit, candidate.shares);
        candidate.selected = true;
        const existingFund = getExistingFundByCode(code);
        candidate.existing = Boolean(existingFund);
        if (existingFund) candidate.group = existingFund.group || '默认分组';

        renderImportResults(state.importCandidates);
        if (status) status.textContent = existingFund ? '已重新计算份额和成本，并填入已有分组' : '已重新计算份额和成本';
        showNotice(existingFund ? '已重新计算，并填入已有分组' : '已重新计算该基金的份额和成本', 'success', 4000);
    }

    function addImportSelected() {
        syncImportRowsToState();
        const selectedEntries = state.importCandidates
            .map((candidate, index) => ({ candidate, index }))
            .filter(entry => entry.candidate.selected);
        let added = 0;
        let skipped = 0;
        let updated = 0;
        const processedIndexes = new Set();

        if (selectedEntries.length === 0) {
            showNotice('请先选择要归类的基金', 'error', 5000);
            return;
        }

        const defaultGroup = getDefaultImportGroup();
        const groupSource = selectedEntries.find(entry => entry.candidate.group && entry.candidate.group !== defaultGroup) || selectedEntries[0];
        const targetGroup = (groupSource.candidate.group || defaultGroup).trim() || '默认分组';

        if (targetGroup.length > 32) {
            showNotice('分组名称不能超过 32 个字符', 'error', 5000);
            return;
        }

        selectedEntries.forEach(({ candidate, index }) => {
            const code = String(candidate.code || '').trim();
            const shares = String(candidate.shares || '').trim();
            const cost = String(candidate.cost || '').trim();

            if (!/^\d{6}$/.test(code) ||
                shares === '' || Number.isNaN(Number(shares)) || Number(shares) <= 0 ||
                (cost !== '' && (Number.isNaN(Number(cost)) || Number(cost) < 0))) {
                skipped += 1;
                return;
            }

            if (state.myFunds.some(fund => fund.code === code)) {
                if (updateExistingFundFromCandidate({ ...candidate, code, shares, cost })) {
                    storeCandidateSnapshotOverride(code, candidate);
                    updated += 1;
                    processedIndexes.add(index);
                } else {
                    skipped += 1;
                }
                return;
            }

            state.myFunds.push({
                code,
                shares,
                cost,
                group: targetGroup
            });
            storeCandidateSnapshotOverride(code, candidate);
            added += 1;
            processedIndexes.add(index);
        });

        if (added === 0 && updated === 0) {
            showNotice(skipped > 0 ? '没有可归类的基金，请检查代码、份额或成本' : '请先选择要归类的基金', 'error', 5000);
            return;
        }

        state.importCandidates = state.importCandidates.filter((_, index) => !processedIndexes.has(index));
        if (updated > 0) state.importAutoUpdatedCount = (state.importAutoUpdatedCount || 0) + updated;
        app.persistFunds();
        renderUI(true);
        app.data.refreshNetworkData();
        renderImportResults(state.importCandidates);

        const status = document.getElementById('importStatus');
        if (status) status.textContent = state.importCandidates.length ? `剩余 ${state.importCandidates.length} 只待归类基金` : '本次截图中的基金已处理完';
        showNotice(`已归类 ${added} 只基金到「${targetGroup}」${updated ? `，更新 ${updated} 只已有基金` : ''}${skipped ? `，跳过 ${skipped} 只` : ''}`, 'success', 5000);
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

        const oldCode = index >= 0 && state.myFunds[index] ? state.myFunds[index].code : '';
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

        clearSnapshotOverride(oldCode);
        clearSnapshotOverride(code);
        app.persistFunds();
        state.addModal.hide();
        renderUI(true);
        app.data.refreshNetworkData();
    }

    function deleteFund() {
        if (confirm('确定删除这笔资产？')) {
            const index = Number(document.getElementById('editIndex').value);
            const fund = state.myFunds[index];
            if (fund) clearSnapshotOverride(fund.code);
            state.myFunds.splice(index, 1);
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
        openImportModal,
        resetImportModal,
        openEditModal,
        selectGroup,
        saveFund,
        deleteFund,
        sortGroupList,
        importFromScreenshot,
        recalculateImportCandidate,
        addImportSelected,
        applyImportSuggestion
    };
})();
