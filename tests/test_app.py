import os
import shutil
import tempfile
import unittest
from pathlib import Path

import app as fund_app


class FundDashboardAppTests(unittest.TestCase):
    def setUp(self):
        self.original_data_file = fund_app.DATA_FILE
        self.original_export_dir = fund_app.EXPORT_DIR
        self.test_data_file = Path(__file__).resolve().parent / '.tmp_sync_data.json'
        self.test_export_dir = Path(tempfile.mkdtemp(prefix='funddashboard_exports_'))
        if self.test_data_file.exists():
            self.test_data_file.unlink()
        fund_app.DATA_FILE = str(self.test_data_file)
        fund_app.EXPORT_DIR = str(self.test_export_dir)
        self.client = fund_app.app.test_client()

    def tearDown(self):
        fund_app.DATA_FILE = self.original_data_file
        fund_app.EXPORT_DIR = self.original_export_dir
        if self.test_data_file.exists():
            self.test_data_file.unlink()
        if self.test_export_dir.exists():
            shutil.rmtree(self.test_export_dir, ignore_errors=True)

    def test_normalize_sync_code_rejects_empty_and_too_long_values(self):
        self.assertIsNone(fund_app.normalize_sync_code('   '))
        self.assertIsNone(fund_app.normalize_sync_code('x' * (fund_app.SYNC_CODE_MAX_LENGTH + 1)))
        self.assertEqual(fund_app.normalize_sync_code(' 159357 '), '159357')

    def test_validate_funds_data_normalizes_default_group_and_numbers(self):
        data, error = fund_app.validate_funds_data([
            {'code': '000001', 'shares': '1.5', 'cost': '2.75', 'group': ''},
            {'code': '000002', 'shares': '3', 'cost': '', 'group': '稳健'}
        ])

        self.assertIsNone(error)
        self.assertEqual(
            data,
            [
                {'code': '000001', 'shares': '1.5', 'cost': '2.75', 'group': '默认分组'},
                {'code': '000002', 'shares': '3.0', 'cost': '', 'group': '稳健'},
            ]
        )

    def test_validate_funds_data_rejects_invalid_code(self):
        data, error = fund_app.validate_funds_data([
            {'code': 'ABC', 'shares': '1', 'cost': '1', 'group': '测试'}
        ])

        self.assertIsNone(data)
        self.assertIn('资产代码无效', error)

    def test_sync_save_and_load_round_trip(self):
        save_response = self.client.post(
            '/api/sync/save',
            json={
                'sync_code': '159357',
                'data': [
                    {'code': '000001', 'shares': '1.5', 'cost': '1.2', 'group': '稳健'},
                    {'code': '000002', 'shares': '2', 'cost': '', 'group': ''}
                ]
            }
        )
        self.assertEqual(save_response.status_code, 200)
        self.assertTrue(save_response.get_json()['success'])

        load_response = self.client.get('/api/sync/load/159357')
        self.assertEqual(load_response.status_code, 200)
        payload = load_response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(len(payload['data']), 2)
        self.assertEqual(payload['data'][1]['group'], '默认分组')
        self.assertIn('updated_at', payload)

    def test_sync_load_supports_legacy_list_payload(self):
        fund_app.save_data({
            'legacy-code': [
                {'code': '000001', 'shares': '1.0', 'cost': '', 'group': '默认分组'}
            ]
        })

        response = self.client.get('/api/sync/load/legacy-code')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['data'][0]['code'], '000001')
        self.assertIsNone(payload['updated_at'])

    def test_sync_save_rejects_invalid_json_shape(self):
        response = self.client.post('/api/sync/save', json=['not-an-object'])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], '请求体必须是 JSON 对象')

    def test_sync_save_rejects_invalid_fund_payload(self):
        response = self.client.post(
            '/api/sync/save',
            json={
                'sync_code': '159357',
                'data': [{'code': '12', 'shares': '-1', 'cost': 'abc', 'group': '测试'}]
            }
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('资产代码无效', response.get_json()['error'])

    def test_sync_load_returns_404_for_unknown_code(self):
        response = self.client.get('/api/sync/load/404404')

        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json()['success'])

    def test_ocr_recognize_rejects_missing_image(self):
        response = self.client.post('/api/ocr/recognize', data={})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()['success'])

    def test_export_funds_analysis_creates_downloadable_csv(self):
        response = self.client.post('/api/export/funds-analysis', json={
            'rows': [{
                'code': '6479',
                'name': '测试基金',
                'shares': '100',
                'cost': '1.2',
                'group': '稳健',
                'nav': '1.5',
                'totalAsset': '150',
                'dailyProfit': '-1.25',
                'holdProfit': '30',
                'navTime': '实际净值 (05-14)'
            }]
        })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['rows'], 1)
        self.assertTrue((self.test_export_dir / payload['filename']).exists())

        download_response = self.client.get(payload['download_url'])
        self.assertEqual(download_response.status_code, 200)
        csv_text = download_response.get_data(as_text=True)
        download_response.close()
        self.assertIn('code,name,shares,cost,group,nav,totalAsset,dailyProfit,holdProfit,navTime', csv_text)
        self.assertIn('"=""006479"""', csv_text)
        self.assertIn('测试基金', csv_text)

    def test_export_funds_analysis_rejects_empty_rows(self):
        response = self.client.post('/api/export/funds-analysis', json={'rows': []})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()['success'])

    def test_index_page_and_static_assets_are_served(self):
        index_response = self.client.get('/')
        self.assertEqual(index_response.status_code, 200)
        html = index_response.get_data(as_text=True)
        self.assertIn('js/dashboard/main.js', html)
        self.assertIn('css/dashboard.css', html)
        index_response.close()

        static_paths = [
            '/static/css/dashboard.css',
            '/static/js/dashboard/state.js',
            '/static/js/dashboard/utils.js',
            '/static/js/dashboard/data.js',
            '/static/js/dashboard/ocr.js',
            '/static/js/dashboard/ui.js',
            '/static/js/dashboard/main.js',
        ]
        for path in static_paths:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()


if __name__ == '__main__':
    unittest.main()
