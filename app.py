from contextlib import contextmanager
import csv
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import tempfile
import threading
import time

from flask import Flask, jsonify, render_template, request, send_from_directory

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 9 * 1024 * 1024

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'sync_data.json')
EXPORT_DIR = os.path.join(BASE_DIR, 'exports')
RAPIDOCR_MODEL_DIR = os.path.join(BASE_DIR, 'ocr_models', 'rapidocr')
SYNC_CODE_MAX_LENGTH = 64
GROUP_MAX_LENGTH = 32
MAX_FUNDS_PER_SYNC = 500
MAX_SYNC_SNAPSHOT_ITEMS = 500
SYNC_SNAPSHOT_METRIC_FIELDS = ('estNav', 'dailyProfit', 'holdProfit', 'totalAsset')
MAX_EXPORT_ROWS = 1000
MAX_EXPORT_FILES = 30
OCR_MAX_IMAGE_BYTES = 8 * 1024 * 1024
REFRESH_TOKEN_ENV = 'FUND_REFRESH_TOKEN'
CLIENT_REFRESH_REUSE_SECONDS = 5 * 60
REFRESH_LOCK_WAIT_SECONDS = 90
REFRESH_LOCK_STALE_SECONDS = 15 * 60
DATA_LOCK = threading.Lock()
SYNC_REFRESH_LOCKS_GUARD = threading.Lock()
SYNC_REFRESH_LOCKS = {}
OCR_ENGINE_LOCK = threading.Lock()
OCR_ENGINE_STATE = {"name": None, "engine": None, "error": None}
EXPORT_FIELDS = [
    'code',
    'name',
    'shares',
    'cost',
    'group',
    'nav',
    'totalAsset',
    'dailyProfit',
    'holdProfit',
    'navTime',
]


