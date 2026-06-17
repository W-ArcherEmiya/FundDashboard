(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state, utils, logic } = app;
    const HIST_CACHE_KEY = 'fundHistCache_v1';
    const HIST_CACHE_TTL_MS = 36 * 60 * 60 * 1000;
    const HIST_REVALIDATE_MS = 6 * 60 * 60 * 1000;
    const ESTIMATE_WAIT_MS = 4000;
    const HIST_TIMEOUT_MS = 2500;
    const HIST_RENDER_BATCH_SIZE = 5;
    const HIST_FETCH_CONCURRENCY = 6;
    const SYNC_OVERRIDE_FIELDS = ['totalAsset', 'holdProfit'];

    function loadHistCache() {
        try {
            const raw = localStorage.getItem(HIST_CACHE_KEY);
            if (!raw) return {};

            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function saveHistCache(cache) {
        localStorage.setItem(HIST_CACHE_KEY, JSON.stringify(cache));
    }

    function getHistCacheEntry(code) {
        const cache = loadHistCache();
        const entry = cache[code];
        if (!entry || typeof entry !== 'object') return null;

        if ('value' in entry) {
            const cachedAt = Number(entry.cachedAt) || 0;
            if (!cachedAt || Date.now() - cachedAt > HIST_CACHE_TTL_MS) return null;
            const value = entry.value && typeof entry.value === 'object' ? entry.value : null;
            return value ? { value, cachedAt } : null;
        }

        return { value: entry, cachedAt: 0 };
    }

    function getCachedHist(code) {
        const entry = getHistCacheEntry(code);
        return entry ? entry.value : null;
    }

    function setCachedHist(code, hist) {
        const cache = loadHistCache();
        cache[code] = {
            value: hist,
            cachedAt: Date.now()
        };
        saveHistCache(cache);
    }

    function shouldFetchHist(code, forceHist = false) {
        if (forceHist) return true;

        const entry = getHistCacheEntry(code);
        if (!entry || !entry.value) return true;
        if (!entry.cachedAt) return true;

        return Date.now() - entry.cachedAt > HIST_REVALIDATE_MS;
    }

    function mergeSyncOverride(result) {
        if (!result || !result.code) return result;

        const override = state.syncSnapshotOverrides && state.syncSnapshotOverrides[result.code];
        if (!override) return result;

        const merged = { ...result, hasSyncOverride: true };
        SYNC_OVERRIDE_FIELDS.forEach(field => {
            const value = Number(override[field]);
            if (Number.isFinite(value)) merged[field] = value;
        });
        return merged;
    }

    function applyResults(results, shouldRender = true) {
        state.cachedResults = results;
        if (shouldRender) app.ui.renderUI(false);
    }

    function openSyncModal() {
        state.syncModal.show();
    }

    function buildSyncSnapshot() {
        const cachedByCode = new Map();
        (state.cachedResults || []).forEach(item => {
            if (item && item.code) cachedByCode.set(item.code, item);
        });

        return (state.myFunds || []).map((fund, index) => {
            const direct = (state.cachedResults || [])[index];
            const override = state.syncSnapshotOverrides && state.syncSnapshotOverrides[fund.code];
            const fallback = override ? {
                code: fund.code,
                group: fund.group || '默认分组',
                name: `基金 ${fund.code}`,
                gztime: '截图快照',
                valid: true,
                isActual: true,
                isBackup: true,
                dailyProfit: 0
            } : null;
            const result = mergeSyncOverride((direct && direct.code === fund.code ? direct : cachedByCode.get(fund.code)) || fallback);
            if (!result || result.isLoading) return null;

            const snapshot = {
                code: fund.code,
                group: fund.group || '默认分组',
                name: result.name || '',
                gztime: result.gztime || '',
                valid: result.valid !== false,
                isActual: Boolean(result.isActual),
                isBackup: Boolean(result.isBackup),
                isUnavailable: Boolean(result.isUnavailable)
            };

            ['estRate', 'estNav', 'dailyProfit', 'holdProfit', 'totalAsset'].forEach(field => {
                if (Number.isFinite(result[field])) snapshot[field] = result[field];
            });

            return snapshot;
        });
    }

    function applySyncSnapshot(snapshot, funds) {
        if (!Array.isArray(snapshot) || !snapshot.length) return false;

        const snapshotByCode = new Map();
        snapshot.forEach(item => {
            if (item && item.code) snapshotByCode.set(item.code, item);
        });
        state.syncSnapshotOverrides = state.syncSnapshotOverrides || {};

        const results = (funds || []).map((fund, index) => {
            const direct = snapshot[index];
            const item = direct && direct.code === fund.code ? direct : snapshotByCode.get(fund.code);
            if (!item) return null;
            const override = {};
            SYNC_OVERRIDE_FIELDS.forEach(field => {
                const value = Number(item[field]);
                if (Number.isFinite(value)) override[field] = value;
            });
            if (Object.keys(override).length) {
                state.syncSnapshotOverrides[fund.code] = {
                    ...state.syncSnapshotOverrides[fund.code],
                    ...override,
                    updatedAt: new Date().toISOString()
                };
            }

            return {
                ...item,
                code: fund.code,
                group: fund.group || item.group || '默认分组',
                valid: item.valid !== false,
                isSyncSnapshot: true
            };
        });

        const hasUsableSnapshot = results.some(item => logic.hasCompleteDisplayMetrics(item));
        if (!hasUsableSnapshot) {
            state.cachedResults = [];
            return false;
        }
        state.cachedResults = results;
        app.persistSyncSnapshotOverrides();
        return true;
    }

    function needsSnapshotRefresh() {
        return (state.myFunds || []).some((fund, index) => {
            const item = (state.cachedResults || [])[index];
            return !logic.hasCompleteDisplayMetrics(item) && !(item && item.isUnavailable);
        });
    }

    async function uploadSyncData() {
        const code = document.getElementById('syncCodeInput').value.trim();
        if (!code) {
            app.ui.showNotice('请输入同步码', 'error');
            return;
        }
        if (state.myFunds.length === 0) {
            app.ui.showNotice('本地还没有可上传的数据', 'error');
            return;
        }

        const btn = document.getElementById('btnUpload');
        btn.innerHTML = '上传中...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/sync/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sync_code: code, data: state.myFunds, snapshot: buildSyncSnapshot() })
            });
            const resData = await response.json();
            if (resData.success) {
                localStorage.setItem('lastSyncCode', code);
                if (resData.updated_at) localStorage.setItem('lastSyncUpdatedAt', resData.updated_at);
                app.ui.showNotice('数据已上传到云端', 'success');
                state.syncModal.hide();
            } else {
                app.ui.showNotice('上传失败：' + resData.error, 'error', 4000);
            }
        } catch (e) {
            app.ui.showNotice('上传失败，网络连接异常', 'error', 4000);
        } finally {
            btn.innerHTML = '覆盖到云端';
            btn.disabled = false;
        }
    }

    async function downloadSyncData(options = {}) {
        const { syncCode = null, skipConfirm = false } = options;
        const code = (syncCode || document.getElementById('syncCodeInput').value).trim();
        if (!code) {
            app.ui.showNotice('请输入同步码', 'error');
            return;
        }
        if (state.myFunds.length > 0 && !skipConfirm && !confirm('下载将覆盖当前本地数据，继续？')) return;

        const btn = document.getElementById('btnDownload');
        btn.innerHTML = '下载中...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/sync/load/' + code);
            const resData = await response.json();
            if (resData.success) {
                state.myFunds = resData.data;
                app.persistFunds();
                localStorage.setItem('lastSyncCode', code);
                if (resData.updated_at) localStorage.setItem('lastSyncUpdatedAt', resData.updated_at);
                const syncTime = resData.updated_at ? `，云端更新时间 ${utils.formatSyncTime(resData.updated_at)}` : '';
                const hasSnapshot = applySyncSnapshot(resData.snapshot, state.myFunds);
                if (!hasSnapshot) state.cachedResults = [];
                const shouldRefreshSnapshot = hasSnapshot && needsSnapshotRefresh();
                app.ui.showNotice(`云端数据已同步到本地${syncTime}${hasSnapshot ? '，已恢复云端快照' : ''}`, 'success', 4000);
                state.syncModal.hide();
                app.ui.renderUI(!hasSnapshot);
                if (!hasSnapshot || shouldRefreshSnapshot) refreshNetworkData();
            } else {
                app.ui.showNotice('下载失败：' + resData.message, 'error', 4000);
            }
        } catch (e) {
            app.ui.showNotice('下载失败，网络异常或同步码不存在', 'error', 4000);
        } finally {
            btn.innerHTML = '下载到本地';
            btn.disabled = false;
        }
    }

    async function autoRestoreCloudData(syncCode) {
        const code = String(syncCode || '').trim();
        if (!code) return false;

        try {
            const response = await fetch('/api/sync/load/' + code);
            const resData = await response.json();
            if (!resData.success || !Array.isArray(resData.data) || resData.data.length === 0) return false;

            state.myFunds = resData.data;
            app.persistFunds();
            localStorage.setItem('lastSyncCode', code);
            if (resData.updated_at) localStorage.setItem('lastSyncUpdatedAt', resData.updated_at);

            const hasSnapshot = applySyncSnapshot(resData.snapshot, state.myFunds);
            if (hasSnapshot) {
                app.ui.renderUI(false);
                if (needsSnapshotRefresh()) refreshNetworkData();
                return true;
            }

            state.cachedResults = [];
            app.ui.renderUI(true);
            refreshNetworkData();
            return true;
        } catch {
            return false;
        }
    }

    async function restoreLastSyncData() {
        const lastSyncCode = localStorage.getItem('lastSyncCode');
        if (!lastSyncCode) {
            app.ui.showNotice('没有可恢复的同步码记录', 'error');
            return;
        }

        document.getElementById('syncCodeInput').value = lastSyncCode;
        await downloadSyncData({ syncCode: lastSyncCode, skipConfirm: true });
    }

    function buildExportRows() {
        return (state.myFunds || []).map((fund, index) => {
            const result = (state.cachedResults || [])[index] || {};
            return {
                code: fund.code || result.code || '',
                name: result.name || fund.name || '',
                shares: fund.shares || '',
                cost: fund.cost || '',
                group: fund.group || '默认分组',
                nav: Number.isFinite(result.estNav) ? result.estNav : '',
                totalAsset: Number.isFinite(result.totalAsset) ? result.totalAsset : '',
                dailyProfit: Number.isFinite(result.dailyProfit) ? result.dailyProfit : '',
                holdProfit: Number.isFinite(result.holdProfit) ? result.holdProfit : '',
                navTime: result.gztime || ''
            };
        });
    }

    async function exportAnalysisCsv() {
        const rows = buildExportRows();
        if (rows.length === 0) {
            app.ui.showNotice('没有可导出的基金数据', 'error');
            return;
        }

        try {
            const response = await fetch('/api/export/funds-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows })
            });
            const payload = await response.json();
            if (!payload.success) {
                app.ui.showNotice('导出失败：' + (payload.error || '服务端异常'), 'error', 5000);
                return;
            }

            const link = document.createElement('a');
            link.href = payload.download_url;
            link.download = payload.filename;
            document.body.appendChild(link);
            link.click();
            link.remove();

            app.ui.showNotice(`已生成 ${payload.path}，共 ${payload.rows} 条`, 'success', 5000);
        } catch (error) {
            console.error('exportAnalysisCsv failed', error);
            app.ui.showNotice('导出失败，网络连接异常', 'error', 5000);
        }
    }

    function fetchPingzhong(code, timeoutMs = HIST_TIMEOUT_MS) {
        return new Promise(resolve => {
            utils.resetPingzhongGlobals();

            const script = document.createElement('script');
            script.async = true;
            script.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?rt=${Date.now()}`;
            let timerId = null;
            let finished = false;

            const finish = result => {
                if (finished) return;
                finished = true;
                if (timerId) clearTimeout(timerId);
                if (script.parentNode) script.parentNode.removeChild(script);
                utils.resetPingzhongGlobals();
                resolve(result);
            };

            script.onload = () => {
                if (window.fS_name && (window.ishb || (window.Data_millionCopiesIncome && window.Data_millionCopiesIncome.length > 0))) {
                    const incomeHistory = Array.isArray(window.Data_millionCopiesIncome) ? window.Data_millionCopiesIncome : [];
                    const latestIncome = incomeHistory.length > 0 ? incomeHistory[incomeHistory.length - 1] : null;
                    const prevIncome = incomeHistory.length > 1 ? incomeHistory[incomeHistory.length - 2] : latestIncome;
                    finish({
                        name: window.fS_name,
                        latest: 1,
                        prev: 1,
                        dateMs: latestIncome ? latestIncome[0] : Date.now(),
                        isMoneyFund: true,
                        millionIncome: latestIncome ? Number(latestIncome[1]) : 0,
                        prevMillionIncome: prevIncome ? Number(prevIncome[1]) : 0
                    });
                } else if (window.fS_name && window.Data_netWorthTrend && window.Data_netWorthTrend.length > 0) {
                    const history = window.Data_netWorthTrend;
                    const latest = history[history.length - 1];
                    const prev = history.length > 1 ? history[history.length - 2] : latest;
                    finish({ name: window.fS_name, latest: latest.y, prev: prev.y, dateMs: latest.x });
                } else {
                    finish(null);
                }
            };
            script.onerror = () => finish(null);
            document.head.appendChild(script);
            timerId = setTimeout(() => finish(null), timeoutMs);
        });
    }

    async function refreshNetworkData(options = {}) {
        const { allowQueue = true, forceHist = false } = options;
        if (state.refreshInFlight) {
            if (allowQueue) {
                state.refreshPending = true;
                state.refreshPendingOptions = {
                    ...(state.refreshPendingOptions || {}),
                    forceHist: Boolean((state.refreshPendingOptions || {}).forceHist || forceHist)
                };
            }
            return;
        }

        if (state.myFunds.length === 0) {
            state.cachedResults = [];
            app.ui.renderUI(false);
            return;
        }

        state.refreshInFlight = true;
        const bar = document.getElementById('refreshBar');
        bar.style.width = '10%';
        let estimateScripts = [];

        try {
            let tempResults = {};
            window.jsonpgz = function(data) {
                if (data && data.fundcode) tempResults[data.fundcode] = data;
            };

            const promises = state.myFunds.map(fund => new Promise(resolve => {
                const script = document.createElement('script');
                script.async = true;
                script.src = `https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`;
                script.onload = resolve;
                script.onerror = resolve;
                estimateScripts.push(script);
                document.head.appendChild(script);
            }));

            await Promise.race([Promise.all(promises), new Promise(res => setTimeout(res, ESTIMATE_WAIT_MS))]);
            bar.style.width = '40%';
            utils.removeInjectedScripts(estimateScripts);
            window.jsonpgz = undefined;

            const newCachedResults = state.myFunds.map(fund => {
                const cachedHist = getCachedHist(fund.code);
                const rt = tempResults[fund.code];
                return mergeSyncOverride(logic.buildFundResult(fund, cachedHist, rt));
            });
            applyResults(newCachedResults);

            const histJobs = state.myFunds
                .map((fund, index) => ({ fund, index }))
                .filter(({ fund }) => shouldFetchHist(fund.code, forceHist));

            if (histJobs.length === 0) {
                state.cachedResults = newCachedResults;
                bar.style.width = '100%';
                app.ui.renderUI(false);
                return;
            }

            let updatedCount = 0;
            for (let offset = 0; offset < histJobs.length; offset += HIST_FETCH_CONCURRENCY) {
                const batch = histJobs.slice(offset, offset + HIST_FETCH_CONCURRENCY);
                const histories = await Promise.all(batch.map(({ fund, index }) => (
                    fetchPingzhong(fund.code).then(hist => ({
                        index,
                        fund,
                        hist
                    }))
                )));

                histories.forEach(({ index, fund, hist }) => {
                    const rt = tempResults[fund.code];
                    if (hist) setCachedHist(fund.code, hist);
                    newCachedResults[index] = mergeSyncOverride(logic.buildFundResult(fund, hist || getCachedHist(fund.code), rt));
                });

                updatedCount += histories.length;
                bar.style.width = `${40 + (updatedCount / histJobs.length) * 60}%`;

                if (updatedCount % HIST_RENDER_BATCH_SIZE === 0 || updatedCount >= histJobs.length) {
                    applyResults([...newCachedResults]);
                }
            }

            state.cachedResults = newCachedResults;
            bar.style.width = '100%';
            app.ui.renderUI(false);
        } catch (error) {
            console.error('refreshNetworkData failed', error);
            app.ui.showNotice('行情刷新失败，稍后会自动重试', 'error', 5000);
        } finally {
            utils.removeInjectedScripts(estimateScripts);
            window.jsonpgz = undefined;
            state.refreshInFlight = false;
            setTimeout(() => { bar.style.width = '0%'; }, 500);
            if (state.refreshPending) {
                const pendingOptions = state.refreshPendingOptions || {};
                state.refreshPending = false;
                state.refreshPendingOptions = null;
                refreshNetworkData(pendingOptions);
            }
        }
    }

    app.data = {
        openSyncModal,
        uploadSyncData,
        downloadSyncData,
        autoRestoreCloudData,
        restoreLastSyncData,
        exportAnalysisCsv,
        refreshNetworkData
    };
})();
