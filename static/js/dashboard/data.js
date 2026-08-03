(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state, utils, logic } = app;
    const UPLOAD_REFRESH_WAIT_MS = 45 * 1000;
    const SYNC_OVERRIDE_FIELDS = ['estRate', 'estNav', 'dailyProfit', 'totalAsset', 'holdProfit'];

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

    function countCompleteSnapshots(snapshot) {
        return (snapshot || []).filter(item => logic.hasCompleteDisplayMetrics(item)).length;
    }

    async function waitForRefreshIdle(timeoutMs = UPLOAD_REFRESH_WAIT_MS) {
        const deadline = Date.now() + timeoutMs;
        while (state.refreshInFlight && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return !state.refreshInFlight;
    }

    async function prepareUploadSnapshot() {
        if (state.refreshInFlight && !await waitForRefreshIdle()) {
            throw new Error('本地净值刷新超时，请稍后再同步');
        }

        let snapshot = buildSyncSnapshot();
        if (countCompleteSnapshots(snapshot) === 0) {
            await refreshLocalData({ allowQueue: false, forceHist: true });
            snapshot = buildSyncSnapshot();
        }

        if (countCompleteSnapshots(snapshot) === 0) {
            throw new Error('当前没有可用净值，已取消上传以避免云端数据变空');
        }
        return snapshot;
    }

    function applySyncSnapshot(snapshot, funds) {
        if (!Array.isArray(snapshot) || !snapshot.length) return false;

        const snapshotByCode = new Map();
        snapshot.forEach(item => {
            if (item && item.code) snapshotByCode.set(item.code, item);
        });
        const results = (funds || []).map((fund, index) => {
            const direct = snapshot[index];
            const item = direct && direct.code === fund.code ? direct : snapshotByCode.get(fund.code);
            if (!item) return null;

            return {
                ...item,
                code: fund.code,
                group: fund.group || item.group || '默认分组',
                valid: item.valid !== false,
                isSyncSnapshot: true
            };
        });

        const hasUsableSnapshot = results.some(item => (
            logic.hasCompleteDisplayMetrics(item) || (item && item.isUnavailable)
        ));
        if (!hasUsableSnapshot) {
            state.cachedResults = [];
            return false;
        }
        state.cachedResults = results;
        state.syncSnapshotOverrides = {};
        app.persistSyncSnapshotOverrides();
        return true;
    }

    function storeSyncMetadata(payload) {
        if (payload.updated_at) localStorage.setItem('lastSyncUpdatedAt', payload.updated_at);
        if (payload.snapshot_updated_at) {
            localStorage.setItem('lastSyncSnapshotUpdatedAt', payload.snapshot_updated_at);
        }
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
        btn.innerHTML = '准备快照...';
        btn.disabled = true;

        try {
            const snapshot = await prepareUploadSnapshot();
            btn.innerHTML = '上传中...';
            const response = await fetch('/api/sync/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sync_code: code, data: state.myFunds, snapshot })
            });
            const resData = await response.json();
            if (resData.success) {
                localStorage.setItem('lastSyncCode', code);
                storeSyncMetadata(resData);
                app.markCloudSyncClean();
                app.ui.showNotice('数据已上传，正在生成统一云端净值', 'success', 4000);
                state.syncModal.hide();
                refreshNetworkData({ allowQueue: true, forceHist: true, skipLocalRefresh: true });
            } else {
                app.ui.showNotice('上传失败：' + resData.error, 'error', 4000);
            }
        } catch (e) {
            app.ui.showNotice(`上传失败：${e.message || '网络连接异常'}`, 'error', 5000);
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
                app.persistFunds({ synced: true });
                localStorage.setItem('lastSyncCode', code);
                storeSyncMetadata(resData);
                const syncTime = resData.updated_at ? `，云端更新时间 ${utils.formatSyncTime(resData.updated_at)}` : '';
                const hasSnapshot = applySyncSnapshot(resData.snapshot, state.myFunds);
                if (!hasSnapshot) state.cachedResults = [];
                app.ui.showNotice(`云端数据已同步到本地${syncTime}${hasSnapshot ? '，已恢复云端快照' : ''}`, 'success', 4000);
                state.syncModal.hide();
                app.ui.renderUI(!hasSnapshot);
                refreshNetworkData();
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
            app.persistFunds({ synced: true });
            localStorage.setItem('lastSyncCode', code);
            storeSyncMetadata(resData);

            const hasSnapshot = applySyncSnapshot(resData.snapshot, state.myFunds);
            if (hasSnapshot) {
                app.ui.renderUI(false);
                refreshNetworkData({ allowQueue: false });
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

    function queuePendingRefresh(options = {}) {
        state.refreshPending = true;
        state.refreshPendingOptions = {
            ...(state.refreshPendingOptions || {}),
            forceHist: Boolean((state.refreshPendingOptions || {}).forceHist || options.forceHist),
            skipLocalRefresh: Boolean((state.refreshPendingOptions || {}).skipLocalRefresh || options.skipLocalRefresh)
        };
    }

    function flushPendingRefresh() {
        if (!state.refreshPending) return;
        const pendingOptions = state.refreshPendingOptions || {};
        state.refreshPending = false;
        state.refreshPendingOptions = null;
        refreshNetworkData(pendingOptions);
    }

    function mergeMarketSnapshot(snapshot) {
        const incomingByCode = new Map();
        (snapshot || []).forEach(item => {
            if (item && item.code) incomingByCode.set(item.code, item);
        });

        const currentByCode = new Map();
        (state.cachedResults || []).forEach(item => {
            if (item && item.code) currentByCode.set(item.code, item);
        });

        return state.myFunds.map((fund, index) => {
            const direct = snapshot && snapshot[index];
            const incoming = direct && direct.code === fund.code
                ? direct
                : incomingByCode.get(fund.code);
            const current = currentByCode.get(fund.code);

            if (logic.hasCompleteDisplayMetrics(incoming)) {
                const incomingName = String(incoming.name || '').trim();
                const currentName = String(current && current.name || '').trim();
                return mergeSyncOverride({
                    ...incoming,
                    name: (!incomingName || incomingName === `基金 ${fund.code}`) && currentName
                        ? currentName
                        : incoming.name,
                    code: fund.code,
                    group: fund.group || incoming.group || '默认分组'
                });
            }
            if (logic.hasCompleteDisplayMetrics(current)) {
                return { ...current, isRefreshFallback: true };
            }
            return incoming || {
                code: fund.code,
                group: fund.group || '默认分组',
                name: `基金 ${fund.code}`,
                gztime: '行情暂不可用',
                valid: true,
                isUnavailable: true,
                isBackup: true
            };
        });
    }

    async function refreshCloudSnapshot(syncCode, options = {}) {
        const { allowQueue = true, forceHist = false } = options;
        if (state.refreshInFlight) {
            if (allowQueue) queuePendingRefresh(options);
            return;
        }
        if (state.cloudSyncDirty) {
            return refreshLocalData(options);
        }

        state.refreshInFlight = true;
        const bar = document.getElementById('refreshBar');
        bar.style.width = '15%';

        try {
            const forceQuery = forceHist ? '?force=1' : '';
            const response = await fetch('/api/sync/refresh/' + encodeURIComponent(syncCode) + forceQuery, {
                method: 'POST',
                headers: { 'Accept': 'application/json' }
            });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || '云端净值刷新失败');
            }

            bar.style.width = '80%';
            const applyDecision = logic.getCloudSnapshotApplyDecision(
                state.cloudSyncDirty,
                payload.snapshot,
                state.cachedResults
            );
            if (applyDecision.reason === 'local-changes') {
                if (forceHist) {
                    app.ui.showNotice('检测到本地持仓已修改，已忽略旧的云端刷新结果', 'success', 4000);
                }
                return;
            }
            if (applyDecision.reason === 'incoming-unavailable') {
                if (forceHist) app.ui.showNotice('部分行情暂不可用，已保留上一次完整结果', 'error', 5000);
                return;
            }

            if (Array.isArray(payload.data) && payload.data.length > 0) {
                state.myFunds = payload.data;
                app.persistFunds({ synced: true });
            }
            storeSyncMetadata(payload);

            const hasSnapshot = applySyncSnapshot(payload.snapshot, state.myFunds);
            if (!hasSnapshot) state.cachedResults = [];
            app.ui.renderUI(!hasSnapshot);
            bar.style.width = '100%';

            if (forceHist) {
                const snapshotTime = payload.snapshot_updated_at
                    ? `，快照时间 ${utils.formatSyncTime(payload.snapshot_updated_at)}`
                    : '';
                const fallbackCount = Number(payload.fallback_count) || 0;
                if (payload.stale) {
                    app.ui.showNotice(`行情源暂不可用，已保留上一次完整结果${snapshotTime}`, 'error', 6000);
                } else if (fallbackCount > 0) {
                    app.ui.showNotice(
                        `已更新 ${Number(payload.fresh_count) || 0}/${state.myFunds.length} 项，${fallbackCount} 项保留旧值${snapshotTime}`,
                        'error',
                        6000
                    );
                } else {
                    app.ui.showNotice(
                        `已完成 ${countCompleteSnapshots(payload.snapshot)}/${state.myFunds.length} 项净值计算${snapshotTime}`,
                        'success',
                        5000
                    );
                }
            }
        } catch (error) {
            console.error('refreshCloudSnapshot failed', error);
            app.ui.showNotice(`云端净值刷新失败：${error.message}，已保留当前结果`, 'error', 5000);
            app.ui.renderUI(state.cachedResults.length === 0);
        } finally {
            state.refreshInFlight = false;
            setTimeout(() => { bar.style.width = '0%'; }, 500);
            flushPendingRefresh();
        }
    }

    async function refreshLocalData(options = {}) {
        const { allowQueue = true, deferPending = false } = options;
        if (state.refreshInFlight) {
            if (allowQueue) queuePendingRefresh(options);
            return;
        }

        if (state.myFunds.length === 0) {
            state.cachedResults = [];
            app.ui.renderUI(false);
            return;
        }

        state.refreshInFlight = true;
        const bar = document.getElementById('refreshBar');
        bar.style.width = '15%';

        try {
            const response = await fetch('/api/market/refresh', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ funds: state.myFunds })
            });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || '服务端行情刷新失败');
            }

            bar.style.width = '85%';
            if (payload.refreshed_at) {
                localStorage.setItem('lastLocalSnapshotUpdatedAt', payload.refreshed_at);
            }
            applyResults(mergeMarketSnapshot(payload.snapshot));
            bar.style.width = '100%';
        } catch (error) {
            console.error('refreshNetworkData failed', error);
            app.ui.showNotice(`行情刷新失败：${error.message}，已保留当前结果`, 'error', 5000);
            app.ui.renderUI(state.cachedResults.length === 0);
        } finally {
            state.refreshInFlight = false;
            setTimeout(() => { bar.style.width = '0%'; }, 500);
            if (!deferPending) flushPendingRefresh();
        }
    }

    function refreshNetworkData(options = {}) {
        const syncCode = String(localStorage.getItem('lastSyncCode') || '').trim();
        if (syncCode && !state.cloudSyncDirty) {
            return refreshCloudSnapshot(syncCode, options);
        }
        if (syncCode && state.cloudSyncDirty && options.forceHist) {
            app.ui.showNotice('本地持仓尚未上传，本次只刷新本机数据', 'error', 4000);
        }
        return refreshLocalData(options);
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