def build_rapidocr_params():
    """Use bundled OCR models when available to avoid runtime downloads on restricted hosts."""
    model_paths = {
        'Det.model_path': os.path.join(RAPIDOCR_MODEL_DIR, 'ch_PP-OCRv4_det_mobile.onnx'),
        'Cls.model_path': os.path.join(RAPIDOCR_MODEL_DIR, 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'),
        'Rec.model_path': os.path.join(RAPIDOCR_MODEL_DIR, 'ch_PP-OCRv4_rec_mobile.onnx'),
        'Rec.rec_keys_path': os.path.join(RAPIDOCR_MODEL_DIR, 'ppocr_keys_v1.txt'),
    }
    if all(os.path.exists(path) for path in model_paths.values()):
        return model_paths
    return None


def utc_now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def parse_utc_iso(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_recent_timestamp(value, max_age_seconds):
    parsed = parse_utc_iso(value)
    if parsed is None or max_age_seconds <= 0:
        return False
    age_seconds = (datetime.now(timezone.utc) - parsed).total_seconds()
    return 0 <= age_seconds < max_age_seconds


def get_sync_refresh_thread_lock(sync_code):
    with SYNC_REFRESH_LOCKS_GUARD:
        return SYNC_REFRESH_LOCKS.setdefault(sync_code, threading.Lock())


@contextmanager
def sync_refresh_lock(sync_code):
    """Serialize refreshes across threads and web worker processes."""
    thread_lock = get_sync_refresh_thread_lock(sync_code)
    lock_name = hashlib.sha256(sync_code.encode('utf-8')).hexdigest()[:24]
    lock_path = f"{DATA_FILE}.{lock_name}.refresh.lock"
    deadline = time.monotonic() + REFRESH_LOCK_WAIT_SECONDS

    with thread_lock:
        lock_fd = None
        while lock_fd is None:
            try:
                lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(lock_fd, str(os.getpid()).encode('ascii'))
            except FileExistsError:
                try:
                    lock_age = time.time() - os.path.getmtime(lock_path)
                    if lock_age > REFRESH_LOCK_STALE_SECONDS:
                        os.remove(lock_path)
                        continue
                except FileNotFoundError:
                    continue

                if time.monotonic() >= deadline:
                    raise TimeoutError("等待同一同步码的刷新任务超时")
                time.sleep(0.1)

        try:
            yield
        finally:
            if lock_fd is not None:
                os.close(lock_fd)
            try:
                os.remove(lock_path)
            except FileNotFoundError:
                pass


def safe_text_cell(value):
    text = '' if value is None else str(value).strip()
    if text and text[0] in ('=', '+', '-', '@'):
        return "'" + text
    return text


def excel_code_cell(value):
    code = '' if value is None else str(value).strip()
    if re.fullmatch(r'\d{1,6}', code):
        return f'="{code.zfill(6)}"'
    return safe_text_cell(code)


def normalize_export_rows(value):
    if not isinstance(value, list):
        return None, "rows 必须是数组"
    if not value:
        return None, "没有可导出的基金数据"
    if len(value) > MAX_EXPORT_ROWS:
        return None, f"单次最多导出 {MAX_EXPORT_ROWS} 条数据"

    rows = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            return None, f"第 {index + 1} 行数据格式错误"

        rows.append({
            'code': excel_code_cell(item.get('code')),
            'name': safe_text_cell(item.get('name')),
            'shares': str(item.get('shares', '')).strip(),
            'cost': str(item.get('cost', '')).strip(),
            'group': safe_text_cell(item.get('group') or '默认分组'),
            'nav': str(item.get('nav', '')).strip(),
            'totalAsset': str(item.get('totalAsset', '')).strip(),
            'dailyProfit': str(item.get('dailyProfit', '')).strip(),
            'holdProfit': str(item.get('holdProfit', '')).strip(),
            'navTime': safe_text_cell(item.get('navTime')),
        })

    return rows, None


def prune_old_exports():
    if not os.path.isdir(EXPORT_DIR):
        return

    files = []
    for name in os.listdir(EXPORT_DIR):
        if re.fullmatch(r'funds-analysis-\d{8}-\d{6}-\d{6}\.csv', name):
            path = os.path.join(EXPORT_DIR, name)
            files.append((os.path.getmtime(path), path))

    for _, path in sorted(files, reverse=True)[MAX_EXPORT_FILES:]:
        try:
            os.remove(path)
        except OSError:
            app.logger.warning("Failed to remove old export file: %s", path)


def normalize_sync_code(value):
    """同步码只接受非空字符串，并限制长度。"""
    if not isinstance(value, str):
        return None

    sync_code = value.strip()
    if not sync_code or len(sync_code) > SYNC_CODE_MAX_LENGTH:
        return None
    return sync_code


def validate_funds_data(value):
    """校验并规范化同步数据，避免坏数据写入 JSON。"""
    if not isinstance(value, list):
        return None, "data 必须是数组"
    if len(value) == 0:
        return None, "至少需要同步 1 条资产"
    if len(value) > MAX_FUNDS_PER_SYNC:
        return None, f"单次同步最多支持 {MAX_FUNDS_PER_SYNC} 条资产"

    normalized = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            return None, f"第 {index + 1} 条资产格式错误"

        code = str(item.get('code', '')).strip()
        shares_raw = str(item.get('shares', '')).strip()
        cost_raw = str(item.get('cost', '')).strip()
        group = str(item.get('group', '默认分组')).strip() or '默认分组'

        if not re.fullmatch(r'\d{6}', code):
            return None, f"第 {index + 1} 条资产代码无效"
        if len(group) > GROUP_MAX_LENGTH:
            return None, f"第 {index + 1} 条资产分组过长"

        try:
            shares = float(shares_raw)
        except ValueError:
            return None, f"第 {index + 1} 条资产份额无效"
        if shares < 0:
            return None, f"第 {index + 1} 条资产份额不能为负数"

        if cost_raw:
            try:
                cost = float(cost_raw)
            except ValueError:
                return None, f"第 {index + 1} 条资产成本无效"
            if cost < 0:
                return None, f"第 {index + 1} 条资产成本不能为负数"
            cost_raw = str(cost)

        normalized.append({
            'code': code,
            'shares': str(shares),
            'cost': cost_raw,
            'group': group,
        })

    return normalized, None


def normalize_snapshot_number(value):
    if value in (None, ''):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float('inf') else None


def validate_sync_snapshot(value, funds_data):
    """Normalize optional display snapshot data stored alongside synced holdings."""
    if value in (None, ''):
        return [], None
    if not isinstance(value, list):
        return None, "snapshot 必须是数组"
    if len(value) > MAX_SYNC_SNAPSHOT_ITEMS:
        return None, f"单次最多同步 {MAX_SYNC_SNAPSHOT_ITEMS} 条快照"

    funds_by_code = {fund['code']: fund for fund in funds_data}
    normalized = []
    for index, item in enumerate(value):
        if item is None:
            normalized.append(None)
            continue
        if not isinstance(item, dict):
            return None, f"第 {index + 1} 条快照格式错误"

        code = str(item.get('code', '')).strip()
        if not re.fullmatch(r'\d{6}', code):
            return None, f"第 {index + 1} 条快照基金代码无效"
        if code not in funds_by_code:
            return None, f"第 {index + 1} 条快照基金不在持仓列表中"

        snapshot = {
            'code': code,
            'group': funds_by_code[code].get('group') or str(item.get('group', '默认分组')).strip() or '默认分组',
            'name': str(item.get('name', '')).strip()[:80],
            'gztime': str(item.get('gztime', '')).strip()[:40],
            'valid': bool(item.get('valid', True)),
            'isActual': bool(item.get('isActual', False)),
            'isBackup': bool(item.get('isBackup', False)),
            'isUnavailable': bool(item.get('isUnavailable', False)),
            'isRefreshFallback': bool(item.get('isRefreshFallback', False)),
            'isSyncSnapshot': True,
        }

        for field in ('estRate', 'estNav', 'dailyProfit', 'holdProfit', 'totalAsset'):
            number = normalize_snapshot_number(item.get(field))
            if number is not None:
                snapshot[field] = number

        if not snapshot['isUnavailable'] and not all(field in snapshot for field in SYNC_SNAPSHOT_METRIC_FIELDS):
            normalized.append(None)
            continue

        normalized.append(snapshot)

    return normalized, None


def has_complete_snapshot_metrics(item):
    return bool(
        isinstance(item, dict)
        and not item.get('isUnavailable')
        and all(normalize_snapshot_number(item.get(field)) is not None for field in SYNC_SNAPSHOT_METRIC_FIELDS)
    )


def merge_snapshot_refresh(funds_data, previous_snapshot, refreshed_snapshot):
    """Keep the latest usable snapshot when a server-side provider is unavailable."""
    previous_by_code = {
        item.get('code'): item
        for item in (previous_snapshot or [])
        if isinstance(item, dict) and item.get('code')
    }
    refreshed_by_code = {
        item.get('code'): item
        for item in (refreshed_snapshot or [])
        if isinstance(item, dict) and item.get('code')
    }

    merged = []
    fallback_count = 0
    for index, fund in enumerate(funds_data):
        code = fund['code']
        direct_refreshed = refreshed_snapshot[index] if index < len(refreshed_snapshot or []) else None
        fresh = direct_refreshed if isinstance(direct_refreshed, dict) and direct_refreshed.get('code') == code else refreshed_by_code.get(code)
        if has_complete_snapshot_metrics(fresh):
            merged.append(fresh)
            continue

        direct_previous = previous_snapshot[index] if index < len(previous_snapshot or []) else None
        previous = direct_previous if isinstance(direct_previous, dict) and direct_previous.get('code') == code else previous_by_code.get(code)
        if has_complete_snapshot_metrics(previous):
            merged.append({
                **previous,
                'group': fund.get('group') or previous.get('group') or '默认分组',
                'isBackup': True,
                'isRefreshFallback': True,
                'isSyncSnapshot': True,
            })
            fallback_count += 1
            continue

        merged.append(fresh)

    return merged, fallback_count


def load_data():
    """读取本地 JSON 数据文件"""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}

def save_data(data):
    """原子写入，避免中途中断导致 JSON 文件损坏。"""
    data_dir = os.path.dirname(DATA_FILE)
    fd, temp_path = tempfile.mkstemp(prefix='sync_data_', suffix='.tmp', dir=data_dir)

    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, DATA_FILE)
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise


