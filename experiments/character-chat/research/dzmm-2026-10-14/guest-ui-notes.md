# DZMM 游客实测：普通 AI 消息诊断入口定位

> 最新官方诊断核验（2026-10-14）：现已通过自有未上架测试卡取得 2649 字符的平台 system、完整四条组装输入及 5 份生成参数/token 记录。分词复验明显支持 DeepSeek 系计数特征，但实际型号与 provider 仍隐藏。下文为此前阶段记录；最新结论见 [官方诊断实测报告](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/verified-runtime-2026-10-14/results.md)。

> 后续实测更新（2026-10-14）：浏览器控制已恢复，已取得真实生成和提取候选；下文的“未生成/超时”是此前阶段记录。诊断权限中的 owner 已纠正为角色卡作者/所有者。详见 [本轮实验记录](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-extraction-2026-10-14/results.md) 与 [权限核验](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-extraction-2026-10-14/diagnostics-access-gate.md)。

2026-10-14，Asia/Shanghai。本文件只读新增下载的公开 JavaScript；未操作浏览器，未读取 cookie、用户会话或聊天数据，未调用任何端点。新增的 **第 10 个精选文件**是 https://www.dzmm.ai/assets/1OYk4JId.js ，先完成手工静态检查，随后已单独提交 REA，证据与摘要保存为 rea-guest-evidence.json / rea-guest-summary.json。旧 extracts.json 保持不变；root 已将新增源与分析汇总到 evidence-index.json。

## 最短定位清单

1. 使用刚生成、未编辑的普通 AI 回复。代码要求 `role === assistant`、有 `generationId`，且没有 `editedFromGenerationId`；开场消息或编辑后的消息可能没有诊断动作。
2. 正文使用 `mode: context` 菜单组件。菜单中文动作是 **世界书诊断** 和 **查看组装上下文**。具体右键/长按手势由共享菜单组件负责，本文件只直接证明 context 模式。
3. 桌面消息下方也有同名图标按钮，`aria-label` 与 tooltip 均是上述中文。工具栏定位属性为 `[data-message-actions]`、`[data-desktop-message-actions]`，默认不可见、透明；符合条件时随消息组悬停显示。可先把鼠标移到刚生成回复，再找对应按钮。
4. **查看组装上下文**打开的弹窗实际标题为 **Prompt Assembly 调试**；选择 **元数据**查看模型/配置，另外两页是 **最终输入**与**原始输入**。这些标题与字段已在旧 Dm7/中文资源里核验，本文件证实触发动作和状态链接。
5. **世界书诊断**打开条目诊断。旧客户端中的期限是 24 小时，权限视图可为“仅汇总”，不保证能看到条目内容。

## 权限门控

`hi(chatId, generationId)` 读取 profile 的 `canViewDebug` 与当前角色卡来源元数据的 `userId`。客户端把以下任意条件视作可以显示世界书诊断：profile.canViewDebug 为 true，或角色卡 userId 等于 profile.id 且两者存在。**没有单独以 guest 身份排除的代码**；这不等于服务器已保证所有游客都有权限，仍需实际账号/会话值和后台响应。

组装诊断更严格：有 profile.canViewDebug 可直接显示；角色卡作者/所有者还要 chatId/generationId 均存在，并通过 access 探测返回 true。探测请求传 `{chatId, generationIds}` 给 `/api/chat/assembly`，根据响应 `viewable` 是否包含该 ID 决定。此处记录的是代码声明，本次未发起探测。

探测按 chatId 分组、每批最多 100 个 generationIds；阴性结果允许每 10 秒有限重试（dataUpdateCount < 4）。这解释了“刚回复完暂时没有组装按钮”的一种代码路径，但实际原因仍需界面核验，不能当作已复现。

内部消息会提前进入另一条菜单分支，不包含这些普通诊断动作。普通 AI 回复如果是编辑结果，也不会复用旧生成的诊断。

## 新增文件还直接确认的请求结构

之前只有念白 SDK `/api/chat` 默认值，无法证明普通角色请求。新增普通角色共享文件现在有独立实际调用：`ca` 发 `POST /api/chat`，JSON body 为 input；`ua` 订阅 `/api/chat/{chatId}/stream/{streamId}`，并专门处理 401/403、204。这里只确认静态声明，没有实际调用或确认运行状态。

请求构建中的 chatSettings 包含 model、style、maxTokens、randomIndex、deepThinking、enableMemoryEnhance，schema 还允许 assemblyMode；旁边有 presetConfig、prompts 等字段。它们是客户端输入/配置契约，不能据此获得后台固定 system prompt 或供应商底模映射。新文件没有一份 temperature/top_p 的固定普通角色默认值。

模型配置的可见入口是 **查看组装上下文 → 元数据**。实际生成记录里的顶层 model 与 config/generationConfig 要按各自层级读取；当前客户端模型目录的显示名/内部名并不能证明上游供应商身份。

