from flask import Flask, render_template, request, jsonify
from datetime import datetime, timezone
import json
import os
import re
import tempfile
import threading

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 9 * 1024 * 1024

# 确保存储文件和你的 app.py 在同一个目录
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_data.json')
SYNC_CODE_MAX_LENGTH = 64
GROUP_MAX_LENGTH = 32
MAX_FUNDS_PER_SYNC = 500
OCR_MAX_IMAGE_BYTES = 8 * 1024 * 1024
DATA_LOCK = threading.Lock()
OCR_ENGINE_LOCK = threading.Lock()
OCR_ENGINE_STATE = {"name": None, "engine": None, "error": None}


def utc_now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


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
        return entry, None
    if isinstance(entry, dict) and isinstance(entry.get('data'), list):
        updated_at = entry.get('updated_at')
        return entry['data'], updated_at if isinstance(updated_at, str) else None
    return None, None


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

            engine = RapidOCR()
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


def extract_rapidocr_text(result):
    if isinstance(result, tuple):
        result = result[0]
    if hasattr(result, "txts"):
        return "\n".join(str(text) for text in result.txts if text)
    if hasattr(result, "texts"):
        return "\n".join(str(text) for text in result.texts if text)
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
        return extract_paddleocr_text(engine.ocr(image_path, cls=True))
    return extract_rapidocr_text(engine(image_path))

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

        text = run_server_ocr(engine_name, engine, temp_path)
        return jsonify({
            "success": True,
            "engine": engine_name,
            "text": text,
            "text_length": len(text.strip()),
        })
    except Exception:
        return jsonify({"success": False, "error": "服务端 OCR 识别失败", "fallback": "tesseract"}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

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

    updated_at = utc_now_iso()

    try:
        with DATA_LOCK:
            db = load_data()
            db[sync_code] = {
                "data": funds_data,
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
    })

@app.route('/api/sync/load/<sync_code>', methods=['GET'])
def sync_load(sync_code):
    """从云端下载数据"""
    sync_code = normalize_sync_code(sync_code)
    if not sync_code:
        return jsonify({"success": False, "message": "同步码无效"}), 400

    db = load_data()
    if sync_code in db:
        funds_data, updated_at = unpack_sync_entry(db[sync_code])
        if funds_data is not None:
            return jsonify({
                "success": True,
                "data": funds_data,
                "updated_at": updated_at,
            })
        return jsonify({"success": False, "message": "同步数据格式异常，请重新上传"}), 500
    else:
        return jsonify({"success": False, "message": "未找到该同步码的数据，请先上传"}), 404

if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1', port=5000)
