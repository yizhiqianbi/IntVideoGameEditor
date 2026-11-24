# Prompt 工程续查：风格、状态协议与模型目录

2026-10-14，Asia/Shanghai。仅分析已保存的官方公开 JavaScript，不执行目标代码，不调用网络/API/浏览器，不读用户会话。旧证据和报告保持原样。本轮新增读取的 5 个依赖为 DQpo-2Vv、Du6L78y2、DGlS3pRw2、Cyr5iadJ、B2vKkOtb2；新的独立 REA 记录另行保存。

## 一、本轮实际拿到的公开指令内容

Cyr5iadJ 的**默认状态字段**包含可编辑自然语言 hint：

- 好感度 favor：meter，范围 0–100，初值 20；hint 原文为「按本轮剧情在当前值基础上合理增减，单轮变化不超过 10」。
- 关系阶段 stage：text，初值「陌生」；hint 规定按好感度分为低于 30、30–59、60–84、85 以上四档，分别对应陌生、熟人、暧昧、恋人。
- 其他默认字段为时间、地点、心情、背包；初值分别是未知、未知、平静、空列表。

这是新的**公开字段提示原文**，并非完整平台 system prompt。角色编辑器将配置保存为 `extensions.status_template`，另将作者推荐模型保存为 `extensions.recommended_model`。服务器是否及怎样把这些 hint 注入生成指令，本轮仍没有原始最终输入可验证。

### 要区分提示约束和程序约束

状态重建函数 A(template, messages) 先按字段 initial 建立初值，再按顺序应用 assistant 消息的 statusSnapshot.values。未知字段被忽略，类型不符被忽略，数值被 clamp 到 min/max。

这里**没有**实现每轮增减最多 10，也没有根据 favor 在程序中自动重新计算 stage。两项属于上述 hint 的预期，不是客户端已强制的算法。状态保留是快照应用机制，不能等同长期语义记忆或真实关系自然发展。

状态 schema 是 v:1 + values；字段类型 text/number/meter/list；模板包括 status_bar、relationship、inventory、options，最多 32 个字段，建议选项 2–4 条。名为 maxSnapshotBytes 的常量是 16384；快照校验实际使用 JSON.stringify(values).length，不能直接当作已验证的 UTF-8 16 KiB 上限。

## 二、风格目录：灵动(抗复读) 是一个真实选项

普通角色设置的代码值与中文显示名：

| 值 | 显示名 | 可确认的客户端行为 |
|---|---|---|
| standard | 标准 | 设置传 `{style:值}` |
| creative | 创意 | 同上 |
| divergent | 发散 | 同上 |
| apex_dry | 灵动(抗复读) | 仅 x-apex-sigma-0417 及其 -数字k 后缀且非体验锁定时加入选项 |

不应凭 dry 这个词把选项说成「低温」。公开文案实际称它「灵动(抗复读)」。已看到风格代码被发送，但没有 temperature/top_p 对照表，也没有公开反复读私有指令原文。

## 三、生成文本有尾段协议，前端负责消费和隐藏

1OY 的 SSE 消费逻辑处理 init、token、step、compaction、complete、error。token.data 是增量，先追加到原始累计内容，再为显示调用剥离函数：supportsSuggestions 开启时隐藏 sug 协议；请求具有 currentStatus 时隐藏 status/options 协议及流中不完整标签。这是客户端呈现处理，不是另一次模型推理。

解析器识别 sug、status、options 的尾部结构，并容忍部分不规则标签/标点；尾部协议解析有长度和数量限制，识别代码围栏，避免把任意正文都当协议删掉。还兼容旧的 `【Statusbar】<Content>...</Content>` 字段展示格式。

正文 Do() 会尝试抽取末尾 sug/管道分隔候选，剩余 narrative 保留给 markdown 渲染；识别到的候选单独显示为「剧情选项」。因此**隐藏控制尾段不等于只输出台词**。公开作者通用模板本来就允许对白和叙述，我们的 chat only 规范仍需独立规定。

Cyr5iadJ 提供 schema、默认字段/hint、快照重建；没有 prompt/instructions 字面量，也没有把状态协议串成完整生成指令的 builder。现在拿到的是字段提示与输出消费契约，完整状态生成 prompt 仍在服务端未知环节。

## 四、普通模型选择器的动态目录与 fallback

DGlS3pRw2 是普通模型选择器真正使用的 hook。它查询：

```javascript
chat.models.queryOptions({service:`chat`},{staleTime:300*1e3})
```

