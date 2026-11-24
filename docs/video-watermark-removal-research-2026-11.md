# 视频去水印 / 画面擦除 方案与成本调研

> 调研时间：2026-11-22 ｜ 口径：1080p（短边 ≤1080）、人民币；美元按 ≈7.2 折算
> 结论先行：**没有"一键去水印"的通用大模型，实际是「水印定位（mask）+ 视频修复/生成式补全」的组合**。可选项分三层：云 API（最快上线，0.1–30 元/分钟）、开源自建（Apache-2.0 可用，边际成本约 0.1–2 元/分钟）、海外按秒/按条 API（0.05–1.2 美元/条或分钟）。

---

## 1. 先分清"水印"类型，难度和价格差 100 倍

| 类型 | 典型场景 | 技术方案 | 1080p 参考价 |
| --- | --- | --- | --- |
| 固定角标 / 半透明 Logo | 平台水印、台标、AI 视频角标 | 模板匹配固定 mask + 局部图像/视频修复 | **0.1–0.8 元/分钟** |
| 硬字幕（文字水印） | 短剧、影视二创 | OCR/文字检测出 mask + 擦除（可顺带提取字幕） | **0.4–3 元/分钟** |
| 动态 / 滚动 / 大范围水印 | 滚动跑马灯、半屏贴图 | SAM2 跟踪 mask + 视频 inpainting（易闪烁、易残影） | **3–30 元/分钟** |
| 全屏"二次加工痕迹" | 文字+Logo+二维码+贴图混合 | 生成式大模型整体擦除（如腾讯"大模型至尊版"） | **30 元/分钟（4K 75）** |
| 暗水印 / 数字水印 | AIGC 隐式标识、版权溯源 | **像素修复去不掉**，只能检测/提取（火山暗水印、腾讯数字水印） | 不适用 |

> 重要的行业事实：真正"专门做视频浮层去除"的模型 2026 年才出现（见 §2 的 DeOverlay），此前都是用**视频物体擦除 / 视频修复（video inpainting）**模型代打。

---

## 2. 开源模型 / 自建路线

### 2.1 可直接用的模型

