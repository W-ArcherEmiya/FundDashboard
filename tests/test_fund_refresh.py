import json
import unittest
from datetime import datetime, timezone

import fund_refresh
from fund_refresh import build_snapshot_item


SAME_DAY_HISTORY_MS = int(datetime(2026, 4, 11, 15, 0, tzinfo=timezone.utc).timestamp() * 1000)


class FundRefreshTests(unittest.TestCase):
    def test_parse_realtime_estimate_payload_accepts_today_value(self):
        inner = {
            'Datas': ['1,09:30,-0.10', '2,09:31,-0.20'],
            'Expansion': {
                'FCODE': '016186',
                'SHORTNAME': '广发电力ETF联接C',
                'GZTIME': '2026-09-07 14:35',
                'GZ': '1.0808',
                'GSZZL': '-0.83',
                'DWJZ': '1.0898',
            },
        }
        source = json.dumps({'data': json.dumps(inner, ensure_ascii=False)}, ensure_ascii=False)

        estimate = fund_refresh.parse_realtime_estimate_payload(
            source,
            '016186',
            now=datetime(2026, 9, 7, 6, 35, tzinfo=timezone.utc),
        )

        self.assertEqual(estimate['name'], '广发电力ETF联接C')
        self.assertEqual(estimate['gsz'], 1.0808)
        self.assertEqual(estimate['gszzl'], -0.83)
        self.assertEqual(estimate['estimateSource'], '天天基金盘中估值')

    def test_parse_realtime_estimate_payload_rejects_stale_or_wrong_fund(self):
        inner = {
            'Expansion': {
                'FCODE': '016186',
                'GZTIME': '2026-09-06 15:00',
                'GZ': '1.0808',
                'GSZZL': '-0.83',
                'DWJZ': '1.0898',
            },
        }
        source = json.dumps({'data': json.dumps(inner)})
        now = datetime(2026, 9, 7, 6, 35, tzinfo=timezone.utc)

        self.assertIsNone(fund_refresh.parse_realtime_estimate_payload(source, '016186', now=now))
        self.assertIsNone(fund_refresh.parse_realtime_estimate_payload(source, '001593', now=now))

    def test_parse_index_estimate_page_extracts_current_values(self):
        source = """
            <span id="gsdata">2026-09-07 估算数据</span>
            <span id="dwjzdata">2026-09-04 单位净值</span>
            <tbody id="tableContent">
                <tr>
                    <td>x</td><td>1</td><td>006479</td>
                    <td><a>广发纳斯达克100ETF联接C</a><a>估算图</a></td>
                    <td data-gz="8.0330">8.0330</td><td data-gz="0.20%">0.20%</td>
                    <td>---</td><td>---</td><td>---</td><td>8.0310</td>
                </tr>
            </tbody>
            <a href="lof_fundguzhi7.html">7</a>
        """

        estimates, page_count = fund_refresh.parse_index_estimate_page(source, '2026-09-07')

        self.assertEqual(page_count, 7)
        self.assertEqual(estimates['006479']['name'], '广发纳斯达克100ETF联接C')
        self.assertEqual(estimates['006479']['gsz'], 8.033)
        self.assertEqual(estimates['006479']['dwjz'], 8.031)
        self.assertEqual(estimates['006479']['estimateSource'], '天天基金指数参考估值')

    def test_parse_index_estimate_page_rejects_previous_day(self):
        source = '<span id="gsdata">2026-09-06 估算数据</span><tbody id="tableContent"></tbody>'
        estimates, page_count = fund_refresh.parse_index_estimate_page(source, '2026-09-07')
        self.assertEqual(estimates, {})
        self.assertEqual(page_count, 0)

    def test_fetch_latest_navs_prefers_latest_nav_api_and_falls_back_to_realtime(self):
        original_latest_nav = fund_refresh.fetch_latest_nav
        original_realtime = fund_refresh.fetch_realtime_estimate
        try:
            fund_refresh.fetch_latest_nav = lambda code: 1.1085 if code == '016663' else None
            fund_refresh.fetch_realtime_estimate = lambda code: (
                {'dwjz': '2.5'} if code == '000001' else None
            )

            navs = fund_refresh.fetch_latest_navs(['016663', '000001', '016663'])
        finally:
            fund_refresh.fetch_latest_nav = original_latest_nav
            fund_refresh.fetch_realtime_estimate = original_realtime

        self.assertEqual(navs, {'016663': 1.1085, '000001': 2.5})

    def test_fetch_latest_nav_parses_lightweight_api_response(self):
        original_fetch_text = fund_refresh.fetch_text
        try:
            fund_refresh.fetch_text = lambda *_args, **_kwargs: (
                '{"Data":{"LSJZList":[{"DWJZ":"1.0918"}]},"ErrCode":0}'
            )
            nav = fund_refresh.fetch_latest_nav('016663')
        finally:
            fund_refresh.fetch_text = original_fetch_text

        self.assertEqual(nav, 1.0918)

    def test_fetch_recent_history_parses_two_nav_records(self):
        original_fetch_text = fund_refresh.fetch_text
        try:
            fund_refresh.fetch_text = lambda *_args, **_kwargs: (
                '{"Data":{"FundType":"003","Feature":"042,080","LSJZList":['
                '{"FSRQ":"2026-08-03","DWJZ":"1.0919"},'
                '{"FSRQ":"2026-07-31","DWJZ":"1.0918"}]}}'
            )
            history = fund_refresh.fetch_recent_history('016663')
        finally:
            fund_refresh.fetch_text = original_fetch_text

        self.assertEqual(history['latest'], 1.0919)
        self.assertEqual(history['prev'], 1.0918)
        self.assertEqual(fund_refresh.date_ms_to_bj_date_str(history['dateMs']), '2026-08-03')
        self.assertFalse(history['isMoneyFund'])
        self.assertEqual(history['fundType'], '003')
        self.assertEqual(history['features'], ['042', '080'])
        self.assertFalse(fund_refresh.supports_realtime_estimate(history))

    def test_realtime_estimate_support_includes_index_and_qdii_funds(self):
        self.assertTrue(fund_refresh.supports_realtime_estimate({
            'fundType': '003',
            'features': ['042', '050'],
        }))
        self.assertTrue(fund_refresh.supports_realtime_estimate({
            'fundType': '007',
            'features': [],
        }))
        self.assertFalse(fund_refresh.supports_realtime_estimate({
            'fundType': '005',
            'isMoneyFund': True,
            'features': ['050'],
        }))

    def test_fetch_recent_history_handles_money_fund_income(self):
        original_fetch_text = fund_refresh.fetch_text
        try:
            fund_refresh.fetch_text = lambda *_args, **_kwargs: (
                '{"Data":{"FundType":"005","SYType":"每万份收益","LSJZList":['
                '{"FSRQ":"2026-08-03","DWJZ":"0.4438"},'
                '{"FSRQ":"2026-08-02","DWJZ":"0.5892"}]}}'
            )
            history = fund_refresh.fetch_recent_history('018092')
        finally:
            fund_refresh.fetch_text = original_fetch_text

        self.assertTrue(history['isMoneyFund'])
        self.assertEqual(history['latest'], 1.0)
        self.assertEqual(history['millionIncome'], 0.4438)
        self.assertEqual(history['prevMillionIncome'], 0.5892)

    def test_build_snapshot_item_uses_realtime_when_newer_than_history(self):
        item = build_snapshot_item(
            {'code': '000001', 'shares': '10', 'cost': '1.2', 'group': '稳健'},
            {'name': '基金A', 'latest': 1.1, 'prev': 1.0, 'dateMs': 1775750400000},
            {'name': '基金A', 'gsz': '1.15', 'gszzl': '4.55', 'gztime': '2026-04-11 14:35', 'dwjz': '1.10'},
        )

        self.assertTrue(item['valid'])
        self.assertFalse(item['isActual'])
        self.assertEqual(item['estNav'], 1.15)
        self.assertAlmostEqual(item['dailyProfit'], 0.5)
        self.assertAlmostEqual(item['holdProfit'], -1)

    def test_refresh_snapshot_uses_index_estimate_when_minute_source_is_unavailable(self):
        original_recent = fund_refresh.fetch_recent_history
        original_history = fund_refresh.fetch_history
        original_realtime = fund_refresh.fetch_realtime_estimate
        original_index = fund_refresh.fetch_index_estimates
        try:
            fund_refresh.fetch_recent_history = lambda _code: {
                'name': '广发纳斯达克100ETF联接C',
                'latest': 8.031,
                'prev': 8.0,
                'dateMs': fund_refresh.date_str_to_ms('2026-09-04'),
            }
            fund_refresh.fetch_history = lambda _code: None
            fund_refresh.fetch_realtime_estimate = lambda _code: None
            fund_refresh.fetch_index_estimates = lambda: {
                '006479': {
                    'name': '广发纳斯达克100ETF联接C',
                    'gsz': 8.033,
                    'dwjz': 8.031,
                    'gszzl': 0.20,
                    'gztime': '2026-09-07 参考估值',
                    'estimateSource': '天天基金指数参考估值',
                },
            }

            snapshot = fund_refresh.refresh_funds_snapshot([
                {'code': '006479', 'shares': '10', 'cost': '7.5', 'group': '美股'},
            ])
        finally:
            fund_refresh.fetch_recent_history = original_recent
            fund_refresh.fetch_history = original_history
            fund_refresh.fetch_realtime_estimate = original_realtime
            fund_refresh.fetch_index_estimates = original_index

        self.assertFalse(snapshot[0]['isActual'])
        self.assertEqual(snapshot[0]['estNav'], 8.033)
        self.assertEqual(snapshot[0]['estimateSource'], '天天基金指数参考估值')

    def test_build_snapshot_item_keeps_same_day_settlement_estimated_before_cutoff(self):
        item = build_snapshot_item(
            {'code': '000001', 'shares': '10', 'cost': '1.0', 'group': '稳健'},
            {'name': '基金A', 'latest': 1.08, 'prev': 1.0, 'dateMs': SAME_DAY_HISTORY_MS},
            {'name': '基金A', 'gsz': '1.20', 'gszzl': '20.00', 'gztime': '2026-04-11 14:35', 'dwjz': '1.00'},
            now=datetime(2026, 4, 11, 14, 30, tzinfo=timezone.utc),
        )

        self.assertFalse(item['isActual'])
        self.assertEqual(item['gztime'], '2026-04-11 14:35')
        self.assertEqual(item['estNav'], 1.2)
        self.assertAlmostEqual(item['dailyProfit'], 2)
        self.assertAlmostEqual(item['holdProfit'], 0)

    def test_build_snapshot_item_accepts_same_day_settlement_after_cutoff(self):
        item = build_snapshot_item(
            {'code': '000001', 'shares': '10', 'cost': '1.0', 'group': '稳健'},
            {'name': '基金A', 'latest': 1.08, 'prev': 1.0, 'dateMs': SAME_DAY_HISTORY_MS},
            {'name': '基金A', 'gsz': '1.20', 'gszzl': '20.00', 'gztime': '2026-04-11 14:35', 'dwjz': '1.00'},
            now=datetime(2026, 4, 11, 15, 0, tzinfo=timezone.utc),
        )

        self.assertTrue(item['isActual'])
        self.assertEqual(item['gztime'], '实际净值(04-11)')
        self.assertAlmostEqual(item['dailyProfit'], 0.8)
        self.assertAlmostEqual(item['holdProfit'], 0.8)

    def test_build_snapshot_item_handles_money_fund_income(self):
        item = build_snapshot_item(
            {'code': '018092', 'shares': '878.73', 'cost': '0.9909', 'group': '稳健'},
            {
                'name': '兴银现金添利C',
                'latest': 1,
                'prev': 1,
                'dateMs': 1780617600000,
                'isMoneyFund': True,
                'millionIncome': 0.3414,
            },
            None,
        )

        self.assertTrue(item['valid'])
        self.assertTrue(item['isActual'])
        self.assertEqual(item['estNav'], 1)
        self.assertEqual(item['totalAsset'], 878.73)
        self.assertAlmostEqual(item['dailyProfit'], 0.03, places=4)
        self.assertAlmostEqual(item['holdProfit'], 7.996443, places=4)


if __name__ == '__main__':
    unittest.main()
