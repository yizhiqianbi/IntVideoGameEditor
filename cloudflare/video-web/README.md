# xumeng-video

独立部署到 `video.xumengchat.top` 的短剧目录与播放器，视觉参考 `huangguoai.com`，品牌、文案和素材使用叙梦自己的目录/样片。

## 本地

```bash
npm install
npm run check
npm run dev
```

本地预览从 `../../hgtv_sample` 读取授权样片；生产环境从同一账号的 `dzmm-media` R2 `video/sample/` 前缀读取媒体。

## Cloudflare

- Worker：`xumeng-video`
- 自定义域：`video.xumengchat.top`
- R2：`dzmm-media`
- 媒体路径：`/media/<R2 key>`
- 健康检查：`/api/health`

当前部署只包含已确认范围内的 10 集样片。第三方站点的全量剧集需先确认版权/再授权范围，再使用导入器批量写入 R2。
