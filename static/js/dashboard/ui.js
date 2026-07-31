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
        const amountMatch = String(displayText).match(/^(¥?)([+-]?)([\d,.]+)([万亿]?)$/);

        if (!amountMatch) {
            return `<span class="num-fit" title="${utils.escapeHtml(titleText)}">${utils.escapeHtml(displayText)}</span>`;
        }

        const [, currencySymbol, sign, numberText, unit] = amountMatch;
        return `<span class="num-fit amount-text" title="${utils.escapeHtml(titleText)}">${currencySymbol ? `<span class="amount-symbol">${utils.escapeHtml(currencySymbol)}</span>` : ''}<span class="amount-number">${utils.escapeHtml(sign + numberText)}</span>${unit ? `<span class="amount-unit">${utils.escapeHtml(unit)}</span>` : ''}</span>`;
    }

    function renderIcon(name) {
        const icons = {
            add: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>',
            sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 16h5v5"></path></svg>',
            more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>',
            overview: '<svg viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>',
            holdings: '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>',
            import: '<svg viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>'
        };
        return icons[name] || '';
    }

    function renderMobileQuickActions() {
        return `
            <div class="mobile-quick-actions" aria-label="快捷工具">
                <button class="mobile-quick-action" data-action="open-add">
                    <span class="mobile-quick-icon" aria-hidden="true">${renderIcon('add')}</span>
                    <span>添加</span>
                </button>
                <button class="mobile-quick-action" data-action="open-sync">
                    <span class="mobile-quick-icon" aria-hidden="true">${renderIcon('sync')}</span>
                    <span>同步</span>
                </button>
                <button class="mobile-quick-action" type="button" data-bs-toggle="modal" data-bs-target="#mobileMoreModal">
                    <span class="mobile-quick-icon" aria-hidden="true">${renderIcon('more')}</span>
                    <span>更多</span>
                </button>
            </div>`;
    }

    function renderMobileTabs(groups) {
        let tabsHtml = `
            <nav class="mobile-tabs" aria-label="分组切换">
                <button class="mobile-tab ${state.activeTabId === 'tab-summary' ? 'active' : ''}" data-action="switch-tab" data-tab-id="tab-summary">概览</button>`;

        groups.forEach((group, index) => {
            const tabId = `tab-group-${index}`;
            tabsHtml += `
                <button class="mobile-tab ${state.activeTabId === tabId ? 'active' : ''}" data-action="switch-tab" data-tab-id="${utils.escapeHtml(tabId)}" data-group-name="${utils.escapeHtml(group)}">${utils.escapeHtml(group)}</button>`;
        });

        return `${tabsHtml}</nav>`;
    }

    function renderMobileBottomNav(groups) {
        const nav = document.getElementById('mobileBottomNav');
        if (!nav) return;

        const inSummary = state.activeTabId === 'tab-summary';
        const inGroup = !inSummary;
        nav.innerHTML = `
            <button class="mobile-nav-item ${inSummary ? 'active' : ''}" data-action="switch-tab" data-tab-id="tab-summary">
                <span class="mobile-nav-icon" aria-hidden="true">${renderIcon('overview')}</span>
                <span>概览</span>
            </button>
            <button class="mobile-nav-item ${inGroup ? 'active' : ''}" data-action="switch-first-group">
                <span class="mobile-nav-icon" aria-hidden="true">${renderIcon('holdings')}</span>
                <span>持仓</span>
            </button>
            <button class="mobile-nav-item" data-action="open-import">
                <span class="mobile-nav-icon" aria-hidden="true">${renderIcon('import')}</span>
                <span>导入</span>
            </button>`;
        nav.dataset.hasGroups = groups.length > 0 ? 'true' : 'false';
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
        renderMobileBottomNav(groups);
    }

    function switchTab(tabId, groupName) {
        state.activeTabId = tabId;
        state.currentActiveGroup = groupName || null;
        app.persistActiveTab();
        renderUI(false);
    }

    function switchToHoldings() {
        const groups = logic.getGroups(state.myFunds);
        if (!groups.length) {
            showNotice('还没有可查看的持仓分组', 'info');
            return;
        }
        switchTab('tab-group-0', groups[0]);
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
        const settledCount = displayData.filter(item => logic.hasCompleteDisplayMetrics(item)).length;
        const unavailableCount = displayData.filter(item => item.isUnavailable).length;
        const resolvedCount = settledCount + unavailableCount;
        const groupRows = renderSummaryGroupFolds(displayData, distribution, groupStats);

        const stripSegments = distribution.map((item, index) => {
            const tone = DISTRIBUTION_TONES[index % DISTRIBUTION_TONES.length];
            return `<span class="asset-strip-segment ${tone}" style="width:${item.percent.toFixed(2)}%"></span>`;
        }).join('');

        const syncHint = localStorage.getItem('lastSyncCode')
            ? '本机已记住同步码，可直接恢复云端数据。'
            : '当前设备还没有保存同步码。';
        const isFullySettled = settledCount === displayData.length;
        const settledStatusText = isFullySettled
            ? '已完成本轮计算'
            : (resolvedCount === displayData.length ? `${unavailableCount} 项净值暂不可用` : '正在补齐净值');
        const marketTimeText = utils.formatMarketTime(lastTime);

        return `
            <section class="page-shell page-shell-summary">
                <div class="summary-main">
                    <div class="panel summary-hero">
                        <div class="panel-kicker">资金看板</div>
                        <div class="summary-header">
                            <div class="summary-primary">
                                <div class="summary-title">总资产</div>
                                <div class="summary-main-num">${renderAmountText(totalAssets, { currency: true })}</div>
                            </div>
                            <div class="summary-status-stack">
                                <div class="summary-status ${isFullySettled ? 'summary-status-ready' : 'summary-status-loading'}">
                                    ${settledStatusText}
                                </div>
                                <div class="summary-status-meta">${state.myFunds.length} 项持仓 | ${settledCount} 项已计算</div>
                                <div class="summary-status-meta">${utils.escapeHtml(marketTimeText)}</div>
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
                        <div class="distribution-block desktop-distribution">
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
                    ${renderMobileQuickActions()}
                    ${renderMobileTabs(groups)}
                    <div class="mobile-distribution">
                        <div class="asset-strip">${stripSegments}</div>
                        <div class="asset-legend">${groupRows || '<div class="empty-inline">本轮还没有可展示的分组数据</div>'}</div>
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
                                <span class="fact-value">${utils.escapeHtml(utils.formatMarketTime(lastTime))}</span>
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
                .filter(entry => logic.hasCompleteDisplayMetrics(entry) && (entry.group || '默认分组') === item.name)
                .reduce((sum, entry) => sum + Number(entry.holdProfit), 0);
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
                            <div class="group-row-profit-line">
                                <span class="profit-label">今日</span>
                                <span class="${utils.getColorClass(dailyProfit)}">${renderAmountText(dailyProfit, { forceSign: true })}</span>
                                <span class="profit-separator"> | </span>
                                <span class="profit-label">持有</span>
                                <span class="${utils.getColorClass(holdProfit)}">${renderAmountText(holdProfit, { forceSign: true })}</span>
                            </div>
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
                    ${renderMobileTabs(groups)}
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
        const groupSummaryHtml = renderGroupTabSummary(currentGroupName, groupItems);

        return `
            <section class="page-shell page-shell-group">
                ${renderMobileTabs(groups)}
                ${groupSummaryHtml}
                <div class="panel fund-list-panel">
                    <div class="fund-list-head">
                        <div class="fund-list-head-main">基金</div>
                        <div class="fund-list-head-metrics">
                            ${renderSortableHead('estNav', '估算/实际净值', '净值')}
                            ${renderSortableHead('dailyProfit', '当日(估)', '当日')}
                            ${renderSortableHead('holdProfit', '持有盈亏', '持有')}
                        </div>
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

    function renderGroupTabSummary(groupName, groupItems) {
        const totalAsset = (groupItems || []).reduce((sum, item) => {
            if (logic.hasCompleteDisplayMetrics(item)) {
                return sum + Number(item.totalAsset);
            }
            return sum;
        }, 0);
        const sort = state.groupListSort || {};
        const keyLabels = {
            estNav: '净值',
            dailyProfit: '当日盈亏',
            holdProfit: '持有盈亏'
        };
        const sortKey = ['estNav', 'dailyProfit', 'holdProfit'].includes(sort.key) ? sort.key : 'dailyProfit';
        const direction = sort.direction === 'asc' ? '升序' : '降序';

        return `
            <div class="mobile-group-summary" aria-label="${utils.escapeHtml(groupName || '当前分组')}概览">
                <div class="mobile-group-summary-meta">${groupItems.length} 项资产 | 按${keyLabels[sortKey]}${direction}</div>
                <div class="mobile-group-summary-asset">${renderAmountText(totalAsset, { currency: true, compact: false })}</div>
            </div>`;
    }

    function renderSortableHead(key, label, shortLabel = label) {
        const sort = state.groupListSort || {};
        const isActive = sort.key === key;
        const direction = isActive ? sort.direction : 'desc';
        const title = `${label}${direction === 'asc' ? '升序' : '降序'}`;

        return `
            <div class="fund-head-sort">
                <span class="fund-sort-label fund-sort-label-full">${utils.escapeHtml(label)}</span>
                <span class="fund-sort-label fund-sort-label-short">${utils.escapeHtml(shortLabel)}</span>
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
                <div class="fund-list-metrics">
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
                </div>
            </article>`;
    }

    function buildAssetDistribution(displayData) {
        const totals = new Map();

        (displayData || []).forEach(item => {
            if (!logic.hasCompleteDisplayMetrics(item)) return;

            const groupName = item.group || '默认分组';
            const prev = totals.get(groupName) || { name: groupName, assets: 0, count: 0 };
            prev.assets += Number(item.totalAsset);
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

    function setImportFooterState(visible, confirmVisible = visible) {
        const footer = document.getElementById('importFooter');
        const confirm = document.getElementById('btnImportConfirm');
        if (footer) footer.classList.toggle('d-none', !visible);
        if (confirm) confirm.classList.toggle('d-none', !confirmVisible);
    }

    function setImportView(view) {
        const modal = document.getElementById('importModal');
        if (modal) modal.dataset.view = view;
    }

    function resetImportModal() {
        const input = document.getElementById('importImageInput');
        const status = document.getElementById('importStatus');
        const progress = document.getElementById('importProgress');
        const results = document.getElementById('importResults');

        state.importCandidates = [];
        state.importAutoUpdatedCount = 0;
        state.importEditingIndex = null;
        setImportView('upload');
        if (input) input.value = '';
        if (status) status.textContent = '支持批量选择基金持有页截图';
        if (progress) progress.classList.add('d-none');
        setImportProgress(0);
        setImportFooterState(false);
        const selectAll = document.getElementById('importSelectAll');
        if (selectAll) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
        }
        if (results) {
            results.innerHTML = '';
            results.classList.add('d-none');
        }
    }

    function setImportProcessingStatus(phase, currentIndex = 0, total = 1) {
        const status = document.getElementById('importStatus');
        if (!status) return;

        const label = phase === 'upload' ? '正在上传' : '正在识别';
        status.textContent = total > 1 ? `${label} ${currentIndex + 1}/${total}` : label;
    }

    function setImportProgress(percent) {
        const bar = document.getElementById('importProgressBar');
        if (!bar) return;
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        bar.style.width = `${safePercent}%`;
    }

    async function fillSharesFromAmount(code, amount, preferredNav = null) {
        const holdingAmount = Number(amount);
        if (!code || !Number.isFinite(holdingAmount) || holdingAmount <= 0) return false;

        const suppliedNav = Number(preferredNav);
        const nav = Number.isFinite(suppliedNav) && suppliedNav > 0
            ? suppliedNav
            : await app.ocr.fetchLatestNav(code);
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

    function getCachedImportNav(code) {
        const fundIndex = state.myFunds.findIndex(fund => fund.code === code);
        if (fundIndex < 0) return null;
        const nav = Number(state.cachedResults[fundIndex]?.estNav);
        return Number.isFinite(nav) && nav > 0 ? nav : null;
    }

    function storeCandidateSnapshotOverride(code, candidate) {
        const amount = Number(candidate && candidate.amount);
        const holdProfit = Number(candidate && candidate.holdProfit);
        if (!/^\d{6}$/.test(code || '') || !Number.isFinite(amount) || !Number.isFinite(holdProfit)) return;

        const shares = Number(candidate && candidate.shares);
        const rawNav = candidate && candidate.nav;
        const nav = rawNav !== '' && rawNav !== undefined ? Number(rawNav) : NaN;
        const inferredNav = Number.isFinite(nav) && nav > 0
            ? nav
            : (Number.isFinite(shares) && shares > 0 ? amount / shares : NaN);
        const rawDailyProfit = candidate && candidate.dailyProfit;
        const dailyProfit = rawDailyProfit !== '' && rawDailyProfit !== undefined
            ? Number(rawDailyProfit)
            : NaN;
        const rawRate = candidate && candidate.rate;
        const estRate = rawRate !== '' && rawRate !== undefined ? Number(rawRate) : NaN;

        state.syncSnapshotOverrides = state.syncSnapshotOverrides || {};
        const override = {
            ...(state.syncSnapshotOverrides[code] || {}),
            totalAsset: amount,
            holdProfit,
            updatedAt: new Date().toISOString()
        };
        if (Number.isFinite(inferredNav)) override.estNav = inferredNav;
        if (Number.isFinite(dailyProfit)) override.dailyProfit = dailyProfit;
        if (Number.isFinite(estRate)) override.estRate = estRate;
        state.syncSnapshotOverrides[code] = override;
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
        const group = String(candidate.group || '').trim() || state.myFunds[index].group || '默认分组';

        state.myFunds[index] = {
            ...state.myFunds[index],
            shares: candidate.shares,
            cost: candidate.cost !== '' ? candidate.cost : state.myFunds[index].cost,
            group
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

    function buildImportRow(candidate, index) {
        const hasCode = /^\d{6}$/.test(candidate.code || '');
        const hasSuggestions = Array.isArray(candidate.suggestions) && candidate.suggestions.length > 0 && !hasCode;
        const disabledNote = candidate.shares
            ? ''
            : `<div class="import-row-warning">${hasCode ? '未能反推份额，请检查代码或手动填写。' : (hasSuggestions ? '存在多个相似候选，请选择正确基金。' : '无法匹配基金代码，请输入代码后重新计算份额和成本。')}</div>`;
        const matchStatus = hasCode ? utils.escapeHtml(candidate.code) : (hasSuggestions ? '待选择候选' : '无法匹配');
        const amountText = candidate.amount ? utils.escapeHtml(candidate.amount) : '--';
        const holdProfitText = candidate.holdProfit ? utils.escapeHtml(candidate.holdProfit) : '--';
        const group = candidate.group || getDefaultImportGroup();
        const rowClass = candidate.existing ? 'import-row-existing' : 'import-row-new';

        return `
            <article class="import-row ${rowClass}" data-import-index="${index}">
                <label class="import-row-check">
                    <input type="checkbox" class="import-select" ${candidate.selected ? 'checked' : ''}>
                </label>
                <button type="button" class="import-row-main import-row-open" data-action="edit-import-row" data-import-index="${index}">
                    <div class="import-row-summary">
                        <div class="import-row-identity">
                            <div class="import-row-title">
                                <div class="import-row-name">${utils.escapeHtml(candidate.name)}</div>
                                <span class="import-group-badge">${utils.escapeHtml(group)}</span>
                            </div>
                            <div class="import-row-meta">${matchStatus}</div>
                        </div>
                        <div class="import-row-metrics" aria-label="识别金额概览">
                            <div class="import-row-metric">
                                <div class="import-row-metric-label">金额</div>
                                <div class="import-row-metric-value">${amountText}</div>
                            </div>
                            <div class="import-row-metric">
                                <div class="import-row-metric-label">持有收益</div>
                                <div class="import-row-metric-value">${holdProfitText}</div>
                            </div>
                        </div>
                    </div>
                    ${disabledNote}
                </button>
            </article>`;
    }

    function getImportGroupOptions(currentGroup) {
        const groups = new Set(['默认分组']);
        state.myFunds.forEach(fund => {
            const group = String(fund.group || '').trim();
            if (group) groups.add(group);
        });
        state.importCandidates.forEach(candidate => {
            const group = String(candidate.group || '').trim();
            if (group) groups.add(group);
        });
        if (state.currentActiveGroup) groups.add(state.currentActiveGroup);
        if (currentGroup) groups.add(currentGroup);
        return Array.from(groups);
    }

    function buildImportBulkBar(candidates) {
        const selectedCount = candidates.filter(candidate => candidate.selected).length;
        const groupOptions = getImportGroupOptions()
            .map(option => `
                <button type="button" class="import-bulk-group-option" data-action="apply-import-bulk-group" data-group="${utils.escapeHtml(option)}">
                    ${utils.escapeHtml(option)}
                </button>`)
            .join('');

        return `
            <div class="import-bulk-bar" id="importBulkBar">
                <span class="import-select-all-check">
                    <input type="checkbox" id="importSelectAll">
                </span>
                <div class="import-bulk-main">
                    <label class="import-select-all" for="importSelectAll">全选</label>
                    <span class="import-selected-count" id="importSelectedCount">已选 ${selectedCount} 项</span>
                    <span class="import-total-count">共 ${candidates.length} 项</span>
                    <span class="import-compact-count" id="importCompactCount">${selectedCount}/${candidates.length}</span>
                    <div class="import-bulk-group" id="importBulkGroupRoot">
                        <button type="button" class="import-bulk-group-trigger" id="importBulkGroup" data-action="toggle-import-bulk-group" aria-haspopup="listbox" aria-expanded="false" ${selectedCount ? '' : 'disabled'}>
                            <span>选择分组</span>
                            <i class="bi bi-chevron-down" aria-hidden="true"></i>
                        </button>
                        <div class="import-bulk-group-menu d-none" id="importBulkGroupMenu" role="listbox">
                            <div class="import-bulk-group-options">
                                ${groupOptions}
                            </div>
                            <div class="import-bulk-group-custom">
                                <input type="text" class="form-control import-bulk-custom-input" id="importBulkCustomInput" placeholder="自定义名称" maxlength="32">
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    function buildImportEditPanel(candidate, index) {
        const group = candidate.group || getDefaultImportGroup();
        const sharesValue = candidate.shares !== '' && candidate.shares !== undefined ? Number(candidate.shares) : NaN;
        const costValue = candidate.cost !== '' && candidate.cost !== undefined ? Number(candidate.cost) : NaN;
        const amountValue = candidate.amount !== '' && candidate.amount !== undefined ? Number(candidate.amount) : NaN;
        const costAmount = Number.isFinite(sharesValue) && Number.isFinite(costValue)
            ? sharesValue * costValue
            : null;
        const costAmountText = costAmount !== null ? utils.formatAmount(costAmount, { compact: false }) : '--';
        const amountText = Number.isFinite(amountValue) ? utils.formatAmount(amountValue, { compact: false }) : '--';
        const sharesText = candidate.shares || '--';
        const costText = candidate.cost || '--';
        const groupOptions = getImportGroupOptions(group)
            .map(option => `<option value="${utils.escapeHtml(option)}" ${option === group ? 'selected' : ''}>${utils.escapeHtml(option)}</option>`)
            .join('');

        return `
            <div class="import-edit-panel" data-import-index="${index}">
                <div class="import-edit-head">
                    <button type="button" class="import-back-btn" data-action="back-import-list">
                        <i class="bi bi-chevron-left"></i>
                        <span>返回</span>
                    </button>
                    <div class="import-edit-title">
                        <div class="import-row-name">${utils.escapeHtml(candidate.name)}</div>
                    </div>
                </div>
                ${buildImportSuggestionControl(candidate, index)}
                <div class="import-row-fields import-edit-fields">
                    <div class="import-row-field import-code-field">
                        <label class="form-label form-label-soft">基金代码</label>
                        <input type="text" inputmode="numeric" maxlength="6" class="form-control import-code" value="${utils.escapeHtml(candidate.code || '')}" placeholder="6位代码">
                    </div>
                    <div class="import-row-field import-shares-field">
                        <label class="form-label form-label-soft">持仓份额（份）</label>
                        <div class="import-unit-control">
                            <input type="number" class="form-control import-shares" value="${utils.escapeHtml(candidate.shares || '')}" placeholder="手动填写">
                            <span class="import-unit-addon">份</span>
                        </div>
                    </div>
                    <div class="import-row-field import-cost-field">
                        <label class="form-label form-label-soft">单位成本（元）</label>
                        <div class="import-unit-control">
                            <input type="number" class="form-control import-cost" value="${utils.escapeHtml(candidate.cost || '')}" placeholder="选填">
                            <span class="import-unit-addon">元</span>
                        </div>
                    </div>
                    <div class="import-row-field import-group-field">
                        <label class="form-label form-label-soft">所属投资分组</label>
                        <div class="import-select-control">
                            <select class="form-select import-group">
                                ${groupOptions}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="import-edit-summary">
                    <div>
                        <div class="import-edit-summary-label">持仓成本估算</div>
                        <div class="import-edit-formula">
                            <span class="import-edit-factor import-edit-shares-preview">${utils.escapeHtml(sharesText)}</span>
                            <em class="import-edit-unit">份</em>
                            <em class="import-edit-operator">×</em>
                            <span class="import-edit-factor import-edit-cost-preview">${utils.escapeHtml(costText)}</span>
                            <em class="import-edit-unit">元/份</em>
                        </div>
                    </div>
                    <div class="import-edit-summary-value">
                        <div class="import-edit-summary-label">估算持仓成本</div>
                        <strong class="import-edit-total-preview">¥${utils.escapeHtml(costAmountText)}</strong>
                    </div>
                </div>
                <div class="import-edit-actions">
                    <button type="button" class="import-remove-btn" data-action="request-remove-import-row" data-import-index="${index}">
                        <svg class="import-remove-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9 4h6l1 2h4v2H4V6h4l1-2Zm1 6v8h2v-8h-2Zm4 0v8h2v-8h-2ZM7 10h2v9h6v-9h2v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10Z" fill="currentColor"/>
                        </svg>
                        <span>移除此项</span>
                    </button>
                    <div class="import-edit-action-right">
                        <button type="button" class="import-edit-save-btn" data-action="save-import-edit">
                            <svg class="import-save-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M5 4h11l3 3v13H5V4Zm2 2v12h10V8.2L14.8 6H7Zm2 1h5v5H9V7Zm1 8h4v2h-4v-2Z" fill="currentColor"/>
                            </svg>
                            <span>保存并返回</span>
                        </button>
                    </div>
                </div>
                <div class="import-remove-confirm d-none" data-remove-confirm="${index}">
                    <div>
                        <div class="import-remove-confirm-title">确认移除此项？</div>
                        <div class="import-remove-confirm-text">移除后不会导入这条识别结果。</div>
                    </div>
                    <div class="import-remove-confirm-actions">
                        <button type="button" class="import-remove-cancel-btn" data-action="cancel-remove-import-row">取消</button>
                        <button type="button" class="import-remove-confirm-btn" data-action="confirm-remove-import-row" data-import-index="${index}">确认移除</button>
                    </div>
                </div>
            </div>`;
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
            setImportFooterState(true, false);
            return;
        }

        const editingIndex = state.importEditingIndex;
        if (editingIndex !== null && Number.isInteger(editingIndex) && candidates[editingIndex]) {
            results.innerHTML = `
                ${buildImportEditPanel(candidates[editingIndex], editingIndex)}`;
            results.classList.remove('d-none');
            setImportFooterState(false);
            return;
        }

        results.innerHTML = `
            <div class="import-result-head">
                <div>
                    <div class="section-subtitle">勾选需要导入的基金；点击单行可编辑代码、份额、成本和分组。</div>
                </div>
                <div class="section-meta">${candidates.length} 项</div>
            </div>
            ${updatedNote}
            ${buildImportBulkBar(candidates)}
            <div class="import-list">
                ${candidates.map(buildImportRow).join('')}
            </div>`;
        results.classList.remove('d-none');
        updateImportSelectAllState();
        setImportFooterState(true, true);
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
        setImportFooterState(true, false);
    }

    async function hydrateImportCandidates(candidates) {
        const status = document.getElementById('importStatus');
        const uniqueCandidates = [];
        const seenCodes = new Set();

        const seenUnmatched = new Set();

        const getCandidateQuality = candidate => {
            let score = 0;
            if (candidate.amount) score += 3;
            if (candidate.holdProfit) score += 3;
            if (candidate.name && !/^基金 \d{6}$/.test(candidate.name)) score += 2;
            ['dailyProfit', 'shares', 'cost', 'nav', 'rate'].forEach(field => {
                if (candidate[field]) score += 1;
            });
            if (/layout/i.test(String(candidate.source || ''))) score += 1;
            return score;
        };

        const mergeDuplicateCandidate = (existing, candidate) => {
            const preferIncoming = getCandidateQuality(candidate) > getCandidateQuality(existing);
            const metricFields = ['amount', 'holdProfit', 'dailyProfit'];
            const fillFields = ['name', 'type', 'shares', 'cost', 'nav', 'rate', 'source'];

            metricFields.forEach(field => {
                if (candidate[field] && (!existing[field] || preferIncoming)) {
                    existing[field] = candidate[field];
                }
            });
            fillFields.forEach(field => {
                const existingIsGenericName = field === 'name' && /^基金 \d{6}$/.test(existing[field] || '');
                if (candidate[field] && (!existing[field] || existingIsGenericName)) {
                    existing[field] = candidate[field];
                }
            });
            existing.fieldSources = {
                ...(existing.fieldSources || {}),
                ...(candidate.fieldSources || {})
            };
            existing.suggestions = (existing.suggestions || []).length >= (candidate.suggestions || []).length
                ? existing.suggestions
                : candidate.suggestions;
            existing.unmatched = false;
        };

        const getMetricKey = candidate => {
            const amount = Number(candidate.amount);
            const holdProfit = Number(candidate.holdProfit);
            if (!Number.isFinite(amount) || !Number.isFinite(holdProfit)) return '';
            return `${amount.toFixed(2)}|${holdProfit.toFixed(2)}`;
        };

        candidates.forEach(candidate => {
            if (candidate.code && seenCodes.has(candidate.code)) {
                const duplicate = uniqueCandidates.find(existing => existing.code === candidate.code);
                if (duplicate) mergeDuplicateCandidate(duplicate, candidate);
                return;
            }
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
                dailyProfit: candidate.dailyProfit || '',
                type: candidate.type || '',
                suggestions: Array.isArray(candidate.suggestions) ? candidate.suggestions : [],
                source: candidate.source || '',
                fieldSources: candidate.fieldSources || {},
                unmatched: Boolean(candidate.unmatched || !candidate.code),
                existing: Boolean(existingFund),
                group: existingFund ? (existingFund.group || '默认分组') : getDefaultImportGroup(),
                shares: candidate.shares || '',
                cost: candidate.cost || '',
                nav: candidate.nav || '',
                rate: candidate.rate || '',
                selected: false
            });
        });

        const pendingCodes = uniqueCandidates
            .filter(candidate => candidate.code && !candidate.shares)
            .map(candidate => candidate.code);
        const navByCode = await app.ocr.fetchLatestNavBatch(pendingCodes);

        for (let index = 0; index < uniqueCandidates.length; index += 1) {
            const candidate = uniqueCandidates[index];
            setImportProcessingStatus('recognize', index, uniqueCandidates.length);
            if (uniqueCandidates.length) {
                setImportProgress(85 + Math.round(((index + 1) / uniqueCandidates.length) * 12));
            }
            if (candidate.code && !candidate.shares) {
                const inferred = await fillSharesFromAmount(
                    candidate.code,
                    candidate.amount,
                    navByCode[candidate.code] || getCachedImportNav(candidate.code)
                );
                if (inferred) {
                    candidate.shares = inferred.shares;
                    candidate.nav = inferred.nav;
                    candidate.cost = inferCostFromProfit(candidate.amount, candidate.holdProfit, candidate.shares);
                }
            } else if (candidate.shares && !candidate.cost) {
                candidate.cost = inferCostFromProfit(candidate.amount, candidate.holdProfit, candidate.shares);
            }
        }

        const reviewCandidates = app.logic.sortImportCandidatesForReview(uniqueCandidates);
        const attentionCount = reviewCandidates.filter(candidate =>
            app.logic.getImportCandidateReviewRank(candidate) < 2
        ).length;

        state.importAutoUpdatedCount = 0;
        state.importEditingIndex = null;
        state.importCandidates = reviewCandidates;
        renderImportResults(reviewCandidates);
        if (status) {
            const existingCount = reviewCandidates.filter(candidate => candidate.existing).length;
            const attentionText = attentionCount ? `，${attentionCount} 只需处理并已置顶` : '';
            status.textContent = reviewCandidates.length
                ? `已读取 ${reviewCandidates.length} 只基金${attentionText}${existingCount ? `，其中 ${existingCount} 只已持仓并已填入原分组` : ''}`
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
                shares: parsed.shares || '',
                cost: parsed.cost || '',
                holdProfit: parsed.holdProfit || '',
                dailyProfit: parsed.dailyProfit || '',
                nav: parsed.nav || '',
                rate: parsed.rate || '',
                fieldSources: parsed.fieldSources || {},
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

        progress.classList.remove('d-none');
        setImportProcessingStatus('upload', 0, files.length);
        setImportProgress(8);
        setImportFooterState(false);
        setImportView('processing');

        try {
            const parsedResults = [];
            const allCandidates = [];
            const failedFiles = [];

            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                setImportProcessingStatus('upload', index, files.length);
                try {
                    const parsed = await app.ocr.recognizeBestAlipayScreenshot(file, (percent, label) => {
                        const currentPercent = Math.max(8, Math.min(100, percent || 0));
                        const phase = String(label || '').includes('上传') ? 'upload' : 'recognize';
                        const recognitionPercent = Math.round(((index + currentPercent / 100) / files.length) * 84);
                        const overallPercent = Math.max(8, Math.min(92, recognitionPercent));
                        setImportProgress(overallPercent);
                        setImportProcessingStatus(phase, index, files.length);
                    });

                    parsedResults.push(parsed);
                    allCandidates.push(...buildCandidatesFromParsed(parsed));
                } catch (error) {
                    console.error('screenshot recognition failed', file.name, error);
                    failedFiles.push({
                        name: file.name || `截图 ${index + 1}`,
                        message: error && error.message ? error.message : '未知错误'
                    });
                    parsedResults.push({
                        rawText: '',
                        ocrTextLength: 0,
                        message: `${file.name || `截图 ${index + 1}`} 识别失败`
                    });
                }
            }

            await hydrateImportCandidates(allCandidates);
            setImportProgress(100);

            if (!state.importCandidates.length) {
                const diagnostics = buildBatchImportDiagnostics(parsedResults);
                setImportView('results');
                renderImportDiagnostics(diagnostics);
                const failedText = failedFiles.length ? `${failedFiles.length} 张截图识别失败；` : '';
                status.textContent = `${failedText}${diagnostics.message || '未识别到可填字段'}`;
                showNotice(status.textContent || '未识别到基金代码、份额或成本，请手动填写', 'error', 5000);
            } else {
                setImportView('results');
                const engines = [...new Set(parsedResults.map(parsed => parsed.ocrEngine).filter(Boolean))];
                const engineText = engines.length ? `（${engines.join('、')}）` : '';
                const failureText = failedFiles.length ? `，另有 ${failedFiles.length} 张失败，可重新选择这些截图` : '';
                showNotice(`${files.length > 1 ? '批量截图' : '截图'}读取完成${engineText}${failureText}，已持仓基金已自动填入原分组`, failedFiles.length ? 'info' : 'success', 6000);
            }
        } catch (error) {
            console.error('importFromScreenshot failed', error);
            const message = error && error.message ? error.message : '未知错误';
            status.textContent = `识别失败：${message}`;
            setImportFooterState(true, false);
            setImportView('results');
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
        });

        const editPanel = document.querySelector('.import-edit-panel');
        if (editPanel) {
            const index = Number(editPanel.dataset.importIndex);
            const candidate = state.importCandidates[index];
            if (!candidate) return;

            candidate.code = (editPanel.querySelector('.import-code')?.value || '').trim();
            candidate.shares = (editPanel.querySelector('.import-shares')?.value || '').trim();
            candidate.cost = (editPanel.querySelector('.import-cost')?.value || '').trim();
            candidate.group = (editPanel.querySelector('.import-group')?.value || '').trim() || getDefaultImportGroup();
        }
    }

    function formatImportPreviewNumber(value, digits = 4) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '--';
        return number.toFixed(digits).replace(/\.?0+$/, '');
    }

    function updateImportEditPreview() {
        const editPanel = document.querySelector('.import-edit-panel');
        if (!editPanel) return;

        const sharesInput = editPanel.querySelector('.import-shares');
        const costInput = editPanel.querySelector('.import-cost');
        const sharesText = (sharesInput?.value || '').trim();
        const costText = (costInput?.value || '').trim();
        const shares = Number(sharesText);
        const cost = Number(costText);
        const valid = sharesText !== '' && costText !== '' && Number.isFinite(shares) && Number.isFinite(cost);
        const total = valid ? shares * cost : NaN;

        const sharesPreview = editPanel.querySelector('.import-edit-shares-preview');
        const costPreview = editPanel.querySelector('.import-edit-cost-preview');
        const totalPreview = editPanel.querySelector('.import-edit-total-preview');
        if (sharesPreview) sharesPreview.textContent = valid ? formatImportPreviewNumber(shares, 2) : '--';
        if (costPreview) costPreview.textContent = valid ? formatImportPreviewNumber(cost, 4) : '--';
        if (totalPreview) totalPreview.textContent = valid ? `¥${utils.formatAmount(total, { compact: false })}` : '¥--';
    }

    function handleImportEditInput() {
        syncImportRowsToState();
        updateImportEditPreview();
    }

    function updateImportSelectAllState() {
        const selectAll = document.getElementById('importSelectAll');
        if (!selectAll) {
            return;
        }

        const checkboxes = Array.from(document.querySelectorAll('.import-select'));
        const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;
        selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
        updateImportBulkGroupState(checkedCount);
    }

    function updateImportBulkGroupState(checkedCount = null) {
        const selectedCount = checkedCount === null
            ? state.importCandidates.filter(candidate => candidate.selected).length
            : checkedCount;
        const countEl = document.getElementById('importSelectedCount');
        const compactCountEl = document.getElementById('importCompactCount');
        const groupTrigger = document.getElementById('importBulkGroup');
        if (countEl) countEl.textContent = `已选 ${selectedCount} 项`;
        if (compactCountEl) compactCountEl.textContent = `${selectedCount}/${state.importCandidates.length}`;
        if (groupTrigger) {
            groupTrigger.disabled = selectedCount === 0;
            if (selectedCount === 0) closeImportBulkGroupMenu();
        }
    }

    function toggleImportBulkGroupMenu() {
        const trigger = document.getElementById('importBulkGroup');
        const menu = document.getElementById('importBulkGroupMenu');
        if (!trigger || !menu || trigger.disabled) return;

        const shouldOpen = menu.classList.contains('d-none');
        menu.classList.toggle('d-none', !shouldOpen);
        trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');

        if (shouldOpen) {
            const customInput = document.getElementById('importBulkCustomInput');
            if (customInput) customInput.value = '';
        }
    }

    function closeImportBulkGroupMenu() {
        const trigger = document.getElementById('importBulkGroup');
        const menu = document.getElementById('importBulkGroupMenu');
        if (!menu) return;
        menu.classList.add('d-none');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function applyImportCustomGroup() {
        const customInput = document.getElementById('importBulkCustomInput');
        const targetGroup = String(customInput?.value || '').trim();
        if (!targetGroup) return;
        applyImportBulkGroup(targetGroup);
    }

    function handleImportSelectionChange() {
        syncImportRowsToState();
        updateImportSelectAllState();
    }

    function toggleImportSelectAll(checked) {
        const checkboxes = Array.from(document.querySelectorAll('.import-select'));
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });

        state.importCandidates.forEach(candidate => {
            candidate.selected = checked;
        });
        updateImportSelectAllState();
    }

    function applyImportBulkGroup(group) {
        syncImportRowsToState();
        const targetGroup = String(group || '').trim();
        if (targetGroup.length > 32) {
            showNotice('分组名称不能超过 32 个字符', 'error', 4000);
            return;
        }
        if (!targetGroup) return;

        let changed = 0;
        state.importCandidates.forEach(candidate => {
            if (!candidate.selected) return;
            candidate.group = targetGroup;
            changed += 1;
        });

        if (changed === 0) {
            showNotice('请先选择要分组的基金', 'error', 3500);
            updateImportBulkGroupState(0);
            return;
        }

        closeImportBulkGroupMenu();
        renderImportResults(state.importCandidates);
        showNotice(`已将 ${changed} 只基金分组到「${targetGroup}」`, 'success', 3000);
    }

    function editImportCandidate(index) {
        syncImportRowsToState();
        if (!state.importCandidates[index]) return;
        state.importEditingIndex = index;
        renderImportResults(state.importCandidates);
    }

    function backImportList() {
        syncImportRowsToState();
        state.importEditingIndex = null;
        renderImportResults(state.importCandidates);
    }

    function saveImportEdit() {
        syncImportRowsToState();
        state.importEditingIndex = null;
        renderImportResults(state.importCandidates);
    }

    function removeImportCandidate(index) {
        if (!state.importCandidates[index]) return;
        state.importCandidates.splice(index, 1);
        state.importEditingIndex = null;

        const status = document.getElementById('importStatus');
        if (status) {
            status.textContent = state.importCandidates.length
                ? `剩余 ${state.importCandidates.length} 只待归类基金`
                : '本次截图中的基金已处理完';
        }

        renderImportResults(state.importCandidates);
    }

    function requestRemoveImportCandidate(index) {
        const editPanel = document.querySelector(`.import-edit-panel[data-import-index="${index}"]`);
        const confirmPanel = editPanel?.querySelector(`[data-remove-confirm="${index}"]`);
        if (!confirmPanel) return;
        confirmPanel.classList.remove('d-none');
        confirmPanel.classList.add('import-remove-confirm-visible');
    }

    function cancelRemoveImportCandidate() {
        const confirmPanel = document.querySelector('.import-remove-confirm');
        if (!confirmPanel) return;
        confirmPanel.classList.add('d-none');
        confirmPanel.classList.remove('import-remove-confirm-visible');
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

        const editPanel = document.querySelector(`.import-edit-panel[data-import-index="${index}"]`);
        if (editPanel) {
            const shares = Number(candidate.shares);
            const cost = Number(candidate.cost);
            if (candidate.shares === '' || Number.isNaN(shares) || shares <= 0 ||
                candidate.cost === '' || Number.isNaN(cost) || cost < 0) {
                showNotice('请输入有效的份额和成本后再重算', 'error', 4000);
                return;
            }

            updateImportEditPreview();
            showNotice('已更新持仓成本估算', 'success', 3000);
            return;
        }

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

        const invalidGroup = selectedEntries.find(({ candidate }) => {
            const group = String(candidate.group || getDefaultImportGroup()).trim() || '默认分组';
            return group.length > 32;
        });
        if (invalidGroup) {
            showNotice('分组名称不能超过 32 个字符', 'error', 5000);
            return;
        }

        selectedEntries.forEach(({ candidate, index }) => {
            const code = String(candidate.code || '').trim();
            const shares = String(candidate.shares || '').trim();
            const cost = String(candidate.cost || '').trim();
            const group = String(candidate.group || getDefaultImportGroup()).trim() || '默认分组';

            if (!/^\d{6}$/.test(code) ||
                shares === '' || Number.isNaN(Number(shares)) || Number(shares) <= 0 ||
                (cost !== '' && (Number.isNaN(Number(cost)) || Number(cost) < 0))) {
                skipped += 1;
                return;
            }

            if (state.myFunds.some(fund => fund.code === code)) {
                if (updateExistingFundFromCandidate({ ...candidate, code, shares, cost, group })) {
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
                group
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
        state.importEditingIndex = null;
        if (updated > 0) state.importAutoUpdatedCount = (state.importAutoUpdatedCount || 0) + updated;
        app.persistFunds();
        renderUI(true);
        app.data.refreshNetworkData();
        renderImportResults(state.importCandidates);

        const status = document.getElementById('importStatus');
        if (status) status.textContent = state.importCandidates.length ? `剩余 ${state.importCandidates.length} 只待归类基金` : '本次截图中的基金已处理完';
        const groups = [...new Set(selectedEntries
            .filter(({ index }) => processedIndexes.has(index))
            .map(({ candidate }) => String(candidate.group || getDefaultImportGroup()).trim() || '默认分组'))];
        const groupText = groups.length === 1 ? `到「${groups[0]}」` : `到 ${groups.length} 个分组`;
        const actionText = added > 0
            ? `已归类 ${added} 只基金${groupText}${updated ? `，更新 ${updated} 只已有基金` : ''}`
            : `已更新 ${updated} 只已有基金${groupText}`;
        showNotice(`${actionText}${skipped ? `，跳过 ${skipped} 只` : ''}`, 'success', 5000);

        if (state.importCandidates.length === 0 && state.importModal) {
            state.importModal.hide();
        }
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
        switchToHoldings,
        openAddModal,
        openImportModal,
        resetImportModal,
        openEditModal,
        selectGroup,
        saveFund,
        deleteFund,
        sortGroupList,
        importFromScreenshot,
        editImportCandidate,
        backImportList,
        saveImportEdit,
        handleImportEditInput,
        requestRemoveImportCandidate,
        cancelRemoveImportCandidate,
        removeImportCandidate,
        handleImportSelectionChange,
        toggleImportSelectAll,
        toggleImportBulkGroupMenu,
        closeImportBulkGroupMenu,
        applyImportCustomGroup,
        applyImportBulkGroup,
        recalculateImportCandidate,
        addImportSelected,
        applyImportSuggestion
    };
})();
