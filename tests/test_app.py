import os
import shutil
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import app as fund_app
import fund_refresh
from scripts import refresh_cloud_snapshots


class FundDashboardAppTests(unittest.TestCase):
    def setUp(self):
        self.original_data_file = fund_app.DATA_FILE
        self.original_export_dir = fund_app.EXPORT_DIR
        self.original_refresh_token = os.environ.get(fund_app.REFRESH_TOKEN_ENV)
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
        if self.original_refresh_token is None:
            os.environ.pop(fund_app.REFRESH_TOKEN_ENV, None)
        else:
            os.environ[fund_app.REFRESH_TOKEN_ENV] = self.original_refresh_token
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

    def test_market_refresh_returns_one_server_calculated_snapshot(self):
        original_refresh = fund_refresh.refresh_funds_snapshot
        refresh_calls = []
        try:
            def fake_refresh(funds):
                refresh_calls.append(funds)
                return [{
                    'code': funds[0]['code'],
                    'group': funds[0]['group'],
                    'name': '测试基金',
                    'estNav': 1.25,
                    'dailyProfit': 2.5,
                    'holdProfit': 5.0,
                    'totalAsset': 125.0,
                    'gztime': '服务端刷新',
                    'valid': True,
                    'isActual': False,
                    'isBackup': False,
                    'isUnavailable': False,
                }]

            fund_refresh.refresh_funds_snapshot = fake_refresh
            response = self.client.post('/api/market/refresh', json={
                'funds': [
                    {'code': '000001', 'shares': '100', 'cost': '1.2', 'group': '稳健'}
                ]
            })
        finally:
            fund_refresh.refresh_funds_snapshot = original_refresh

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['complete_count'], 1)
        self.assertEqual(payload['unavailable_count'], 0)
        self.assertEqual(payload['snapshot'][0]['code'], '000001')
        self.assertEqual(payload['snapshot'][0]['dailyProfit'], 2.5)
        self.assertEqual(len(refresh_calls), 1)

    def test_market_refresh_rejects_invalid_holdings(self):
        response = self.client.post('/api/market/refresh', json={
            'funds': [{'code': 'bad-code', 'shares': '1', 'cost': '1', 'group': '稳健'}]
        })

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()['success'])

    def test_sync_save_and_load_round_trip(self):
        save_response = self.client.post(
            '/api/sync/save',
            json={
                'sync_code': '159357',
                'data': [
                    {'code': '000001', 'shares': '1.5', 'cost': '1.2', 'group': '稳健'},
                    {'code': '000002', 'shares': '2', 'cost': '', 'group': ''}
                ],
                'snapshot': [
                    {
                        'code': '000001',
                        'group': '稳健',
                        'name': '测试基金',
                        'estNav': 1.23,
                        'dailyProfit': 2.5,
                        'holdProfit': 3.5,
                        'totalAsset': 184.5,
                        'gztime': '截图快照',
                        'valid': True,
                    },
                    None
                ]
            }
        )
        self.assertEqual(save_response.status_code, 200)
        self.assertTrue(save_response.get_json()['success'])
        self.assertEqual(save_response.get_json()['snapshot_count'], 1)

        load_response = self.client.get('/api/sync/load/159357')
        self.assertEqual(load_response.status_code, 200)
        payload = load_response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(len(payload['data']), 2)
        self.assertEqual(payload['data'][1]['group'], '默认分组')
        self.assertEqual(payload['snapshot'][0]['code'], '000001')
        self.assertEqual(payload['snapshot'][0]['estNav'], 1.23)
        self.assertTrue(payload['snapshot'][0]['isSyncSnapshot'])
        self.assertIsNone(payload['snapshot'][1])
        self.assertIn('updated_at', payload)

    def test_sync_save_drops_malformed_snapshot_without_metrics(self):
        save_response = self.client.post(
            '/api/sync/save',
            json={
                'sync_code': '159357',
                'data': [
                    {'code': '000001', 'shares': '1.5', 'cost': '1.2', 'group': '稳健'},
                ],
                'snapshot': [
                    {'code': '000001', 'shares': '1.5', 'cost': '1.2', 'group': '稳健'}
                ]
            }
        )

        self.assertEqual(save_response.status_code, 200)
        self.assertTrue(save_response.get_json()['success'])
        self.assertEqual(save_response.get_json()['snapshot_count'], 0)

        load_response = self.client.get('/api/sync/load/159357')
        payload = load_response.get_json()
        self.assertEqual(payload['snapshot'], [None])

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
        self.assertEqual(payload['snapshot'], [])
        self.assertIsNone(payload['updated_at'])

    def test_refresh_cloud_snapshots_updates_snapshot_without_changing_holdings(self):
        fund_app.save_data({
            '159357': {
                'data': [{'code': '000001', 'shares': '10.0', 'cost': '1.2', 'group': '稳健'}],
                'snapshot': [],
                'updated_at': '2026-01-01T00:00:00Z',
            }
        })

        original_refresh = fund_refresh.refresh_funds_snapshot
        try:
            fund_refresh.refresh_funds_snapshot = lambda funds: [{
                'code': funds[0]['code'],
                'group': funds[0]['group'],
                'name': '测试基金',
                'estNav': 1.3,
                'dailyProfit': 1.0,
                'holdProfit': 2.0,
                'totalAsset': 13.0,
                'gztime': '后台刷新',
                'valid': True,
                'isActual': True,
                'isBackup': False,
                'isUnavailable': False,
            }]

            result = refresh_cloud_snapshots.refresh_sync_snapshots(sync_code='159357')
        finally:
            fund_refresh.refresh_funds_snapshot = original_refresh

        self.assertEqual(result['refreshed'], 1)
        payload = fund_app.load_data()['159357']
        self.assertEqual(payload['data'][0]['shares'], '10.0')
        self.assertEqual(payload['snapshot'][0]['name'], '测试基金')
        self.assertEqual(payload['snapshot'][0]['totalAsset'], 13.0)
        self.assertIn('auto_refreshed_at', payload)

    def test_client_sync_refresh_reuses_one_canonical_snapshot(self):
        fund_app.save_data({
            '159357': {
                'data': [{'code': '000001', 'shares': '10.0', 'cost': '1.2', 'group': '稳健'}],
                'snapshot': [],
                'updated_at': '2026-01-01T00:00:00Z',
            }
        })

        refresh_calls = []
        original_refresh = fund_refresh.refresh_funds_snapshot
        try:
            def fake_refresh(funds):
                refresh_calls.append(list(funds))
                time.sleep(0.05)
                return [{
                    'code': funds[0]['code'],
                    'group': funds[0]['group'],
                    'name': '统一快照基金',
                    'estNav': 1.31,
                    'dailyProfit': 1.1,
                    'holdProfit': 1.1,
                    'totalAsset': 13.1,
                    'gztime': '云端刷新',
                    'valid': True,
                    'isActual': False,
                    'isBackup': False,
                    'isUnavailable': False,
                }]

            fund_refresh.refresh_funds_snapshot = fake_refresh
            request_barrier = threading.Barrier(2)

            def refresh_from_device():
                request_barrier.wait()
                with fund_app.app.test_client() as client:
                    response = client.post('/api/sync/refresh/159357')
                    return response.status_code, response.get_json()

            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(executor.map(lambda _: refresh_from_device(), range(2)))
        finally:
            fund_refresh.refresh_funds_snapshot = original_refresh

        self.assertEqual([status for status, _ in responses], [200, 200])
        payloads = [payload for _, payload in responses]
        refreshed_payload = next(payload for payload in payloads if payload['refreshed'])
        reused_payload = next(payload for payload in payloads if payload['reused'])
        self.assertFalse(refreshed_payload['reused'])
        self.assertFalse(reused_payload['refreshed'])
        self.assertEqual(len(refresh_calls), 1)
        self.assertEqual(refreshed_payload['snapshot'], reused_payload['snapshot'])
        self.assertEqual(refreshed_payload['snapshot_updated_at'], reused_payload['snapshot_updated_at'])
        self.assertEqual(refreshed_payload['updated_at'], '2026-01-01T00:00:00Z')
        self.assertTrue(refreshed_payload['snapshot'][0]['isSyncSnapshot'])

    def test_client_sync_refresh_returns_404_for_unknown_code(self):
        response = self.client.post('/api/sync/refresh/404404')

        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json()['success'])

    def test_client_sync_refresh_preserves_uploaded_snapshot_when_provider_fails(self):
        uploaded_snapshot = {
            'code': '000001',
            'group': '稳健',
            'name': '截图基金',
            'estNav': 1.31,
            'dailyProfit': 1.1,
            'holdProfit': 2.1,
            'totalAsset': 13.1,
            'gztime': '截图导入',
            'valid': True,
            'isActual': True,
            'isBackup': False,
            'isUnavailable': False,
            'isSyncSnapshot': True,
        }
        save_response = self.client.post('/api/sync/save', json={
            'sync_code': '159357',
            'data': [{'code': '000001', 'shares': '10.0', 'cost': '1.1', 'group': '稳健'}],
            'snapshot': [uploaded_snapshot],
        })
        self.assertEqual(save_response.status_code, 200)

        original_refresh = fund_refresh.refresh_funds_snapshot
        try:
            fund_refresh.refresh_funds_snapshot = lambda funds: [{
                'code': funds[0]['code'],
                'group': funds[0]['group'],
                'name': '基金 000001',
                'gztime': '暂无盘中估算',
                'valid': True,
                'isActual': True,
                'isBackup': True,
                'isUnavailable': True,
            }]
            response = self.client.post('/api/sync/refresh/159357')
        finally:
            fund_refresh.refresh_funds_snapshot = original_refresh

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['fallback_count'], 1)
        self.assertEqual(payload['snapshot'][0]['totalAsset'], 13.1)
        self.assertEqual(payload['snapshot'][0]['dailyProfit'], 1.1)
        self.assertTrue(payload['snapshot'][0]['isRefreshFallback'])
        self.assertFalse(payload['snapshot'][0]['isUnavailable'])

    def test_browser_snapshot_publish_reuses_first_device_result(self):
        save_response = self.client.post('/api/sync/save', json={
            'sync_code': '159357',
            'data': [{'code': '000001', 'shares': '10.0', 'cost': '1.1', 'group': '稳健'}],
        })
        self.assertEqual(save_response.status_code, 200)

        def snapshot(nav):
            return [{
                'code': '000001',
                'group': '稳健',
                'name': '浏览器行情基金',
                'estNav': nav,
                'dailyProfit': 1.0,
                'holdProfit': 2.0,
                'totalAsset': nav * 10,
                'gztime': '浏览器刷新',
                'valid': True,
                'isActual': False,
                'isBackup': False,
                'isUnavailable': False,
            }]

        first_response = self.client.post('/api/sync/publish/159357', json={'snapshot': snapshot(1.3)})
        second_response = self.client.post('/api/sync/publish/159357', json={'snapshot': snapshot(9.9)})

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        first_payload = first_response.get_json()
        second_payload = second_response.get_json()
        self.assertTrue(first_payload['published'])
        self.assertFalse(first_payload['reused'])
        self.assertFalse(second_payload['published'])
        self.assertTrue(second_payload['reused'])
        self.assertEqual(first_payload['snapshot'], second_payload['snapshot'])
        self.assertEqual(second_payload['snapshot'][0]['estNav'], 1.3)
        self.assertEqual(second_payload['snapshot_source'], 'browser')

    def test_browser_snapshot_publish_rejects_unavailable_only_snapshot(self):
        save_response = self.client.post('/api/sync/save', json={
            'sync_code': '159357',
            'data': [{'code': '000001', 'shares': '10.0', 'cost': '1.1', 'group': '稳健'}],
        })
        self.assertEqual(save_response.status_code, 200)

        response = self.client.post('/api/sync/publish/159357', json={'snapshot': [{
            'code': '000001',
            'group': '稳健',
            'name': '基金 000001',
            'gztime': '暂无盘中估算',
            'valid': True,
            'isActual': True,
            'isBackup': True,
            'isUnavailable': True,
        }]})

        self.assertEqual(response.status_code, 400)
        self.assertIn('没有可用净值', response.get_json()['error'])

    def test_admin_refresh_cloud_snapshots_requires_configured_token(self):
        os.environ.pop(fund_app.REFRESH_TOKEN_ENV, None)

        response = self.client.get('/api/admin/refresh-cloud-snapshots?token=anything')

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.get_json()['success'])

    def test_admin_refresh_cloud_snapshots_rejects_bad_token(self):
        os.environ[fund_app.REFRESH_TOKEN_ENV] = 'secret-token'

        response = self.client.get('/api/admin/refresh-cloud-snapshots?token=bad-token')

        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.get_json()['success'])

    def test_admin_refresh_cloud_snapshots_runs_with_valid_token(self):
        os.environ[fund_app.REFRESH_TOKEN_ENV] = 'secret-token'
        original_refresh = fund_app.refresh_sync_snapshots
        try:
            fund_app.refresh_sync_snapshots = lambda sync_code=None: {
                'refreshed': 1,
                'skipped': 0,
                'total': 1,
                'sync_code': sync_code,
            }

            response = self.client.get('/api/admin/refresh-cloud-snapshots?token=secret-token&sync_code=159357')
        finally:
            fund_app.refresh_sync_snapshots = original_refresh

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['refreshed'], 1)
        self.assertEqual(payload['sync_code'], '159357')

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

    def test_sync_save_rejects_empty_fund_payload(self):
        response = self.client.post(
            '/api/sync/save',
            json={
                'sync_code': '159357',
                'data': []
            }
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('至少需要同步 1 条资产', response.get_json()['error'])

    def test_sync_load_returns_404_for_unknown_code(self):
        response = self.client.get('/api/sync/load/404404')

        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json()['success'])

    def test_ocr_recognize_rejects_missing_image(self):
        response = self.client.post('/api/ocr/recognize', data={})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()['success'])

    def test_shared_ocr_engine_inference_is_serialized(self):
        active_calls = 0
        max_active_calls = 0
        calls_lock = threading.Lock()

        def fake_engine(_image_path):
            nonlocal active_calls, max_active_calls
            with calls_lock:
                active_calls += 1
                max_active_calls = max(max_active_calls, active_calls)
            time.sleep(0.03)
            with calls_lock:
                active_calls -= 1
            return []

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(
                    fund_app.run_server_ocr,
                    'rapidocr',
                    fake_engine,
                    f'image-{index}.png'
                )
                for index in range(2)
            ]
            for future in futures:
                self.assertEqual(future.result(), ('', []))

        self.assertEqual(max_active_calls, 1)

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