| 模型 | 类型/发布 | 显存与速度 | 许可 | 商用 | 说明 |
| --- | --- | --- | --- | --- | --- |
| **DeOverlay**（字节跳动，2026-10，arXiv 2610.26081） | 专门做 **视频浮层去除**（字幕/标题/水印/Logo/贴纸），含 DVTE-Bench（1631 对视频、8 类文字浮层） | A100 上 1-step **3.08 FPS**、4-step 2.07 FPS，峰值 **12.2 GB**（含编解码，650 帧） | 论文称将放出代码/基准 | 待确认 | 目前最对口的 SOTA；论文明确"代码与评测会开放"，**截至 2026-11 未见仓库**，需盯 [项目页](https://yahooo-m.github.io/DVTE-Bench/) |
| **SVOR**（小米，CVPR 2026） | 视频物体移除，专治阴影/反光/剧烈运动/烂 mask | 默认 **33 GB**；`--gpu_memory_mode model_cpu_offload` 可跑 **24 GB**（3090/4090）；480p 可再降 | **Apache-2.0** | ✅ | 商用最稳的开源选择之一；需自备 mask（SAM2） |
| **DiffuEraser**（2025） | 扩散式视频修复，时序一致性较好 | 单卡 24 GB 可跑（视分辨率/帧数） | **Apache-2.0**（代码与权重） | ✅ | 710★，ComfyUI 节点齐全，社区教程多 |
| **MiniMax-Remover**（NeurIPS 2025） | 蒸馏式物体移除，**6 步无 CFG** | 峰值 **10.8 GB**，A100 上 2.64 FPS | 权重 **CC-BY-NC-4.0** | ❌ 非商用 | 效果/速度很好，但**商用需另行授权** |
| **ProPainter**（ICCV 2023） | 光流+传播式修复，老牌基线 | 720p 80 帧 fp16 需 **25 GB**；全帧 1080p 在 A100 上 2.34 FPS、峰值 34 GB | **S-Lab 1.0（仅非商用）** | ❌ | 效果好但慢、吃显存，**许可不能商用**，只适合内部验证/对标 |
| **video-subtitle-remover (VSR)** | 成品工具（GUI/CLI/Docker），去硬字幕+文字水印 | 后端 STTN（快、真人好）/ LAMA（动画/图片好）/ ProPainter（剧烈运动好） | 仓库 **Apache-2.0**（内置模型许可需逐个确认，ProPainter 后端非商用） | ⚠️ 看后端 | **13.9k★**，本地一键跑，最适合做 POC 基线；CPU 也能跑（很慢） |
| **Wan2.1 VACE / VACE**（阿里） | 通用视频编辑（掩膜重绘/扩图/参考生成），可做擦除 | 需大显存（A100 级） | **Apache-2.0** | ✅ | 灵活但要自己造 mask、算力贵，更适合做"编辑"而非批量去水印 |
| **LaMa / IOPaint**（图像） | 单帧修复，配时序平滑 | 小 mask 在 4090 上可达十几~几十 FPS | Apache-2.0 | ✅ | **性价比核弹**：固定小角标用"逐帧 LaMa + 时域约束"就够，成本可压到 0.05–0.1 元/分钟 |

配套定位工具：**SAM2**（Apache-2.0，跟踪 mask）、PaddleOCR/OCR 检测（文字水印）、模板匹配（固定角标）。**工程上"找水印"往往比"修水印"更花时间**。

### 2.2 自建算力成本（估算）

- GPU 租金（RunPod，按秒计费）：A100 PCIe **$1.19/小时**（Community）/ $2.09（Secure）；H100 PCIe **$1.99/小时** 起；国内同档 4090 约 ¥2–4/小时。
- 全帧视频模型（DeOverlay/MiniMax-Remover/ProPainter 量级，约 **2.3–3.1 FPS @A100**）：
  1 分钟 1080p30 视频 = 1800 帧 ≈ **10–13 分钟 GPU** ≈ **$0.20–0.26 ≈ ¥1.4–1.9/分钟**。
  → 和国内云 API 的中档价（1–3 元/分钟）**基本打平，没优势**。
- 关键优化：水印通常只占画面 3%–8%。**只对水印外接框裁切区域做修复**，速度提升 5–10 倍 →
  全帧成本降到 **¥0.15–0.4/分钟**；固定角标走 LaMa 逐帧可到 **¥0.05–0.1/分钟**。
- 固定成本：开发 2–4 人周（检测/mask/修复/重编码/音轨/任务队列）+ GPU 常驻或弹性 + 存储带宽。
- 粗算单卡 4090 产能（优化后小区域 20 FPS 量级）：一张卡一天约处理 **10–16 小时成片**，GPU 成本 ¥48–96/天 → **约 0.05–0.1 元/分钟**（不含研发摊销）。

**自建结论**：日处理量 < 数百分钟，买 API 更划算；日处理量 > 数十小时且以固定角标/字幕为主，自建 1–3 个月可回本；DiffuEraser（Apache-2.0）+ SAM2 是目前最稳妥的商用组合，ProPainter/MiniMax-Remover 商用需换掉。

---

## 3. 云 API 价目（均为 1080p，元/分钟）

| 厂商 / 产品 | 能力 | 1080p 单价 | 30 秒单条 | 备注 |
| --- | --- | --- | --- | --- |
| 腾讯云 MPS 智能擦除 · 去 Logo 基础版 | 模糊遮挡 | **0.34** | 0.17 | 有模糊块，不"无痕" |
| 腾讯云 MPS 智能擦除 · 去 Logo 高级版 | 无痕 | **3.00** | 1.50 | 720p 1.5 / 4K 6 |
| 腾讯云 MPS 智能擦除 · 去字幕 | 无痕 + 可选 OCR/翻译/压制 | **3.00** | 1.50 | 720p 1.5 / 4K 6 |
| 腾讯云 MPS 智能擦除 · **大模型至尊版** | 全屏文字/Logo/台标/二维码/贴图 生成式擦除 | **30.00** | 15.00 | 官方仅列 1080p 30、4K 75 |
| 腾讯云点播 · 去除水印（旧计费） | 基础去水印 | **0.34** | 0.17 | SD 0.13 / 2K 0.67 / 4K 1.34 |
| 阿里云 IMS 智能生产 · 图标擦除（智能遮标） | 无痕 | **0.40** | 0.20 | 需【企业订阅】150 元/月（年付 1500，折扣 0.89）或 20 元体验月包 |
| 阿里云 IMS · 字幕擦除 普通版 / 高级版 | 普通有残留 / 高级无痕 | **0.40 / 0.80** | 0.20 / 0.40 | 字幕提取另 0.10 |
| 百度智能云 MCT · 智能去水印 | 基础 | **0.20** | 0.10 | LD 0.08 / SD 0.15 / 2K 0.3 / 4K 1.5 |
| 百度智能云 MCT · 智能去字幕 | 无痕 | **1.80** | 0.90 | 2K/4K 2.5 |
| 火山引擎 AI MediaKit · 智能擦除 / 字幕擦除（精细化版） | 无痕，按输出时长、与分辨率无关 | **1.00** | 0.50 | 支持时间段过滤（只擦某几段） |
| 火山引擎 LAS · 视频修复 `las_video_inpaint` | 去水印/字幕/Logo，支持固定 bbox，≤4 小时/30 GB | **1.20 / 1.60 / 2.80 / 3.20** | 0.6–1.6 | 四档 = pixel_replace / pixel_generate × 普通/精准检测 |
| 小云雀（xyq）· 擦字幕 | 去已有视频字幕 | **积分制，单价未公开** | — | 本工作区已有现成 CLI（`erase-video-subtitle`），按积分扣费，可查余额 |

**低到高排序（1080p）**：百度去水印 0.20 ≈ 腾讯/云点播基础 0.34 < 阿里图标 0.40 < 阿里字幕高级 0.80 < 火山 MediaKit 1.0 ≈ 火山 LAS 1.2 < 百度去字幕 1.8 ≈ 腾讯高级 3.0 ≈ 火山 LAS 3.2 **<<** 腾讯大模型至尊版 30。

> 价目陷阱：①腾讯基础版是**模糊**不是擦除；②阿里 IMS 有**订阅门槛**（150 元/月起）；③多数产品按**输入/输出时长取整分钟**计费，失败重试也计费；④"智能擦除/至尊版"这类按"二次加工痕迹"卖，和普通去 Logo 不是同一档能力。

---

## 4. 海外 API / SaaS（按秒、按条、订阅）

| 服务 | 定价 | 折算 | 说明 |
| --- | --- | --- | --- |
| **WaveSpeed · Video Eraser** | **$0.02/秒**，最低 $0.06，>600 秒按 600 秒封顶 | $1.2/分钟 ≈ **¥8.6/分钟** | 传 mask，时序一致；官方说"静态水印/角标效果最好，人动得太厉害效果会明显下降" |
| **fal · VOID Video Inpainting** | **$0.05/条**（开 Pass2 $0.1；SAM3 自动出 mask 再 +$0.05） | ≈ ¥0.36/条 | 按条计费，适合短片段/快速验证 |
| **Replicate · ProPainter** | 约 **$0.029/次**（L40S） | ≈ ¥0.21/次 | 按次，短片段；跑在 L40S 上 |
| **Vmake** | 订阅制：Free / Plus / Pro / Max，免费档有限；付费档去水印配额 10–50 文件/天 | 需按套餐 | 卖点就是 **Sora / Gemini / Kling / Nano Banana 水印去除**，偏 C 端工具，有 API/CLI 入口 |

海外 API 的**单价其实不便宜**（WaveSpeed ≈ ¥8.6/分钟，贵过国内所有 API），优势是无需备案/资质、按秒计费、对短视频更灵活。

---

## 5. 选型建议（结合本工作区的视频编辑器场景）

1. **先定义"水印"**：平台角标？硬字幕？还是 AI 视频的 AIGC 标识？三者方案完全不同。
2. **量大 + 固定角标/字幕**（最可能的场景）：
   - 最快上线：**阿里云 IMS 图标擦除 0.40 / 字幕擦除高级 0.80**（20 元体验包即可验证），或 **火山 MediaKit 1.0**（支持只擦某时间段）。
   - 要求无痕且预算可接受：**腾讯 MPS 去 Logo 高级版 / 去字幕 3.0**。
   - 价格敏感/超大量：自建 **DiffuEraser(Apache-2.0) + SAM2** 或 **SVOR(Apache-2.0)**，只裁水印区域，边际成本压到 **0.1–0.3 元/分钟**；固定小角标直接用 LaMa 逐帧，0.05–0.1 元/分钟。
3. **"整屏二次加工痕迹"**（去平台水印、去多处贴图）：只有生成式大模型能做好 → **腾讯大模型至尊版 30 元/分钟**，只适合高价值付费场景（短剧出海二次发行等）。
4. **不要碰的方向**：暗水印/数字水印（火山/腾讯只有"添加/提取"，像素修复去不掉）；把"去水印"宣传成能规避平台审核。
5. **POC 顺序**：拿 3–5 条真实样本 → ①VSR/ProPainter 本地基线（0 成本，看效果上限）→ ②阿里/火山 API（几十元内验证质量）→ ③腾讯高级版对比无痕度 → ④再决定自建还是长期买量。

### 合规提醒（很重要）
- 《人工智能生成合成内容标识办法》（2025-09-01 施行）要求 AI 生成内容带显式/隐式标识。**批量去除 AIGC 标识再传播**有明确合规风险，产品里应限制为"用户自有/已授权素材"，并留处理日志与用户承诺。
- 去除他人平台水印（抖音、即梦、可灵、Sora 等）可能违反平台协议与《著作权法》，存在不正当竞争风险。
- 技术上：处理后必须重编码，注意画质损失、音轨同步、可变帧率（VFR）时间轴问题。

---

## 6. 参考来源

- 腾讯云 MPS 智能擦除计费：https://cloud.tencent.com/document/product/862/36180
- 腾讯云 MPS 智能擦除接入（去字幕/去 Logo 参数）：https://cloud.tencent.com/document/product/862/101530
- 腾讯云点播 去除水印按量计费：https://cloud.tencent.com/document/buy-guide/266/14666
- 阿里云 IMS 智能生产计费（图标擦除 0.4 / 字幕擦除 0.4、0.8）：https://help.aliyun.com/zh/ims/intelligent-production-billing
- 阿里云 IMS 订阅计费（150 元/月起）：https://help.aliyun.com/zh/ims/billing-overview
- 百度智能云 MCT AI 视频处理计费（去水印 0.08–1.5、去字幕 1–2.5）：https://cloud.baidu.com/doc/MCT/s/Dltyea3np
- 火山引擎 AI MediaKit 视频工具计费（智能擦除/字幕擦除 1 元/分钟）：https://docs.volcengine.com/docs/intelligent-processing/video-tool-billing?lang=zh
- 火山引擎 LAS 视频修复价格：https://github.com/bytedance/agentkit-samples/blob/main/skills/byted-las-video-inpaint/references/prices.md
- 火山引擎 LAS 视频修复 Skill（能力说明）：https://github.com/bytedance/agentkit-samples/blob/main/skills/byted-las-video-inpaint/SKILL.md
- 火山引擎视频暗水印提取：https://docs.volcengine.com/docs/intelligent-processing/extract-video-invisible-watermark?lang=zh
- DeOverlay 论文（arXiv 2610.26081）：https://arxiv.org/abs/2610.26081 ／ 项目页 https://yahooo-m.github.io/DVTE-Bench/
- SVOR（小米，CVPR 2026，Apache-2.0）：https://github.com/xiaomi-research/svor ／ 论文 https://arxiv.org/abs/2603.09283
- DiffuEraser（Apache-2.0）：https://github.com/lixiaowen-xw/DiffuEraser
- MiniMax-Remover（权重 CC-BY-NC-4.0）：https://github.com/zibojia/MiniMax-Remover ／ https://minimax-remover.github.io/
- ProPainter（S-Lab 1.0，非商用）：https://github.com/sczhou/ProPainter
- video-subtitle-remover（13.9k★，Apache-2.0）：https://github.com/YaoFANGUK/video-subtitle-remover
- VACE（Apache-2.0）：https://github.com/ali-vilab/VACE
- WaveSpeed Video Eraser（$0.02/秒）：https://wavespeed.ai/docs/docs-api/wavespeed-ai/video-eraser
- fal VOID Video Inpainting（$0.05/条）：https://fal.ai/models/fal-ai/void-video-inpainting
- Replicate ProPainter（约 $0.029/次）：https://replicate.com/jd7h/propainter
- Vmake 定价：https://vmake.ai/pricing
- RunPod GPU 价格：https://www.runpod.io/pricing
- 小云雀擦字幕 CLI（本工作区技能）：`~/.agents/skills/xyq-skill/commands/erase-video-subtitle.md`
