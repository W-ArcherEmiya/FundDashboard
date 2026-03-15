from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)

# 确保存储文件和你的 app.py 在同一个目录
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_data.json')

def load_data():
    """读取本地 JSON 数据文件"""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_data(data):
    """保存数据到本地 JSON 文件"""
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.route('/')
def index():
    return render_template('index.html')

# --- 新增：云端同步 API ---

@app.route('/api/sync/save', methods=['POST'])
def sync_save():
    """上传数据到云端"""
    req = request.get_json()
    sync_code = req.get('sync_code')
    funds_data = req.get('data')
    
    if not sync_code or funds_data is None:
        return jsonify({"error": "参数缺失"}), 400
    
    db = load_data()
    db[sync_code] = funds_data  # 以同步码为 Key 存储该用户的数据
    save_data(db)
    
    return jsonify({"success": True, "message": "上传成功"})

@app.route('/api/sync/load/<sync_code>', methods=['GET'])
def sync_load(sync_code):
    """从云端下载数据"""
    db = load_data()
    if sync_code in db:
        return jsonify({"success": True, "data": db[sync_code]})
    else:
        return jsonify({"success": False, "message": "未找到该同步码的数据，请先上传"}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)