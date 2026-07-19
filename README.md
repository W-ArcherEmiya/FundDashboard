# 📈 专属资产看板 (Personal Fund Dashboard)

一个采用前后端分离架构，支持多端云同步并具备“日间实时估算、夜间精准对账”双引擎的轻量级专属资产看板。

## ✨ 核心特性

* **🌙 日夜双擎精准对账**
* **日间盯盘**：并发拉取全网实时盘中估算，毫秒级响应。
* **夜间清算**：智能监听实际净值发布，底层强制锁定**北京时间 (UTC+8)**，免疫跨国时区干扰，实现与支付宝等官方渠道 100% 零误差对账。
* **QDII/增强基金兼容**：对无实时估值接口的特殊基金（如 007721 等）提供历史净值回溯与自动补全。


* **☁️ 极简多端同步 (Sync-Code 机制)**
* 摒弃繁重的账户体系，通过自定义“专属同步码”实现跨设备（PC-PC、PC-移动、移动-移动）的一键数据上传与下发覆盖。


* **🎨 飞书级专业 UI**
* 深度贯彻轻量、克制的数据可视化原则。
* 严格遵循 8pt 间距规范与标准化数字排版（千分位、正负号强制补全）。
* 统一标准涨跌色板（`#D84B45` 涨 / `#2E8B57` 跌），并针对特殊状态采用低饱和度灰阶处理。


* **⚡ 极速加载引擎**
* 前端采用并发行列请求处理，结合 `localStorage` 骨架屏直出，无论持仓多少均可实现“点开即看”。



## 🛠️ 技术栈

* **前端**：HTML5 + CSS3 + 原生 JavaScript (ES6+), Bootstrap 5
* **后端**：Python 3, Flask
* **数据存储**：前端 `localStorage` + 后端轻量级 `JSON` 持久化

## 🧾 截图导入 OCR

截图导入采用“服务端 OCR 优先、浏览器 OCR 兜底”的策略：

1. 前端上传截图到 `/api/ocr/recognize`。
2. 后端优先调用 RapidOCR/PaddleOCR 识别中文截图。
3. 前端根据 OCR 文本结合基金代码表做模糊匹配。
4. 多个候选无法唯一确认时，页面显示候选下拉，避免自动填错基金代码。
5. 如果服务器未安装 OCR 引擎，自动回退到浏览器端 Tesseract.js。

基础依赖：

```bash
pip install -r requirements.txt
```

启用服务端 OCR：

```bash
pip install -r requirements-ocr.txt
```

项目内置了 RapidOCR 需要的 ONNX 模型文件，后端会优先读取 `ocr_models/rapidocr/`，
避免 PythonAnywhere 等受限环境在运行时访问外部模型下载站点。
如服务端 OCR 依赖不可用，应用仍会自动回退到浏览器 OCR。

## ⏱️ 后台自动刷新

PythonAnywhere 免费账户只能访问官方 allowlist 中的外部域名，当前行情域名不在该名单中。
因此免费账户需要至少一台设备保持页面打开，页面会每 5 分钟获取行情并发布云端快照。
浏览器全部关闭后，云端会保留最后一份有效快照，但不会继续更新净值。

### 多设备统一净值

设备通过同步码下载持仓后，“刷新净值”和每 5 分钟自动刷新会先由浏览器获取行情，
再把完整结果发布为统一云端快照。PythonAnywhere 只负责保存和分发，不需要访问受限行情域名。
同一同步码在 30 秒内的重复发布只接受第一份结果，其他设备直接复用相同的快照和更新时间。

本地新增、删除或修改持仓后，需要先在“同步数据”中选择“覆盖到云端”。上传完成后，
页面会立即生成新的统一快照；未上传的本地持仓仍只在当前设备计算，避免被云端旧数据覆盖。
上传时页面会先等待本地净值计算完成，不会用空结果覆盖总览。

以下两种后台刷新方式仅适用于拥有不受限外网访问的 PythonAnywhere 付费账户，
或未来行情域名进入 allowlist 后使用。

### 方式一：PythonAnywhere Tasks

如果你的 PythonAnywhere 账号支持 **Tasks**，新增 scheduled task，定时执行：

