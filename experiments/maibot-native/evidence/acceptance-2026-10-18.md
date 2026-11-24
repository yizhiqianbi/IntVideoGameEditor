# 原生 MaiBot 接入验收 · 2026-10-18

入口：http://127.0.0.1:3010/xumeng/girlfriend

## 已实际运行

MaiBot 1.3.9，固定官方提交 ac6ed61b7b9c971ad94921de3b16fa6f63c36a20，加一处公开记录的 A_Memorix JSON 元数据兼容补丁。用户于本轮明确接受官方 EULA / 隐私条款后启动。官方 Runner、Worker、HeartFlow/MaiSaka 认知链、内置 A_Memorix 和两个独立插件 Runtime 均实际运行。核心插件加载 builtin.plugin-management；扩展插件运行进程正常，目前没有另外安装社区插件。

模型：OpenRouter deepseek/deepseek-v4.1-flash；文本向量：qwen/qwen3-embedding-8b / 4096 维。网页和网关只收发消息，自写 character-chat AI 引擎不在活动调用链。旧资料保留归档；旧3227入口会跳到新女友页。

## 真实聊天与界面

浏览器真实会话累计 11 条用户消息、27 条角色消息，覆盖问候、撒娇、夸奖、分段补充、换题、情绪修复、重启后承接与要求自主选话题。记录见 browser-native-final.json，截图 native-girlfriend-live.jpg。

已验证：连续发送不等待生成；原生 steering 能跟随补充的换题；原生分条发送；重启恢复聊天历史；用户输入回执/待发送草稿持久化；原生引用 ReplyComponent 与正文分离，不再把被引用用户消息显示成新台词。模型真的重复说的话不会被网关过滤。

真实例子：用户回来问“三秒钟的生气结束了没”，原生回复“早结束啦，都过去快一小时了才来问”“你掐着表的啊”“忙完了？”。这来自真实模型和真实时间间隔。

没有掩盖的失败：连续改口一轮出现突兀的“不晓得”；角色已经说了牛肉面，后来仍让用户猜吃的什么面；用户指出重复后仍换成另一个猜题。记录的静默窗口没有产生新主动话题。因此本次通过的是完整原生系统接入，不能宣称聊天质量或主动性已完全解决。

## 原生记忆

memory-runtime-2026-10-18.json：A_Memorix kernel、metadata、sparse、graph、vector_read/write、embedding 都可用，hybrid，非降级；原生 embedding 请求成功且4096维匹配。

合成测试事实由真实聊天触发原生 memory_flow_service 写入 SQLite，包含原生消息来源。重启前发现原生按聊天范围查询漏掉 JSON 元数据事实；记录、最小补丁和回归测试见 patches/。

memory-postrestart-scope-2026-10-18.json：优雅重启后，本聊天检索到合成偏好，另一个真实聊天未检索到此偏好。此测试不是多租户安全审计；当前仍为本机单使用者实例。

memory-postrestart-native-tools-2026-10-18.json：真实 query_memory 工具成功召回“桂花乌龙，不加糖”，随后 Planner→reply_reference→Replyer→网页实际返回“桂花乌龙不加糖，我都快背下来了”。不是用仍在短上下文里的事实冒充长期记忆。

未证明项：本次尚无 episode 自动生成证据；同义事实已有重复存储版本，去重质量仍待评估。图片向量与语音模型未配置，关系向量化保持官方默认关闭。

## 工程检查

- 原生记忆范围兼容补丁及相关官方测试：48项通过。
- 新网关协议/收件/重复文本/重连/引用呈现：19项通过。
- Next桥接归属、路由、单实例所有者：4项通过。
- 定向 ESLint 和项目 TypeScript 检查通过。

测试通过不替代上面的真实聊天记录。原生实例仍在本机运行，日志与密钥都留在 ignored 私有 instance 目录，未部署远程服务。