def unpack_sync_entry(entry):
    """兼容旧版 list 存储和新版带元数据的对象存储。"""
    if isinstance(entry, list):
        return entry, None, [], None
    if isinstance(entry, dict) and isinstance(entry.get('data'), list):
        updated_at = entry.get('updated_at')
        snapshot = entry.get('snapshot') if isinstance(entry.get('snapshot'), list) else []
        snapshot_updated_at = entry.get('snapshot_updated_at') or entry.get('auto_refreshed_at')
        return (
            entry['data'],
            updated_at if isinstance(updated_at, str) else None,
            snapshot,
            snapshot_updated_at if isinstance(snapshot_updated_at, str) else None,
        )
    return None, None, [], None


def refresh_sync_snapshot(sync_code, min_interval_seconds=0, dry_run=False):
    """Refresh one canonical cloud snapshot, reusing a recent completed refresh."""
    from fund_refresh import refresh_funds_snapshot

    with sync_refresh_lock(sync_code):
        with DATA_LOCK:
            db = load_data()
            entry = db.get(sync_code)
            funds_data, updated_at, snapshot, snapshot_updated_at = unpack_sync_entry(entry)
            if not funds_data:
                return {"found": False, "refreshed": False, "reused": False}

            snapshot_is_complete = (
                isinstance(snapshot, list)
                and len(snapshot) == len(funds_data)
                and all(item is not None for item in snapshot)
            )
            if (
                snapshot_is_complete
                and is_recent_timestamp(snapshot_updated_at, min_interval_seconds)
            ):
                return {
                    "found": True,
                    "refreshed": False,
                    "reused": True,
                    "data": funds_data,
                    "snapshot": snapshot,
                    "updated_at": updated_at,
                    "snapshot_updated_at": snapshot_updated_at,
                    "fallback_count": sum(
                        1 for item in snapshot
                        if isinstance(item, dict) and item.get('isRefreshFallback')
                    ),
                }

            refreshed_snapshot = refresh_funds_snapshot(funds_data)
            normalized_snapshot, snapshot_error = validate_sync_snapshot(refreshed_snapshot, funds_data)
            if snapshot_error:
                raise ValueError(snapshot_error)
            normalized_snapshot, fallback_count = merge_snapshot_refresh(
                funds_data,
                snapshot,
                normalized_snapshot,
            )

            refreshed_at = utc_now_iso()
            if not dry_run:
                normalized_entry = dict(entry) if isinstance(entry, dict) else {}
                normalized_entry.update({
                    "data": funds_data,
                    "snapshot": normalized_snapshot,
                    "updated_at": updated_at or refreshed_at,
                    "snapshot_updated_at": refreshed_at,
                    "auto_refreshed_at": refreshed_at,
                })
                db[sync_code] = normalized_entry
                save_data(db)

            return {
                "found": True,
                "refreshed": True,
                "reused": False,
                "data": funds_data,
                "snapshot": normalized_snapshot,
                "updated_at": updated_at or refreshed_at,
                "snapshot_updated_at": refreshed_at,
                "fallback_count": fallback_count,
            }


