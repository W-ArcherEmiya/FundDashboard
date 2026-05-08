from flask import Flask, render_template, request, jsonify
from datetime import datetime, timezone
import json
import os
import re
import tempfile
import threading

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 256 * 1024

# 确保存储文件和你的 app.py 在同一个目录
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_data.json')
SYNC_CODE_MAX_LENGTH = 64
GROUP_MAX_LENGTH = 32
MAX_FUNDS_PER_SYNC = 500
DATA_LOCK = threading.Lock()


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

@app.route('/')
def index():
    return render_template('index.html')

# --- 新增：云端同步 API ---


@app.errorhandler(413)
def payload_too_large(_):
    return jsonify({"success": False, "error": "请求体过大"}), 413

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
