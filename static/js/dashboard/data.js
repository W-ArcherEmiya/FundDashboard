(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const { state, utils, logic } = app;

    function openSyncModal() {
        state.syncModal.show();
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
                body: JSON.stringify({ sync_code: code, data: state.myFunds })
            });
            const resData = await response.json();
            if (resData.success) {
                localStorage.setItem('lastSyncCode', code);
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

    async function downloadSyncData() {
        const code = document.getElementById('syncCodeInput').value.trim();
        if (!code) {
            app.ui.showNotice('请输入同步码', 'error');
            return;
        }
        if (state.myFunds.length > 0 && !confirm('下载将覆盖当前本地数据，继续？')) return;

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
                app.ui.showNotice('云端数据已同步到本地', 'success');
                state.syncModal.hide();
                app.ui.renderUI(true);
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

    function fetchPingzhong(code) {
        return new Promise(resolve => {
            utils.resetPingzhongGlobals();

            const script = document.createElement('script');
            script.async = true;
            script.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?rt=${Date.now()}`;

            const finish = result => {
                if (script.parentNode) script.parentNode.removeChild(script);
                utils.resetPingzhongGlobals();
                resolve(result);
            };

            script.onload = () => {
                if (window.fS_name && window.Data_netWorthTrend && window.Data_netWorthTrend.length > 0) {
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
        });
    }

    async function refreshNetworkData() {
        if (state.refreshInFlight) {
            state.refreshPending = true;
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

            await Promise.race([Promise.all(promises), new Promise(res => setTimeout(res, 8000))]);
            bar.style.width = '40%';
            utils.removeInjectedScripts(estimateScripts);
            window.jsonpgz = undefined;

            const newCachedResults = [];
            for (let i = 0; i < state.myFunds.length; i++) {
                const fund = state.myFunds[i];
                const hist = await fetchPingzhong(fund.code);
                const rt = tempResults[fund.code];
                newCachedResults.push(logic.buildFundResult(fund, hist, rt));

                bar.style.width = `${40 + ((i + 1) / state.myFunds.length) * 60}%`;
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
                state.refreshPending = false;
                refreshNetworkData();
            }
        }
    }

    app.data = {
        openSyncModal,
        uploadSyncData,
        downloadSyncData,
        refreshNetworkData
    };
})();