def publish_sync_snapshot(sync_code, submitted_snapshot):
    """Publish a browser-fetched snapshot without server-side market access."""
    with sync_refresh_lock(sync_code):
        with DATA_LOCK:
            db = load_data()
            entry = db.get(sync_code)
            funds_data, updated_at, snapshot, _ = unpack_sync_entry(entry)
            if not funds_data:
                return {"found": False, "published": False, "reused": False}

            normalized_snapshot, snapshot_error = validate_sync_snapshot(submitted_snapshot, funds_data)
            if snapshot_error:
                raise ValueError(snapshot_error)
            complete_count = sum(has_complete_snapshot_metrics(item) for item in normalized_snapshot)
            if complete_count == 0:
                raise ValueError("浏览器快照没有可用净值")

            client_refreshed_at = entry.get('client_refreshed_at') if isinstance(entry, dict) else None
            existing_complete_count = sum(has_complete_snapshot_metrics(item) for item in snapshot)
            if (
                existing_complete_count > 0
                and is_recent_timestamp(client_refreshed_at, CLIENT_REFRESH_REUSE_SECONDS)
            ):
                return {
                    "found": True,
                    "published": False,
                    "reused": True,
                    "data": funds_data,
                    "snapshot": snapshot,
                    "updated_at": updated_at,
                    "snapshot_updated_at": client_refreshed_at,
                    "snapshot_source": "browser",
                    "complete_count": existing_complete_count,
                }

            published_at = utc_now_iso()
            normalized_entry = dict(entry) if isinstance(entry, dict) else {}
            normalized_entry.update({
                "data": funds_data,
                "snapshot": normalized_snapshot,
                "updated_at": updated_at or published_at,
                "snapshot_updated_at": published_at,
                "client_refreshed_at": published_at,
                "snapshot_source": "browser",
            })
            db[sync_code] = normalized_entry
            save_data(db)

            return {
                "found": True,
                "published": True,
                "reused": False,
                "data": funds_data,
                "snapshot": normalized_snapshot,
                "updated_at": updated_at or published_at,
                "snapshot_updated_at": published_at,
                "snapshot_source": "browser",
                "complete_count": complete_count,
            }