返回目录有 categories、unsupportedLanguages、defaultModel；group 有 thinkingSupported、forceThinking、isApex；contexts 有 internalName、displayName、maxContext 等。另一个 `chat.getQuotas` 是用户额度查询，本轮没有调用。

API 的 defaultModel 优先；没有目录返回值时使用 B2v 导出的 fallback `x-apex-surge-0923-b-16k`。B2v 还导出 `nalang-xl-0826-16k` 和 22 项旧 nalang 显示/介绍配置。旧目录不意味着这些选项现在都开放，也不证明上游底模。DGl 的 currentModelName 优先用动态 context.displayName，再用静态显示 fallback。

hook 还有 needsModelFix：当前名称不在动态目录、API 默认名称在目录时标记需要修正。它证明目录合法性检查，不证明页面实际已经替某一用户改了模型。

DQpo 只对 UUID chatId 查询 chat.getSettings、缓存 5 分钟。Du6 从 chat.getMessages 的 chunkInfos/chunks 重建、展开当前可见消息，并支持 branch switch。两者补齐了之前缺失的字段来源；这些是会话/分支管理，不是后台记忆稀疏化算法。

## 五、开场和 few-shot 的可见边界

编辑器 legacy 导入会保留多套 chat_history 的 role/content，或将 first_mes 映射成单条 assistant 开场，再把 alternate_greetings 各自映射成独立开场。作者指南建议多种情境和不同反应，创建请求接受 fixedRandomIndex。

但本轮没有查到服务器如何把所选开场与示范组合进最终 prompt。不能说所有开场会一次性成为 few-shot，也不能把编辑器转换当成 SFT/微调或偏好训练。此转换段未含 mes_example 名字，不等于全产品任何入口都不支持该字段。

## 本轮范围与边界

已下载其他脚本中的 prompt/summary/memory 命中也做了归属检查：例如媒体播放器的 remote.prompt 是投屏选择器，广告卡 summary 是展示摘要，念白入口 memory 是介绍卡文案；它们不构成普通角色默认 prompt 或记忆算法证据。

已确证四类材料要分开：公开作者写作模板；公开状态字段 hint；客户端请求/输出契约；平台私有默认身份规则/内容指南。前 3 类有源码，最后一类仍未取得。本轮没有猜测 source map、未声明私有地址或生成 ID，没有把模型别名映射为某个上游模型。

## 来源与短段

短段均来自官方公开脚本，保留了原始解码换行。位置为 UTF-8 零基 byte、一基 line；每个 span 按保存字节复核。不是运行证据。

### 公开状态字段默认提示

