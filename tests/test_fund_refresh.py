import unittest

from fund_refresh import build_snapshot_item


class FundRefreshTests(unittest.TestCase):
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