def refresh_sync_snapshots(sync_code=None, dry_run=False):
    """Refresh cloud display snapshots for one or all sync codes."""
    with DATA_LOCK:
        db = load_data()
        codes = [sync_code] if sync_code else list(db.keys())
        total = len(db)

    refreshed = 0
    skipped = 0
    for code in codes:
        result = refresh_sync_snapshot(code, dry_run=dry_run)
        if not result["found"]:
            skipped += 1
        elif result["refreshed"]:
            refreshed += 1

    return {
        "refreshed": refreshed,
        "skipped": skipped,
        "total": total,
    }


def get_ocr_engine():
    """按可用性懒加载服务端 OCR 引擎，优先轻量 RapidOCR，其次 PaddleOCR。"""
    with OCR_ENGINE_LOCK:
        if OCR_ENGINE_STATE["engine"] is not None:
            return OCR_ENGINE_STATE["name"], OCR_ENGINE_STATE["engine"]
        if OCR_ENGINE_STATE["error"] is not None:
            raise RuntimeError(OCR_ENGINE_STATE["error"])

        errors = []
        try:
            from rapidocr_onnxruntime import RapidOCR

            engine = RapidOCR()
            OCR_ENGINE_STATE.update({"name": "rapidocr_onnxruntime", "engine": engine, "error": None})
            return OCR_ENGINE_STATE["name"], OCR_ENGINE_STATE["engine"]
        except Exception as exc:
            errors.append(f"rapidocr_onnxruntime: {exc}")

        try:
            from rapidocr import RapidOCR

            params = build_rapidocr_params()
            engine = RapidOCR(params=params) if params else RapidOCR()
            OCR_ENGINE_STATE.update({"name": "rapidocr", "engine": engine, "error": None})
            return OCR_ENGINE_STATE["name"], OCR_ENGINE_STATE["engine"]
        except Exception as exc:
            errors.append(f"rapidocr: {exc}")

        try:
            from paddleocr import PaddleOCR

            engine = PaddleOCR(use_angle_cls=True, lang="ch")
            OCR_ENGINE_STATE.update({"name": "paddleocr", "engine": engine, "error": None})
            return OCR_ENGINE_STATE["name"], OCR_ENGINE_STATE["engine"]
        except Exception as exc:
            errors.append(f"paddleocr: {exc}")

        OCR_ENGINE_STATE["error"] = "未安装服务端 OCR 引擎；请安装 rapidocr-onnxruntime 或 paddleocr"
        raise RuntimeError(OCR_ENGINE_STATE["error"] + "；" + "；".join(errors))


def normalize_ocr_box(box):
    points = []
    try:
        for point in box:
            if len(point) < 2:
                continue
            points.append([float(point[0]), float(point[1])])
    except TypeError:
        return None

    if not points:
        return None

    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left = min(xs)
    top = min(ys)
    right = max(xs)
    bottom = max(ys)
    return {
        "points": points,
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "width": right - left,
        "height": bottom - top,
        "cx": (left + right) / 2,
        "cy": (top + bottom) / 2,
    }


def make_ocr_block(text, box=None, score=None):
    text = str(text or "").strip()
    if not text:
        return None

    block = {"text": text}
    normalized_box = normalize_ocr_box(box) if box is not None else None
    if normalized_box:
        block.update(normalized_box)
    if score is not None:
        try:
            block["score"] = float(score)
        except (TypeError, ValueError):
            pass
    return block