## 原始短段

下列偏移为 UTF-8 零基字节、一基行号；短段来自同一公开文件。每个 span 已按保存文件字节复核，未执行目标代码。

### 消息诊断 ID 条件

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 58245，短段 span [58220, 58490)。

```javascript
ng:P}=st(e),F=t.__branch,I=t.role===`assistant`&&!t.editedFromGenerationId?t.generationId:void 0,{canViewDebug:L,canViewPromptAssemblyDebug:z}=hi(e,I==null?null:I),{rating:B,toggleUp:ee,toggleDown:ne}=Ea(e,t),re=R(`chat.reply-feedback`),ie=R(`chat.edit-follow-up-guidanc
```

### context 菜单动作

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 60383，短段 span [60358, 60822)。

```javascript
),t.role===`assistant`&&(I&&L&&c.push({key:`lorebook-debug`,label:`世界书诊断`,icon:(0,Q.jsx)(d,{className:`size-4`}),onClick:()=>{j({chatId:e,generationId:I})}}),I&&z&&c.push({key:`assembly-debug`,label:`查看组装上下文`,icon:(0,Q.jsx)(r,{className:`size-4`}),onClick:()=>{M({chatId:e,generationId:I})}}),o||c.push({key:`audio`,label:f(O?`chat.toolbar.stopPlaying`:`chat.toolbar.playVoice`),icon:S?(0,Q.jsx)(Ge,{size:16}):O?(0,Q.jsx)(l,{className:`size
```

### 正文绑定 context 菜单

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 94378，短段 span [94353, 94788)。

```javascript
ge:t,index:n,first:r})=>{let{items:i,renderBranchNav:a}=Da({chatId:e,message:t,index:n,first:r});return(0,Q.jsx)($e,{mode:`context`,items:i,renderHeader:a?()=>a():void 0,children:(0,Q.jsx)(`div`,{className:`select-none`,children:t.role===`user`&&t.recording?(0,Q.jsx)(ho,{chatId:e,sourceId:vt(t.__chunk,t.__index),recording:t.recording,transcript:t.content}):(0,Q.jsx)(Do,{raw:Eo(t),role:t.role})})})};function Eo(e){return e.role===`a
```

### 桌面工具栏显示条件

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 64129，短段 span [64104, 64704)。

```javascript
hat.aiSuggest.open`)]})},Na=({branchNavigation:e,desktopActions:t,revealDesktop:n})=>{let r=!!e;return!r&&t.length===0?null:(0,Q.jsxs)(`div`,{"data-message-actions":!0,className:M(`w-fit items-center gap-1 rounded-md bg-background/70 px-1 py-0.5 text-muted-foreground backdrop-blur-sm transition-opacity duration-200`,r?`flex`:`hidden`,`sm:invisible sm:flex sm:opacity-0`,n&&`sm:group-hover:visible sm:group-hover:opacity-100`),children:[e,t.length>0&&(0,Q.jsx)(`div`,{"data-desktop-message-actions":!0,className:`hidden sm:contents`,children:t})]})},$=({onClick:e,tooltip:t,icon:n,disabled:r,loading
```

### 图标无障碍标签

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 64877，短段 span [64852, 65087)。

```javascript
ed:r||i,"aria-pressed":a,"aria-label":t,className:M(`size-6 hover:text-current`,a&&`text-primary`)}),children:i?(0,Q.jsx)(Ge,{size:12}):(0,Q.jsx)(n,{className:`!size-3.5`,strokeWidth:2.1,fill:a?`currentColor`:`none`})}),(0,Q.jsx)(b,{cl
```

### 桌面诊断动作

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 66041，短段 span [66016, 66465)。

```javascript
age:t},`feedback`),T(w)),_&&y&&T((0,Q.jsx)($,{onClick:()=>g({chatId:e,generationId:_}),tooltip:`查看组装上下文`,icon:r},`assembly-debug`)),_&&v&&T((0,Q.jsx)($,{onClick:()=>h({chatId:e,generationId:_}),tooltip:`世界书诊断`,icon:d},`lorebook-debug`)),t.role===`assistant`&&(m||T((0,Q.jsx)(Ba,{message:t,chatId:e},`audio`)),T((0,Q.jsx)(Va,{message:t,chatId:e},`generate-image`))));let E=i&&t.role===`assistant`&&!a&&o;return(0,Q.jsxs)(`div`
```

### 权限函数

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 15；UTF-8 byte 33715，短段 span [33690, 34325)。

```javascript
di,0))})}var pi=1e4,mi=4;function hi(e,t){let{data:n}=Ie(),r=V(W),i=(n==null?void 0:n.canViewDebug)===!0,a=!!(r!=null&&r.userId)&&!!(n!=null&&n.id)&&r.userId===n.id,o=i||a,s=!i&&a&&!!e&&!!t,{data:c}=Je({queryKey:[`prompt-assembly-access`,e,t],queryFn:()=>fi(e,t),enabled:s,staleTime:1/0,refetchInterval:e=>e.state.data===!1&&e.state.dataUpdateCount<mi?pi:!1});return{canViewDebug:o,canViewPromptAssemblyDebug:i||s&&c===!0}}function gi(e){let t=Ze(),n=Be(),r=Ke(),i=At(e),a=H(_t),o=H(yt),s=H(Mt),c=H(Xe),l=V(_t),{mutateAsync:u}=je(n.chat.generateTTS.mutationOptions());return{playOrGenerate:(0,Y.useCallback)(async({chunk:d,index:f,auto
```

### 组装可见性探测

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 15；UTF-8 byte 33049，短段 span [33024, 33659)。

```javascript
,si=100,ci=new Map,li=!1;async function ui(e,t,n){try{let i=await ge(`/api/chat/assembly`,{chatId:e,generationIds:t}),a=new Set(Array.isArray(i==null?void 0:i.viewable)?i.viewable:[]);for(let e of t){var r;for(let t of(r=n.get(e))==null?[]:r)t.resolve(a.has(e))}}catch(e){for(let r of t){var i;for(let t of(i=n.get(r))==null?[]:i)t.reject(e)}}}function di(){li=!1;let e=[...ci];ci.clear();for(let[t,n]of e){let e=[...n.keys()];for(let r=0;r<e.length;r+=si)ui(t,e.slice(r,r+si),n)}}function fi(e,t){return new Promise((n,r)=>{var i;let a=ci.get(e);a||(a=new Map,ci.set(e,a));let o=(i=a.get(t))==null?[]:i;o.push({resolve:n,reject:r}),a.
```

### 实际普通角色生成 POST

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 18；UTF-8 byte 43465，短段 span [43440, 43835)。

```javascript
enerationRequestError`}};async function ca(e){let{input:t,signal:n,callbacks:r}=e,i=await aa(`/api/chat`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(t)},n,async e=>{if(!e.ok){let t=await la(e);throw new sa(e.status,t)}});if(!i.body)throw new sa(0,`No response body`);let a=``;try{return await pa(i.body,{...r,onInit(e){var t;a=e,(t=r.onInit)==null||t.call(r,e)
```

### 普通角色流订阅

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 18；UTF-8 byte 44578，短段 span [44553, 45003)。

```javascript
e(0,500)}catch{return r}}async function ua(e){let{chatId:t,streamId:n,signal:r,initialContent:i,callbacks:a,hideSugTail:o,hideStatusTail:s}=e,c=await aa(`/api/chat/${encodeURIComponent(t)}/stream/${encodeURIComponent(n)}`,{},r,async e=>{if(e.status===204)throw new $i;if(!e.ok)throw e.status===401||e.status===403?new oa(e.status):Error(`Stream request failed: ${e.status}`)});if(!c.body)throw new $i;return da(c.body,i,a,o===!0,s===!0)}async functio
```

### 请求设置

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 17；UTF-8 byte 37782，短段 span [37757, 38527)。

```javascript
:(a=t.cardId)==null?``:a,chatSettings:{model:t.model,style:t.style,maxTokens:t.maxTokens,randomIndex:t.randomIndex,deepThinking:(o=t.deepThinking)==null?void 0:o,enableMemoryEnhance:(s=t.enableMemoryEnhance)==null?void 0:s,voiceSettings:{ignore_parentheses:(c=t.voiceIgnoreParentheses)==null?void 0:c,only_quotes:(l=t.voiceOnlyQuotes)==null?void 0:l,ignore_english:(u=t.voiceIgnoreEnglish)==null?void 0:u,read_asterisks:(d=t.voiceReadAsterisks)==null?void 0:d}},presetConfig:m,prompts:n,...i!=null&&i.chunkedHistory?{chunkedHistory:!0}:{},supportsSuggestions:typeof window<`u`&&localStorage.getItem(`chat_auto_suggest`)!==`false`,currentStatus:Si()?r:void 0}}var Mi=q({path:K().min(1),durationMs:De().int().positive(),waveform:He(De().min(0).max(1))}),Ni=Te([K(),He(Te([
```

### 状态与权限导出

来源：https://www.dzmm.ai/assets/1OYk4JId.js；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；UTF-8 byte 95807，短段 span [95782, 96166)。

```javascript
children:e},t))})]})]})};export{xi as A,Qr as B,Hi as C,Oi as D,ji as E,yi as F,Z as H,gi as I,hi as L,_i as M,Ci as N,Di as O,vi as P,ai as R,Ui as S,Mi as T,mr as U,Hr as V,cr as W,oa as _,So as a,ua as b,qa as c,ka as d,wa as f,$i as g,va as h,go as i,bi as j,Ei as k,Ga as l,ya as m,vo as n,ao as o,Sa as p,_o as r,to as s,mo as t,Ka as u,ta as v,Vi as w,ha as x,ea as y,ri as z};
```
