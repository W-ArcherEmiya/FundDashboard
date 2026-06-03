from flask import Flask, render_template, request, jsonify, send_from_directory
from datetime import datetime, timezone
import csv
import json
import os
import re
import tempfile
import threading

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 9 * 1024 * 1024

# 确保存储文件和你的 app.py 在同一个目录
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_data.json')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(BASE_DIR, 'exports')
RAPIDOCR_MODEL_DIR = os.path.join(BASE_DIR, 'ocr_models', 'rapidocr')
SYNC_CODE_MAX_LENGTH = 64
GROUP_MAX_LENGTH = 32
MAX_FUNDS_PER_SYNC = 500
MAX_SYNC_SNAPSHOT_ITEMS = 500
MAX_EXPORT_ROWS = 1000
MAX_EXPORT_FILES = 30
OCR_MAX_IMAGE_BYTES = 8 * 1024 * 1024
DATA_LOCK = threading.Lock()
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
            'isSyncSnapshot': True,
        }

        for field in ('estRate', 'estNav', 'dailyProfit', 'holdProfit', 'totalAsset'):
            number = normalize_snapshot_number(item.get(field))
            if number is not None:
                snapshot[field] = number

        normalized.append(snapshot)

    return normalized, None


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
        return entry, None, []
    if isinstance(entry, dict) and isinstance(entry.get('data'), list):
        updated_at = entry.get('updated_at')
        snapshot = entry.get('snapshot') if isinstance(entry.get('snapshot'), list) else []
        return entry['data'], updated_at if isinstance(updated_at, str) else None, snapshot
    return None, None, []


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
        with DATA_LOCK:
            db = load_data()
            db[sync_code] = {
                "data": funds_data,
                "snapshot": snapshot_data,
                "updated_at": updated_at,
            }
            save_data(db)
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
        funds_data, updated_at, snapshot_data = unpack_sync_entry(db[sync_code])
        if funds_data is not None:
            return jsonify({
                "success": True,
                "data": funds_data,
                "snapshot": snapshot_data,
                "updated_at": updated_at,
            })
        return jsonify({"success": False, "message": "同步数据格式异常，请重新上传"}), 500
    else:
        return jsonify({"success": False, "message": "未找到该同步码的数据，请先上传"}), 404

if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1', port=5000)