def extract_rapidocr_blocks(result):
    if isinstance(result, tuple):
        result = result[0]
    if result is None:
        return []

    if hasattr(result, "txts") and hasattr(result, "boxes"):
        txts = getattr(result, "txts", None) or []
        boxes = getattr(result, "boxes", None)
        scores = getattr(result, "scores", None) or []
        if boxes is None:
            return []
        return [
            block for block in (
                make_ocr_block(text, box, scores[index] if index < len(scores) else None)
                for index, (text, box) in enumerate(zip(txts, boxes))
            )
            if block
        ]

    blocks = []
    for item in result:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            box = item[0]
            text = None
            score = None
            if isinstance(item[1], (list, tuple)) and item[1]:
                text = item[1][0]
                score = item[1][1] if len(item[1]) > 1 else None
            else:
                text = item[1]
                score = item[2] if len(item) > 2 else None
            block = make_ocr_block(text, box, score)
            if block:
                blocks.append(block)
        elif isinstance(item, dict):
            block = make_ocr_block(
                item.get("text") or item.get("rec_text"),
                item.get("box") or item.get("points") or item.get("dt_box"),
                item.get("score") or item.get("confidence") or item.get("rec_score")
            )
            if block:
                blocks.append(block)
    return blocks


def extract_paddleocr_blocks(result):
    blocks = []

    def walk(value):
        if not value:
            return
        if isinstance(value, dict):
            block = make_ocr_block(
                value.get("text") or value.get("rec_text"),
                value.get("box") or value.get("points") or value.get("dt_box"),
                value.get("score") or value.get("confidence") or value.get("rec_score")
            )
            if block:
                blocks.append(block)
            return
        if isinstance(value, (list, tuple)):
            if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1]:
                block = make_ocr_block(
                    value[1][0],
                    value[0],
                    value[1][1] if len(value[1]) > 1 else None
                )
                if block:
                    blocks.append(block)
                return
            for item in value:
                walk(item)

    walk(result)
    return blocks


def extract_ocr_payload(engine_name, result):
    blocks = extract_paddleocr_blocks(result) if engine_name == "paddleocr" else extract_rapidocr_blocks(result)
    if blocks:
        text = "\n".join(block["text"] for block in blocks if block.get("text"))
        return text, blocks

    if engine_name == "paddleocr":
        return extract_paddleocr_text(result), []
    return extract_rapidocr_text(result), []


def extract_rapidocr_text(result):
    if isinstance(result, tuple):
        result = result[0]
    if hasattr(result, "txts"):
        return "\n".join(str(text) for text in (result.txts or []) if text)
    if hasattr(result, "texts"):
        return "\n".join(str(text) for text in (result.texts or []) if text)
    if not result:
        return ""

    lines = []
    for item in result:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            lines.append(str(item[1]))
        elif isinstance(item, dict):
            text = item.get("text") or item.get("rec_text")
            if text:
                lines.append(str(text))
    return "\n".join(lines)


def extract_paddleocr_text(result):
    lines = []

    def walk(value):
        if not value:
            return
        if isinstance(value, dict):
            text = value.get("text") or value.get("rec_text")
            if text:
                lines.append(str(text))
            return
        if isinstance(value, (list, tuple)):
            if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1]:
                lines.append(str(value[1][0]))
                return
            for item in value:
                walk(item)

    walk(result)
    return "\n".join(lines)


def run_server_ocr(engine_name, engine, image_path):
    if engine_name == "paddleocr":
        return extract_ocr_payload(engine_name, engine.ocr(image_path, cls=True))
    return extract_ocr_payload(engine_name, engine(image_path))

@app.route('/')
def index():
    return render_template('index.html')

# --- 新增：云端同步 API ---


@app.errorhandler(413)
def payload_too_large(_):
    return jsonify({"success": False, "error": "请求体过大"}), 413


