# 格间

格间是一个基于散点工作簿的轻量社区。首页就是全屏电子表格空间，内容以格点卡片散布在单元格里，支持发内容、发图、点赞、批注、热度浮条、搜索和基础管理。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Python + FastAPI
- 数据库：PostgreSQL + SQLAlchemy + Alembic
- 实时：WebSocket
- 部署：Docker Compose

## 目录结构

```text
.
├── backend/            # FastAPI 后端
│   ├── app/
│   │   ├── api/        # 路由、依赖、实时连接和 API helper
│   │   ├── core/       # 配置和安全
│   │   ├── db/         # 数据库连接和会话
│   │   ├── models/     # SQLAlchemy ORM 模型
│   │   ├── schemas/    # Pydantic 入参/出参模型
│   │   └── services/   # 上传、序列化等业务服务
│   ├── alembic/        # 数据库迁移脚本
│   └── requirements.txt
├── frontend/           # React + Vite 前端应用
│   ├── src/            # 页面、组件、API 客户端和类型定义
│   └── package.json
├── docker/             # 前后端镜像和 Nginx 配置
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   └── nginx.conf
├── docker-compose.yml  # 本地和内网部署编排
├── Makefile            # 常用开发命令
└── .env.example        # 环境变量示例
```

## 本地/内网启动

```bash
cp .env.example .env
docker compose up --build
```

访问：

- Web：http://localhost:5173
- 健康检查：http://localhost:5173/api/health

`.env` 里的 `ADMIN_EMAIL` 是管理员邮箱。用这个邮箱注册后，会自动成为管理员。

生产容器使用单入口访问：Nginx 在 Web 容器内提供静态页面，并把 `/api`、`/uploads`、`/ws` 代理到 FastAPI。浏览器不再直连后端端口，图片、登录 cookie 和实时连接都走同一个域名。

## 功能

- 首页格点：内容以可点击卡片散布在表格网格中，支持缩放、重新散布和表格式筛选。
- 热度浮条：按置顶、点赞、评论和图片互动计算热度，在工作簿内直接定位格点。
- 搜索：可搜索标题、正文、分类和作者昵称。
- 批注窗格：点击任意格点或热度项，工作簿内打开内容、图片、点赞和批注区，可发文字或图片回复。
- 管理：管理员可以置顶、隐藏、恢复内容，并删除评论。

## 开发模式

后端：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
python3 main.py
```

前端：

```bash
cd frontend
npm install
npm run dev
```

测试：

```bash
cd backend
.venv/bin/pytest tests -q
cd ../frontend
npm run build
```

## 图片存储

图片不会写入数据库。后端把图片保存到 `UPLOADS_DIR`，Docker 模式下对应 `uploads_data` volume，容器重启后不会丢失。
