# 科技工具包

前端页面和后端接口分开。云桥、腾讯云、Sealion、小说渠道的密钥只放在 `backend/.env.local`，浏览器拿不到。

## 目录

- `frontend/`：生图、换脸、去衣、图生视频、小说。开发地址 http://127.0.0.1:3491
- `backend/`：上述功能的接口。地址 http://127.0.0.1:3490

## 启动

```bash
cd backend
npm install
npm run build
npm start
```

另开一个终端：

```bash
cd frontend
npm install
npm run dev
```

打开 http://127.0.0.1:3491 。前端把 `/api` 转到后端。

当前模型：生图、换脸、去衣走云桥 Seedream；图生视频走腾讯云 WAND Vega Video 1.5 Pro；提示词优化走 Sealion。
