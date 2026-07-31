import unittest
from datetime import datetime, timezone

import fund_refresh
from fund_refresh import build_snapshot_item


SAME_DAY_HISTORY_MS = int(datetime(2026, 4, 11, 15, 0, tzinfo=timezone.utc).timestamp() * 1000)


class FundRefreshTests(unittest.TestCase):
    def test_fetch_latest_navs_prefers_history_and_falls_back_to_realtime(self):
        original_history = fund_refresh.fetch_history
        original_realtime = fund_refresh.fetch_realtime_estimate
        try:
            fund_refresh.fetch_history = lambda code: (
                {'latest': 1.1085} if code == '016663' else None
            )
            fund_refresh.fetch_realtime_estimate = lambda code: (
                {'dwjz': '2.5'} if code == '000001' else None
            )

            navs = fund_refresh.fetch_latest_navs(['016663', '000001', '016663'])
        finally:
            fund_refresh.fetch_history = original_history
            fund_refresh.fetch_realtime_estimate = original_realtime

        self.assertEqual(navs, {'016663': 1.1085, '000001': 2.5})

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
