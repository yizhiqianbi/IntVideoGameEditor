/** Source disclosure for the SillyTavern-compatible engine (AGPL-3.0). */
export const TAVERN_ENGINE_SOURCE_TEXT = `# 叙梦 · 角色引擎开源声明

叙梦的角色卡、世界书、提示词拼装、采样参数、群聊、分支版本、
生图预设与记忆配置，行为对齐 SillyTavern（酒馆）的公开规格。

## 许可与源码

本引擎按 GNU Affero General Public License v3.0（AGPL-3.0）发布。
作为网络服务运行，我们在此提供对应源代码，包含我们的修改与新增实现：

- 源码仓库：https://github.com/yizhiqianbi/IntVideoGameEditor
  （目录：src/lib/tavern/ 与 shared 集成点）
- 引擎入口：src/lib/tavern/{card,worldbook,macros,prompt,sampler,group,memory,image,flags}.ts
- AGPL-3.0 全文：https://www.gnu.org/licenses/agpl-3.0.txt

## 上游与致谢

SillyTavern 是一个独立开源项目：https://github.com/SillyTavern/SillyTavern
本仓库未复制其源代码，而是按其公开文档与数据格式（角色卡 v2/v3、
世界书条目、提示词管理器顺序、采样档、群聊与分支语义）独立实现。
“酒馆 / SillyTavern”指向上游项目，不代表上游对本服务的认可。

## 其他

- 本站的账号、计费、审核、视频内容和前端界面不属于该引擎。
- 引擎不执行第三方卡片的脚本或插件；世界书"正则关键词"受长度与扫描上限保护。
- 需要源码或存在许可疑问请联系站点运营者。
`;