[Cyr5iadJ.js](https://www.dzmm.ai/assets/Cyr5iadJ.js)；SHA-256 `bde0aab8582040dca19ae97880eb8d41979f750fdf3dbd345d9417c98706af00`；line 1；byte 3377，span [3357, 4345)。

```javascript
`,path:[`values`]}),T={status_bar:[{key:`time`,template:`status_bar`,label:`时间`,type:`text`,initial:`未知`},{key:`location`,template:`status_bar`,label:`地点`,type:`text`,initial:`未知`},{key:`mood`,template:`status_bar`,label:`心情`,type:`text`,initial:`平静`}],relationship:[{key:`favor`,template:`relationship`,label:`好感度`,type:`meter`,min:0,max:100,initial:20,hint:`按本轮剧情在当前值基础上合理增减，单轮变化不超过 10`},{key:`stage`,template:`relationship`,label:`关系阶段`,type:`text`,initial:`陌生`,hint:`按好感度自动：低于 30 陌生，30~59 熟人，60~84 暧昧，85 以上恋人`}],inventory:[{key:`inventory`,template:`inventory`,label:`背包`,type:`list`,initial:[]}]};function E(e){let t=2;for(let n of e)switch(t+=n.key.length+4,n.type){case`text`:t+=f.maxTextChars*2+2;break;case`number`:case`meter`:t+=24;break;case`list`:t+=2+f.maxListItems*(f.maxListItemChars*2+3);break}return t}function D(e,t){switch(t){case`
```

### 状态schema与限制

[Cyr5iadJ.js](https://www.dzmm.ai/assets/Cyr5iadJ.js)；SHA-256 `bde0aab8582040dca19ae97880eb8d41979f750fdf3dbd345d9417c98706af00`；line 1；byte 932，span [912, 1292)。

```javascript
z][a-z0-9_]{0,31}$/,f={maxFields:32,maxLabelChars:20,maxHintChars:80,maxTextChars:200,maxListItems:16,maxListItemChars:60,maxSnapshotBytes:16384,minOptions:2,maxOptions:4,maxOptionChars:60,maxPanels:6,maxPanelTitleChars:12,maxOptionHintChars:120},p=[`status_bar`,`relationship`,`inventory`],m=n([`text`,`number`,`meter`,`list`]),h=s().regex(d),g=/^[^\u0000-\u001F\u007F]*$/,_=s().
```

### 快照重建与数值约束

[Cyr5iadJ.js](https://www.dzmm.ai/assets/Cyr5iadJ.js)；SHA-256 `bde0aab8582040dca19ae97880eb8d41979f750fdf3dbd345d9417c98706af00`；line 1；byte 4839，span [4819, 5330)。

```javascript
=[];break}}return t}function A(e,t){let n=new Map(e.fields.map(e=>[e.key,e])),r=k(e);for(let e of t)if(!(e.role!==`assistant`||!e.statusSnapshot))for(let[t,i]of Object.entries(e.statusSnapshot.values)){let e=n.get(t);if(!e)continue;let a=j(e,i);a!==void 0&&(r[t]=a)}return{v:1,values:r}}function j(e,t){if(D(t,e.type)){if(typeof t==`number`){let{min:n,max:r}=O(e),i=t;return n!==void 0&&(i=Math.max(n,i)),r!==void 0&&(i=Math.min(r,i)),i}return t}}export{u as a,C as c,f as i,p as n,O as o,T as r,w as s,A as t};
```

### 快照长度校验

[Cyr5iadJ.js](https://www.dzmm.ai/assets/Cyr5iadJ.js)；SHA-256 `bde0aab8582040dca19ae97880eb8d41979f750fdf3dbd345d9417c98706af00`；line 1；byte 3142，span [3122, 3480)。

```javascript
a,`template`]})})}),w=l({v:t(1),values:a(h,y)}).refine(e=>Object.keys(e.values).length<=f.maxFields,{message:`too many fields`,path:[`values`]}).refine(e=>JSON.stringify(e.values).length<=f.maxSnapshotBytes,{message:`snapshot too large`,path:[`values`]}),T={status_bar:[{key:`time`,template:`status_bar`,label:`时间`,type:`text`,initial:`未知`},{key:`loc
```

### 保存作者status_template

[CT6ZjuS1.js](https://www.dzmm.ai/assets/CT6ZjuS1.js)；SHA-256 `815b298adf38ec7d37361ddc4cf25ed1d3564d03db24edf366365adf570cd641`；line 1；byte 27110，span [27090, 27410)。

```javascript
&!Pn(n.declaration)?r.status_template=n.declaration:delete r.status_template),n.model!==void 0&&(n.model?r.recommended_model=n.model:delete r.recommended_model),t(r)},[e,t]),o=(0,K.useCallback)((e,t)=>{let i=n==null?An:n;if(i.templates.includes(e)){a({declaration:{...i,templates:i.templates.filter(t=>t!==e),fields:i.fi
```

### style枚举与模型条件

[Dm7jYsLH.js](https://www.dzmm.ai/assets/Dm7jYsLH.js)；SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`；line 33；byte 122748，span [122728, 123268)。

```javascript
arInterval(e)},[h]);let T=((n=e.trialExperiment)==null?void 0:n.modelLocked)!==!0&&Io(e.model),E=e.style===`apex_dry`&&!T?`standard`:e.style,D=((r=f.membershipLevel)==null?0:r)>=2,O={standard:c(`chat.sidebar.styleOptions.standard`),creative:c(`chat.sidebar.styleOptions.creative`),divergent:c(`chat.sidebar.styleOptions.divergent`),...T?{[No]:c(`chat.sidebar.styleOptions.apexDry`)}:{}};(0,Q.useEffect)(()=>{var t;let n=String((t=e.maxTokens)==null?y:t);w.current=n,x(n)},[e.maxTokens,y]);let k=t=>{let n=wi(Number.parseInt(t),d==null?void 
```

### style更新调用

[Dm7jYsLH.js](https://www.dzmm.ai/assets/Dm7jYsLH.js)；SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`；line 33；byte 125125，span [125105, 125685)。

```javascript
{value:E,disabled:u,onValueChange:e=>l({style:e}),items:O,children:[(0,$.jsx)(be,{className:`w-[120px]`,children:(0,$.jsx)(Se,{})}),(0,$.jsxs)(ye,{children:[(0,$.jsx)(R,{value:`standard`,children:c(`chat.sidebar.styleOptions.standard`)}),(0,$.jsx)(R,{value:`creative`,children:c(`chat.sidebar.styleOptions.creative`)}),(0,$.jsx)(R,{value:`divergent`,children:c(`chat.sidebar.styleOptions.divergent`)}),T&&(0,$.jsx)(R,{value:`apex_dry`,children:c(`chat.sidebar.styleOptions.apexDry`)})]})]})]}),(0,$.jsxs)(Z,{orientation:`horizontal`,children:[(0,$.jsxs)(Y,{children:[(0,$.jsx)(J,{
```

### 风格中文文案

[D58JO2kB2.js](https://www.dzmm.ai/assets/D58JO2kB2.js)；SHA-256 `5e6e69940d27153452b512955969699710d2097fd785424a42030ad9fb8c52d1`；line 1；byte 6760，span [6722, 6999)。

```javascript
Desc":"调整AI回复的创意程度","styleOptions":{"standard":"标准","creative":"创意","divergent":"发散","apexDry":"灵动(抗复读)"},"voiceActor":"声优","voiceSettings":"语音设置","autoGenerateVoice":"自动生成语音","autoGenerateVoiceDesc":"默认关闭
```

### SSE与显示剥离

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 19；byte 45564，span [45544, 46299)。

```javascript
row new $i;return l}function fa(e,t,n,r,i){if(!e.startsWith(`data: `))return null;let a;try{a=JSON.parse(e.slice(6))}catch{return null}switch(a.type){case`init`:return{init:a.data.generationId};case`token`:{let e=t+a.data,o=e;return r&&(o=Qi(o)),i&&(o=Xi(o)),n.onToken(o),{content:e}}case`step`:var o;return n.onStep((o=a.data.content)==null?t:o,a.data.step),null;case`compaction`:var s;return(s=n.onCompaction)==null||s.call(n,a.data),null;case`complete`:return{complete:a.data};case`error`:return n.onError(a.data),`error`}}async function pa(e,t,n=!1,r=!1){let i=e.getReader(),a=new TextDecoder,o=``,s=``,c=``,l=null;try{for(;;){let{done:e,value:d}=await ra(i);if(e)break;o+=a.decode(d,{stream:!0});let f=o.split(`
`);o=f.pop()||``;for(let e of f){let i
```

### 协议解析入口

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 2；byte 5365，span [5321, 5950)。

```javascript
，。！？、,.!?…“”"「」『』]/;function Pn(e,t={}){if(e.length>Ut||!Ht.test(e))return[];let n=t.anyStatusBody===!0,r={streaming:t.streaming===!0,anyStatusBody:n,lenientStart:n?qn(e):-1,lenientBlocks:new Set,statusBudget:Wt,tags:null,fences:null},i=zn(e,r),a=[],o=0,s=!1;for(let e=i.length-1;e>=0;e--){let t=i[e];if(t.kind===`prose`||t.kind===`panel`&&++o>Kt||((t.kind===`panel`||t.kind===`container`||t.kind===`pending`)&&(s=!0),t.block&&r.lenientBlocks.has(t.block)&&s))break;t.block&&a.push(t.block)}return a.reverse().filter(t=>!t.irregular||e.slice(0,t.start).trim().length>0)}function Fn(e,t){if(t.length===0||t
```

### 协议显示清理

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 11；byte 13457，span [13437, 13961)。

```javascript
`\r`);)n++;return n}function ar(e){return sr(e,e=>!(e.kind===`sug`&&e.tagless&&!e.pipeTagged))}var or=`[<＜〈《][ \\t]*\\/[ \\t]*n?sug[ \\t]*[>＞〉》]`;RegExp(`${or}|<\\/s>`,`i`),RegExp(`(^|\\n)([^\\n]*?)${or}[ \\t|｜"”'」』*_]*(?=\\n|$)`,`gi`),RegExp(`[ \\t]*${or}`,`gi`);function sr(e,t){let n=In(Fn(e,Pn(e).filter(t)));return n.trim().length>0?n:e}var Y=e(t()),cr=D(typeof window<`u`?localStorage.getItem(`chat_enable_highlight`)!==`false`:!0),lr=A(e=>D(null)),ur=/【\s*Statusbar\s*】/gi,dr=/^(?:(?:\s+|\/\s*
```

### 正文与剧情选项

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；byte 94826，span [94806, 95918)。

```javascript
tent):e.content}var Do=({raw:e,role:t=`user`,isStreaming:n=!1})=>{var r,i,a,o;let s=V(W),c=((r=Ie().data)==null?void 0:r.fullName)||`你`,l=V(cr),u=V(ae(`chatClassicUi`)),{t:d}=J(),f=t===`assistant`&&!n?gr(e):null,p=(i=f==null?void 0:f.narrative)==null?e:i,m=(a=(o=mr(p))==null?void 0:o.cleanContent)==null?p:a;return(0,Q.jsxs)(Q.Fragment,{children:[(0,Q.jsx)(Y.Suspense,{fallback:(0,Q.jsx)(`p`,{className:`whitespace-pre-wrap break-words`,children:rt(m,s==null?void 0:s.name,c)}),children:(0,Q.jsx)(co,{content:m,cardName:s==null?void 0:s.name,creatorName:c,highlight:l,classicUi:u,isStreaming:n,isGeneralChat:(s==null?void 0:s.isGeneralChat)===!0})}),f&&(0,Q.jsxs)(`aside`,{className:`mt-3 border-t border-border pt-2 text-sm`,children:[(0,Q.jsx)(`div`,{className:`mb-1 font-medium text-muted-foreground`,children:d(`chat.statusPanel.storyOptions`)}),(0,Q.jsx)(`ul`,{className:`list-disc space-y-1 pl-5`,children:f.options.map((e,t)=>(0,Q.jsx)(`li`,{className:`break-words`,children:e},t))})]})]})};export{xi as A,Qr as B,Hi as C,Oi as D,ji as E,yi as F,Z as H,gi as I,hi as L,_i as M,Ci as N,Di as O,vi as P,a
```

### 模型目录与API默认值

[DGlS3pRw2.js](https://www.dzmm.ai/assets/DGlS3pRw2.js)；SHA-256 `7ee1569a41411cdb927e2a1d127122599bbc28c8c7229b9af94aaf76151bff08`；line 1；byte 1103，span [1083, 1598)。

```javascript
rror:x,refetch:S}=r(g.chat.models.queryOptions({service:`chat`},{staleTime:300*1e3})),C=(c=v==null?void 0:v.categories)==null?[]:c,w=(l=v==null?void 0:v.unsupportedLanguages)==null?[]:l,T=(u=v==null?void 0:v.defaultModel)==null?a:u,E=(0,o.useMemo)(()=>[...C,...w.flatMap(e=>e.categories)],[C,w]),D=(0,o.useMemo)(()=>new Set(E.flatMap(e=>e.modelGroups.flatMap(e=>e.contexts.map(e=>e.internalName)))),[E]),O=(0,o.useCallback)(e=>E.flatMap(e=>e.modelGroups).flatMap(e=>e.contexts).find(t=>t.internalName===e),[E]),k=!!
```

### 模型能力返回值

[DGlS3pRw2.js](https://www.dzmm.ai/assets/DGlS3pRw2.js)；SHA-256 `7ee1569a41411cdb927e2a1d127122599bbc28c8c7229b9af94aaf76151bff08`；line 1；byte 2138，span [2118, 2517)。

```javascript
:A,currentContext:j,currentModelThinkingSupported:(p=A==null?void 0:A.thinkingSupported)==null?!1:p,currentModelForceThinking:(m=A==null?void 0:A.forceThinking)==null?!1:m,currentModelIsApex:(h=A==null?void 0:A.isApex)==null?!1:h,categories:C,unsupportedLanguages:w,apiDefaultModel:T,needsModelFix:k,isLoadingModels:y,isRefetchingModels:b,modelsError:x,refetchModels:S,contextFor:O}};export{s as t};
```

### 静态fallback

[B2vKkOtb2.js](https://www.dzmm.ai/assets/B2vKkOtb2.js)；SHA-256 `204713f81c705f020a5ec25a84cbd8d0414018222875666f8395a2253b7877fc`；line 1；byte 740，span [720, 1085)。

```javascript
2f7bc`)}catch{}})();var e=`x-apex-surge-0923-b-16k`,t=`nalang-xl-0826-16k`,n={"nalang-max":{icon:`🔥`,gradient:`from-green-400 to-blue-500`,name:`nalang-max`,description:`智力高，记忆力好，废话少（推荐）`,price:`0.6积分/1K tokens`},"nalang-max-0826":{icon:`🔥`,gradient:`from-green-400 to-blue-500`,name:`Max-0826`,description:`最新Max模型
```

### 会话设置hook

[DQpo-2Vv.js](https://www.dzmm.ai/assets/DQpo-2Vv.js)；SHA-256 `885ae5b5b14dc36fbab8b7e3b518cd885b42386a3d16b8e86d77580f9b0a9d07`；line 1；byte 856，span [836, 1051)。

```javascript
afeParse(e).success;function a(t){return n(e().chat.getSettings.queryOptions({chatId:t==null?``:t},{enabled:i(t),staleTime:1e3*60*5}))}function o(e){return a(e).data}function s(e){let t=o(e);return t!=null&&t.backgr
```

### 分支消息展开

[Du6L78y2.js](https://www.dzmm.ai/assets/Du6L78y2.js)；SHA-256 `89524d1508bbb5d54904447ffa03ac13e909d6026d01d880ef733e82747accdf`；line 1；byte 4451，span [4431, 4921)。

```javascript
:e,chunkMessages:n}}function P(e){let t=M.flattenMessages(e.chunkInfos,t=>e.chunkMessages.get(t)||[]),n=new Map,r=[];for(let e of t){var i;if(e.__branch&&n.set(e.__chunk,e.__branch),e.isGenerationTerminalTombstone===!0)continue;let t=(i=e.__branch)==null?n.get(e.__chunk):i;if(t&&(n.delete(e.__chunk),!e.__branch)){r.push({...e,__branch:t});continue}r.push(e)}return r}function se(e){var t;let n=P(e);return(t=n[n.length-1])==null?void 0:t.__chunk}function ce(e){let t=M.findRoot(e.chunkInf
```

### 开场转换

[CT6ZjuS1.js](https://www.dzmm.ai/assets/CT6ZjuS1.js)；SHA-256 `815b298adf38ec7d37361ddc4cf25ed1d3564d03db24edf366365adf570cd641`；line 1；byte 91639，span [91619, 92041)。

```javascript
tent:e.content}))}):e.data.first_mes&&i.push({id:r(),name:`开场对话`,messages:[{role:`assistant`,content:e.data.first_mes}]}),e.data.alternate_greetings&&e.data.alternate_greetings.length>0&&e.data.alternate_greetings.forEach((e,t)=>{i.push({id:r(),name:`对话 ${t+2}`,messages:[{role:`assistant`,content:e}]})});let a=t?[{url:ve({cardFilename:t}),isHidden:!1,name:t,triggerKeywords:[]}]:[];return{spec:`chara_card_v3
```

### 媒体命中边界

[DmDHELVI.js](https://www.dzmm.ai/assets/DmDHELVI.js)；SHA-256 `7c625e1c18988e7dbf6c979f10bc0f1ed80b85458e75b2cf581bc8036bc4181f`；line 2；byte 56773，span [56753, 57078)。

```javascript
this,is).call(this)}async prompt(){if(!this.supported)throw Error(`Not supported on this platform.`);return this.type===`airplay`&&l(Qo,this).webkitShowPlaybackTargetPicker?l(Qo,this).webkitShowPlaybackTargetPicker():l(Qo,this).remote.prompt()}};function is(){var e;A||!((e=l(Qo,this))!=null&&e.remote)||!this.canPrompt||(l(Q
```

### 广告摘要命中边界

[BStC-x-h.js](https://www.dzmm.ai/assets/BStC-x-h.js)；SHA-256 `785195df2a2d18eab38fb3abfe258856b389b5e690ebd47990693cf0c63a2ad1`；line 1；byte 3626，span [3606, 3776)。

```javascript
path:n})}}var U=n();function W({cover:e,title:t,summary:n,meta:i,showSummary:a,stackedMeta:o}){return(0,U.jsxs)(`div`,{className:r(`flex h-full flex-col overflow-hidden b
```

## 独立 REA 补充

本轮 5 个新依赖已各解析一次，输入目录 rea-followup-input，预算 512 MiB / 20000 ms；未重复前 10 个文件或执行目标代码。Evidence ID `ev_06a09c510199096dc91242dd39daef2b9f10e96665a52443ff7fa5f9f72de611`。5 parsed、31,555 bytes、9,003 AST nodes、0 parse failures。application coverage 为 complete（仅该输入），semantic coverage 为 unknown、各 family partial，仍有 1,845 项 semantic unknowns；静态语法与候选关系不能证明运行行为或后台 prompt。

[原始 Evidence](rea-followup-evidence.json) · [inspect-analysis-view 摘要](rea-followup-summary.json)。