@app.route('/api/ocr/recognize', methods=['POST'])
def ocr_recognize():
    image = request.files.get('image')
    if image is None:
        return jsonify({"success": False, "error": "缺少截图文件"}), 400

    content = image.read()
    if not content:
        return jsonify({"success": False, "error": "截图文件为空"}), 400
    if len(content) > OCR_MAX_IMAGE_BYTES:
        return jsonify({"success": False, "error": "截图文件不能超过 8MB"}), 413

    if image.mimetype and not image.mimetype.startswith('image/'):
        return jsonify({"success": False, "error": "仅支持图片文件"}), 400

    try:
        engine_name, engine = get_ocr_engine()
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc), "fallback": "tesseract"}), 503

    suffix = os.path.splitext(image.filename or '')[1] or '.png'
    fd, temp_path = tempfile.mkstemp(prefix='fund_ocr_', suffix=suffix)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(content)

        text, blocks = run_server_ocr(engine_name, engine, temp_path)
        return jsonify({
            "success": True,
            "engine": engine_name,
            "text": text,
            "blocks": blocks,
            "text_length": len(text.strip()),
        })
    except Exception:
        app.logger.exception("Server OCR recognition failed")
        return jsonify({"success": False, "error": "服务端 OCR 识别失败", "fallback": "tesseract"}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route('/api/export/funds-analysis', methods=['POST'])
def export_funds_analysis():
    req = request.get_json(silent=True)
    if not isinstance(req, dict):
        return jsonify({"success": False, "error": "请求体必须是 JSON 对象"}), 400

    rows, error = normalize_export_rows(req.get('rows'))
    if error:
        return jsonify({"success": False, "error": error}), 400

    try:
        os.makedirs(EXPORT_DIR, exist_ok=True)
        filename = f"funds-analysis-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.csv"
        path = os.path.join(EXPORT_DIR, filename)
        with open(path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=EXPORT_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        prune_old_exports()
    except OSError:
        app.logger.exception("Failed to export funds analysis CSV")
        return jsonify({"success": False, "error": "生成导出文件失败"}), 500

    return jsonify({
        "success": True,
        "filename": filename,
        "path": f"exports/{filename}",
        "download_url": f"/exports/{filename}",
        "rows": len(rows),
    })


@app.route('/api/market/refresh', methods=['POST'])
def market_refresh():
    """Return one isolated, server-calculated market snapshot for local holdings."""
    req = request.get_json(silent=True)
    if not isinstance(req, dict):
        return jsonify({"success": False, "error": "请求体必须是 JSON 对象"}), 400

    funds_data, error = validate_funds_data(req.get('funds'))
    if error:
        return jsonify({"success": False, "error": error}), 400

    try:
        from fund_refresh import refresh_funds_snapshot

        refreshed_snapshot = refresh_funds_snapshot(funds_data)
        snapshot, snapshot_error = validate_sync_snapshot(refreshed_snapshot, funds_data)
        if snapshot_error:
            raise ValueError(snapshot_error)
    except Exception:
        app.logger.exception("Market snapshot refresh failed")
        return jsonify({"success": False, "error": "服务端行情刷新失败"}), 500

    return jsonify({
        "success": True,
        "snapshot": snapshot,
        "refreshed_at": utc_now_iso(),
        "complete_count": sum(has_complete_snapshot_metrics(item) for item in snapshot),
        "unavailable_count": sum(
            1 for item in snapshot
            if isinstance(item, dict) and item.get('isUnavailable')
        ),
    })


@app.route('/exports/<filename>', methods=['GET'])
def download_export(filename):
    if not re.fullmatch(r'funds-analysis-\d{8}-\d{6}-\d{6}\.csv', filename):
        return jsonify({"success": False, "error": "导出文件名无效"}), 404
    return send_from_directory(EXPORT_DIR, filename, as_attachment=True, download_name=filename)


@app.route('/api/sync/save', methods=['POST'])
def sync_save():
    """上传数据到云端"""
    req = request.get_json(silent=True)
    if not isinstance(req, dict):
        return jsonify({"success": False, "error": "请求体必须是 JSON 对象"}), 400

    sync_code = normalize_sync_code(req.get('sync_code'))
    funds_data, error = validate_funds_data(req.get('data'))

    if not sync_code:
        return jsonify({"success": False, "error": "同步码无效"}), 400
    if error:
        return jsonify({"success": False, "error": error}), 400

    snapshot_data, snapshot_error = validate_sync_snapshot(req.get('snapshot'), funds_data)
    if snapshot_error:
        return jsonify({"success": False, "error": snapshot_error}), 400

    updated_at = utc_now_iso()

    try:
        with sync_refresh_lock(sync_code):
            with DATA_LOCK:
                db = load_data()
                db[sync_code] = {
                    "data": funds_data,
                    "snapshot": snapshot_data,
                    "updated_at": updated_at,
                    # Browser snapshots are useful for immediate restore but are not canonical.
                    "snapshot_updated_at": None,
                }
                save_data(db)
    except TimeoutError:
        return jsonify({"success": False, "error": "云端正在刷新，请稍后重新上传"}), 503
    except OSError:
        return jsonify({"success": False, "error": "写入同步数据失败"}), 500

    return jsonify({
        "success": True,
        "message": "上传成功",
        "updated_at": updated_at,
        "count": len(funds_data),
        "snapshot_count": len([item for item in snapshot_data if item]),
    })

@app.route('/api/sync/load/<sync_code>', methods=['GET'])
def sync_load(sync_code):
    """从云端下载数据"""
    sync_code = normalize_sync_code(sync_code)
    if not sync_code:
        return jsonify({"success": False, "message": "同步码无效"}), 400

    db = load_data()
    if sync_code in db:
        funds_data, updated_at, snapshot_data, snapshot_updated_at = unpack_sync_entry(db[sync_code])
        if funds_data is not None:
            return jsonify({
                "success": True,
                "data": funds_data,
                "snapshot": snapshot_data,
                "updated_at": updated_at,
                "snapshot_updated_at": snapshot_updated_at,
            })
        return jsonify({"success": False, "message": "同步数据格式异常，请重新上传"}), 500
    else:
        return jsonify({"success": False, "message": "未找到该同步码的数据，请先上传"}), 404


@app.route('/api/sync/refresh/<sync_code>', methods=['POST'])
def sync_refresh(sync_code):
    """Refresh and return the canonical snapshot shared by all devices."""
    sync_code = normalize_sync_code(sync_code)
    if not sync_code:
        return jsonify({"success": False, "error": "同步码无效"}), 400

    try:
        force_refresh = str(request.args.get('force', '')).strip().lower() in {'1', 'true', 'yes'}
        result = refresh_sync_snapshot(
            sync_code,
            min_interval_seconds=0 if force_refresh else CLIENT_REFRESH_REUSE_SECONDS,
        )
    except TimeoutError:
        return jsonify({"success": False, "error": "云端正在刷新，请稍后重试"}), 503
    except Exception:
        app.logger.exception("Client cloud snapshot refresh failed")
        return jsonify({"success": False, "error": "云端净值刷新失败"}), 500

    if not result["found"]:
        return jsonify({"success": False, "error": "未找到该同步码的数据"}), 404

    return jsonify({"success": True, **result})


@app.route('/api/sync/publish/<sync_code>', methods=['POST'])
def sync_publish(sync_code):
    """Accept a canonical snapshot fetched by a browser client."""
    sync_code = normalize_sync_code(sync_code)
    if not sync_code:
        return jsonify({"success": False, "error": "同步码无效"}), 400

    req = request.get_json(silent=True)
    if not isinstance(req, dict):
        return jsonify({"success": False, "error": "请求体必须是 JSON 对象"}), 400

    try:
        result = publish_sync_snapshot(sync_code, req.get('snapshot'))
    except TimeoutError:
        return jsonify({"success": False, "error": "另一台设备正在发布快照，请稍后重试"}), 503
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except OSError:
        app.logger.exception("Browser cloud snapshot publish failed")
        return jsonify({"success": False, "error": "写入云端快照失败"}), 500

    if not result["found"]:
        return jsonify({"success": False, "error": "未找到该同步码的数据"}), 404

    return jsonify({"success": True, **result})


@app.route('/api/admin/refresh-cloud-snapshots', methods=['GET', 'POST'])
def admin_refresh_cloud_snapshots():
    expected_token = os.environ.get(REFRESH_TOKEN_ENV, '').strip()
    if not expected_token:
        return jsonify({
            "success": False,
            "error": f"未配置 {REFRESH_TOKEN_ENV}，后台刷新接口未启用"
        }), 503

    provided_token = (
        request.headers.get('X-Refresh-Token')
        or request.args.get('token')
        or ''
    ).strip()
    if provided_token != expected_token:
        return jsonify({"success": False, "error": "刷新令牌无效"}), 401

    sync_code = normalize_sync_code(request.args.get('sync_code') or '')
    if request.args.get('sync_code') and not sync_code:
        return jsonify({"success": False, "error": "同步码无效"}), 400

    try:
        result = refresh_sync_snapshots(sync_code=sync_code)
    except Exception:
        app.logger.exception("Cloud snapshot refresh failed")
        return jsonify({"success": False, "error": "后台刷新失败"}), 500

    if sync_code and result["refreshed"] == 0:
        return jsonify({"success": False, "error": "未找到该同步码的数据", **result}), 404

    return jsonify({"success": True, **result})

if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1', port=5000)
