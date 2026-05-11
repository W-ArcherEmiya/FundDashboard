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

## 📂 目录结构

```text
FundDashboard/
├── app.py                     # Flask 后端主程序（提供 Web 服务与同步 API）
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
