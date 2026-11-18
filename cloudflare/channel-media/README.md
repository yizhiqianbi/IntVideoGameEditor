# xumeng-channel-media

渠道素材中转 worker，线上域名 `https://channel-media.xumengchat.top`。

## 接口

- `POST /api/studio/channel-reference`：服务端中转上传（图片、文本），请求头带 `x-aiapi-relay`。
- `PUT /api/studio/upload?exp=&bytes=&sig=`：浏览器直传视频。票据由 xumeng-gen 的
  `POST /api/upload-ticket` 用 `AIAPI_SECRETKEY` 签发，签名内容为
  `studio-upload:{exp}:{bytes}` 的 HMAC-SHA256。视频大小必须和票据一致，上限 64MB。
- `GET /api/studio/media/{id}`：读取素材。

## 部署

```bash
cd cloudflare/channel-media
npx wrangler deploy --config wrangler.jsonc
```

worker 需要配置 `AIAPI_SECRETKEY`（与 xumeng-gen 的 Vercel 环境变量一致）。本地调试时
`.dev.vars` 里放同一个密钥，另外可以加 `PUBLIC_ORIGIN=http://127.0.0.1:8787` 让返回的素材地址
指向本地 worker。
