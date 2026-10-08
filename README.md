# FundDashboard

一个面向个人使用的基金持仓看板。支持持仓与自选基金管理、截图导入、净值展示，以及通过同步码在多个设备间同步数据。

## 功能

- 按自定义分组管理基金持仓，并汇总资产、持有收益和当日盈亏
- 固定的自选标签页，可仅添加基金代码而不填写份额和成本
- 从支付宝基金持仓截图批量识别基金名称、代码、金额和收益
- 展示最新正式净值、资产金额和收益情况
- 使用同步码在 PC 和移动端之间同步持仓及行情快照
- 导出基金分析 CSV
- 响应式页面，适配桌面和移动浏览器

## 行情数据

页面以基金正式净值作为主要行情数据。正式净值来自天天基金公开页面及接口，最终结果以基金管理人披露的信息为准。

部分基金在正式净值发布前可能显示第三方盘中参考数据。该数据覆盖范围有限，仅用于辅助查看，不代表基金实际净值；不可用时页面继续显示最新正式净值。

数据仅供个人记录和参考，不构成投资建议。外部行情接口发生变更时，行情刷新可能暂时不可用。

## 本地运行

要求 Python 3.10 或更高版本。

```bash
python -m venv .venv
```

Windows：

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

macOS 或 Linux：

```bash
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

启动后访问 `http://127.0.0.1:5000/`。

## 截图导入

截图导入采用服务端 OCR 优先、浏览器 OCR 兜底的方式：

1. 图片上传至 `/api/ocr/recognize`。
2. 服务端使用 RapidOCR 识别文字。
3. 前端结合基金代码表匹配基金；存在多个相似结果时由用户确认。
4. 服务端 OCR 不可用时，回退至浏览器端 Tesseract.js。

启用服务端 OCR：

```bash
pip install -r requirements-ocr.txt
```

项目内置 RapidOCR 所需的 ONNX 模型，默认从 `ocr_models/rapidocr/` 读取。批量图片的识别质量可能低于逐张导入，确认前应检查基金代码和金额。

## 数据同步

应用没有账户系统。用户输入同步码后，可以将本地持仓覆盖到云端，或将云端数据下载到当前设备。

- 持仓主要保存在浏览器 `localStorage`
- 云端同步数据保存在服务端 `sync_data.json`
- 同步码相当于访问凭据，不应使用手机号等敏感信息，也不应公开分享
- 云端覆盖和本地下载都是替换操作，执行前应确认数据方向
- 本地修改持仓后，需要再次“覆盖到云端”才能同步到其他设备

`sync_data.json` 已加入 `.gitignore`，不要提交到公开仓库。

## 测试

运行全部测试：

```bash
python scripts/run_tests.py
```

分别运行后端和前端测试：

```bash
python -m unittest discover -s tests -v
node tests/test_dashboard_logic.js
```

## 项目结构

```text
FundDashboard/
├── app.py                     # Flask 应用与 API
├── fund_refresh.py            # 行情与快照计算
├── ocr_models/                # RapidOCR 模型
├── scripts/
│   ├── refresh_cloud_snapshots.py
│   └── run_tests.py
├── static/
│   ├── css/dashboard.css
│   └── js/dashboard/          # 前端状态、数据、OCR 和 UI 模块
├── templates/index.html       # 页面模板
├── tests/                     # 后端与前端测试
├── requirements.txt
└── requirements-ocr.txt
```

## 技术栈

- 后端：Python、Flask
- 前端：HTML、CSS、原生 JavaScript、Bootstrap 5
- 存储：浏览器 `localStorage`、服务端 JSON 文件
- OCR：RapidOCR、ONNX Runtime、Tesseract.js