```bash
cd /home/ArcherEmiya && python scripts/refresh_cloud_snapshots.py
```

只刷新某一个同步码：

```bash
cd /home/ArcherEmiya && python scripts/refresh_cloud_snapshots.py --sync-code 你的同步码
```

### 方式二：外部免费 cron 访问刷新接口

如果 PythonAnywhere Tasks 不可用，可以用外部 cron 服务定时访问一个受保护 URL。

先在 PythonAnywhere 的 WSGI 配置文件里设置刷新令牌，放在导入 Flask app 之前：

```python
import os
os.environ["FUND_REFRESH_TOKEN"] = "换成一串足够长的随机字符"
```

Reload Web App 后，用浏览器或外部 cron 访问：

```text
https://你的域名.pythonanywhere.com/api/admin/refresh-cloud-snapshots?token=你的刷新令牌
```

只刷新某一个同步码：

```text
https://你的域名.pythonanywhere.com/api/admin/refresh-cloud-snapshots?token=你的刷新令牌&sync_code=你的同步码
```

建议使用 `cron-job.org`、`EasyCron` 等外部服务，频率先设为 30-60 分钟一次。
刷新令牌不要发给别人；未配置 `FUND_REFRESH_TOKEN` 时，该 HTTP 接口默认不可用。

脚本会读取 `sync_data.json` 中已上传的持仓，拉取基金行情并更新同一同步码下的 `snapshot`。
所有已绑定该同步码的设备都会读取这份快照。脚本不会修改份额、成本和分组。

## 📂 目录结构

```text
FundDashboard/
├── app.py                     # Flask 后端主程序（提供 Web 服务与同步 API）
├── fund_refresh.py            # 后台行情刷新与快照计算逻辑
├── scripts/
│   └── refresh_cloud_snapshots.py # PythonAnywhere 定时任务入口
├── static/
│   ├── css/
│   │   └── dashboard.css     # 看板页面样式
│   └── js/
│       └── dashboard/
│           ├── state.js      # 前端运行状态与本地持久化
│           ├── utils.js      # 数字格式化与安全转义工具
│           ├── data.js       # 同步接口与基金数据抓取逻辑
│           ├── ui.js         # 页面渲染与交互逻辑
│           └── main.js       # 启动入口与全局事件绑定
├── templates/
│   └── index.html            # 前端页面模板结构
├── sync_data.json            # 云端同步数据库（自动生成，切勿提交至公开代码库）
├── .gitignore                # Git 忽略配置
└── README.md                 # 项目说明文档

```

---

## 🔄 标准更新工作流 (Standard Update Workflow)

本项目采用 **本地开发 -> GitHub 版本控制 -> PythonAnywhere 生产环境部署** 的标准持续集成工作流。

### 1. 准备工作：配置忽略文件 (极重要)

在本地仓库根目录必须存在 `.gitignore` 文件，包含以下内容，以防泄露个人持仓隐私与同步码：

```text
__pycache__/
*.pyc
.env
sync_data.json

```

### 2. 第一步：本地开发与推送 (Local -> GitHub)

所有的代码修改（如调整 `index.html` UI 或优化 `app.py` 逻辑）均在本地电脑完成。测试无误后，推送到 GitHub：

```bash
# 一条命令运行全部回归测试
python scripts/run_tests.py

# 如需单独执行
python -m unittest discover -s tests -v
node tests/test_dashboard_logic.js

# 添加所有改动
git add .

# 提交改动说明
git commit -m "更新说明：例如修复了某某bug或优化了UI"

# 推送至 GitHub 仓库
git push origin main

```

### 3. 第二步：生产环境拉取 (GitHub -> PythonAnywhere)

登录 PythonAnywhere 控制台，打开 **Bash 终端**，进入项目目录并拉取最新代码：

```bash
# 进入你的实际项目目录 (需替换为真实路径)
cd /home/你的用户名/mysite

# 从 GitHub 拉取最新代码
git pull origin main

```

### 4. 第三步：重启服务使更新生效

1. 在 PythonAnywhere 控制台导航至 **Web** 标签页。
2. 点击上方绿色的 **Reload https://xxx.pythonanywhere.com** 按钮。
3. 刷新手机或浏览器端网页，最新代码即刻生效。
