(() => {
    const app = window.FundDashboard = window.FundDashboard || {};

    app.utils = {
        formatNumber(num, forceSign = false) {
            if (isNaN(num)) return '0.00';

            let sign = '';
            if (num > 0.005) sign = forceSign ? '+' : '';
            else if (num < -0.005) sign = '';

            return sign + num.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        },

        formatAmount(num, options = {}) {
            const { forceSign = false, compact = false } = options;
            if (isNaN(num)) return '0.00';

            let sign = '';
            if (num > 0.005) sign = forceSign ? '+' : '';
            else if (num < -0.005) sign = '-';

            const absValue = Math.abs(num);
            let value = absValue;
            let suffix = '';
            let decimals = 2;

            if (compact && absValue >= 100000000) {
                value = absValue / 100000000;
                suffix = '亿';
                decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
            } else if (compact && absValue >= 10000) {
                value = absValue / 10000;
                suffix = '万';
                decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
            }

            return sign + value.toLocaleString('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }) + suffix;
        },

        getColorClass(num) {
            if (num > 0.005) return 'c-up';
            if (num < -0.005) return 'c-down';
            return 'c-flat';
        },

        escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char]));
        },

        toInlineArg(value) {
            return JSON.stringify(String(value));
        },

        removeInjectedScripts(scripts) {
            scripts.forEach(script => {
                if (script.parentNode) script.parentNode.removeChild(script);
            });
        },

        resetPingzhongGlobals() {
            window.fS_name = undefined;
            window.Data_netWorthTrend = undefined;
        }
    };
})();
