# 普通角色请求契约与动态模型目录：补充静态核验

2026-10-14，Asia/Shanghai。仅分析现有官方公开 JavaScript，不做网络、API 或浏览器调用，不读取任何账户/聊天存档。此补充不改旧 extracts、索引或报告。以下是**客户端字段与控制路径**，不是后台最终 messages 或真实生成参数。

主来源：[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)，SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`，96,166 bytes。它已独立送入 REA，Evidence ID `ev_a19a29a9c55996a32693d95f83c505ee3417f31dcf326a997e489fdc15a9daa4`；下面的字段追踪是手工静态短段。REA application coverage complete 仅指此输入，semantic status unknown，仍有动态/跨模块关系未知。

## 1. 普通生成请求已有的层次

| 请求字段 | 客户端来源与作用 | 尚不能据此确认的内容 |
|---|---|---|
| `chatId`、`cardId` | 当前会话和会话设置中的角色卡 ID | 后台取卡版本、平台固定身份/规则以及注入顺序 |
| `chatSettings` | 会话设置 hook `At(chatId)`；普通 builder 复制 model、style、maxTokens、randomIndex、deepThinking、enableMemoryEnhance、部分 voiceSettings | 实际供应商路由、temperature/top_p、后台补全的默认值 |
| `presetConfig` | 全局 preset.list 设置与会话 presetOverride/旧 presetId 按明确条件选出 IDs；身份文本合并 | 预设/世界书条目实际触发、预算分配、插入顺序与后台内容指南 |
| `prompts` | 已载入消息投影成 role/content，过滤内部消息，取近期窗口；普通新消息追加 user 输入 | 最终上游模型输入是否原样使用、是否再次裁剪/压缩/改写 |
| `content`、`imageUrl`、`recording` | 当前 generate 操作的输入/附件，作为操作字段另行发送 | 不能因它与 prompts 最后一条相关就声称模型会收到重复消息 |
| `currentStatus` | 当前 statusTemplate 结合历史消息计算，开关允许时传出 | 不能等同长期记忆或后台关系状态系统 |
| `supportsSuggestions`、`chunkedHistory` | 客户端设置或功能开关 | 是否生效及具体服务端执行行为 |

普通 builder 没有在自身代码里把 description/personality/scenario、worldbook entries 等文本再拼成一个 system 消息；它发送角色 ID、配置及历史输入。这里能确认的是**引用与分层字段**，不能断言所有上下文都在前端组装，也不能恢复后台私有 prompt。

`At` 由 `DQpo-2Vv.js` 导出；消息 `st` hook 由 `Du6L78y2.js` 导出。当前本地没有这两份依赖，因此消息加载、分支展开、设置缓存内部实现继续未知。`ya` 将 hook 的 messages 放入 ref，`getRecentMessages` 调用 `zi`，所以下面的历史选择代码有直接调用关系。

## 2. presetConfig：身份与预设选择是明确的客户端步骤

`Ai()` 用 tRPC `preset.list` 获取结果 settings，读取 activePresetIds，兼容单个 activePresetId；读取 playerInfo 作为全局身份。缓存 staleTime 为 60 秒，外围读取等待上限为 20 秒。

`Oi(settings, globalIds, globalPlayerInfo, options)` 的选择规则：

- 有会话 presetOverride.presetIds 且非空时，采用该数组。
- 空数组只有 emptyOverrideDisables 功能开关为 true 时才明确表示不启用预设，并传 `emptyOverrideDisables: true`。
- 其他情况下，若有旧的会话 presetId 就使用单个 ID；否则跟随全局 IDs。
- playerInfo 将全局文本与会话 override.playerInfo 分别 trim、去空后用空行连接。它是**合并**，不是文本覆盖或语义冲突消解。

新消息和重新生成调用使用 `chat.session-empty-preset` 功能开关来传入这个行为。实际请求只引用所选 IDs；本次没有读取任何用户实际预设数据，也不知道其后台是否通过其他规则排除不兼容预设。

## 3. prompts/history：有客户端窗口，但不是长期记忆算法

`zi(messages, options)`：

1. 按 endIndex 取前缀，默认到当前 messages 末尾。
2. 过滤 `isInternalMessage`。
3. 默认 limit 为 **500 条消息**；chunked 关闭时最多取最近 500 条。
4. chunked 开启且超过 limit 时，保留数是 `500 + (过滤后总数 - 500) % 100`，因此旧历史窗口可有 500–599 条，随 100 条分组边界变化。
5. 投影成 `{role, content}`，可追加调用方给出的 appendedMessage。

正常文本/图片发送实际上先调用 getRecentMessages，再追加一条 user；因此请求 prompts 可以比旧历史窗口多一条，不应把“500”写成完整请求的绝对上限。图片新输入可由 text/image_url content parts 表达。

重新生成先定位目标消息，选取目标前的历史；编辑用户消息后重新生成也是取目标前历史，再追加编辑后的 user 文本。后台收到 regenerate/editAndRegenerate 的 chunkId、index 等操作字段。客户端修剪和服务端按 token 管理上下文是不同层，500/599 不是模型 token 容量，也不证明其稀疏记忆如何保留旧信息。

## 4. 动态模型目录：确切查询是 chat.models

现有文件直接声明：

```javascript
Be().chat.models.queryOptions({service:`chat`},{staleTime:300*1e3})
```

这是 tRPC procedure **chat.models**，参数 service 为 chat，客户端缓存 5 分钟。该函数的调用处用于从目录中寻找一款特定系列的辅助候选；它证明聊天模型动态目录的查询存在，不证明普通模型选择器所有流程都由这个函数完成。

返回目录被遍历为 categories / unsupportedLanguages[].categories → modelGroups → contexts；候选保留 internalName 与 displayName，并使用 isRecommended/maxContext 选择。此处没有固定的底模供应商映射。

既有 D12 根客户端 `WN()` 的 transport base 是 `/api/trpc`，并按 procedure 条件选择 transport。**本次没有构造或请求一个猜测的完整 URL**，也没有查看在线目录结果。应在正常 UI 或真实生成的元数据里区分显示名、调用别名与 provider。

## 5. builder 允许的 schema 与实际 builder 要分开

chatSettings 的 schema 还允许 assemblyMode、voiceId、generateImage/imageGenerationModel 等选项；普通 `ji` 构造器当前没有赋予全部这些字段。语音路径在 builder 返回后另加 voiceId。不能把 schema 的“可传”写成每次请求“实际传了”。

普通 payload 最后通过共享 `ca()` 的 `POST /api/chat` 发送，另有生成 stream URL。source 中的 operation 区分 generate、regenerate、editAndRegenerate。这确证普通角色的静态 transport，仍不等于观察了真实请求或服务器如何执行。

## 可复核短段

下面统一源文件 SHA 为 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；位置是 UTF-8 零基字节、一基行号。每个 span 都已按保存字节回验。

### 预设选择与身份拼接

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 15，byte 36781，span [36761, 37251)。

```javascript
void 0)}var Di=15e3;function Oi(e,t,n,r={}){var i,a;let o=(i=e.presetOverride)==null?null:i,s=[];s=Array.isArray(o==null?void 0:o.presetIds)&&(o.presetIds.length>0||r.emptyOverrideDisables===!0)?o.presetIds:e.presetId?[e.presetId]:t;let c=[n||``,(o==null?void 0:o.playerInfo)||``].map(e=>e.trim()).filter(Boolean).join(`

`)||void 0;return{presetIds:s,playerInfo:c,...r.emptyOverrideDisables&&(o==null||(a=o.presetIds)==null?void 0:a.length)===0?{emptyOverrideDisables:!0}:{}}}var ki=2e4;as
```

### 全局预设读取

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 17，byte 37249，span [37229, 37619)。

```javascript
:!0}:{}}}var ki=2e4;async function Ai(){var e,t;let n=await Ti(G().ensureQueryData({queryKey:Ee.preset.list.queryKey(),queryFn:()=>ke.preset.list.query(),staleTime:1e3*60}),ki,`preset read`),r=n==null?void 0:n.settings;return{activePresetIds:(e=r==null?void 0:r.activePresetIds)==null?r!=null&&r.activePresetId?[r.activePresetId]:[]:e,playerIdentity:(t=r==null?void 0:r.playerInfo)==null?``
```

### 普通请求 builder

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 17，byte 37623，span [37603, 38573)。

```javascript
erInfo)==null?``:t}}async function ji(e,t,n,r,i){var a,o,s,c,l,u,d;let{activePresetIds:f,playerIdentity:p}=await Ai(),m=Oi(t,f,p,i);return{chatId:e,cardId:(a=t.cardId)==null?``:a,chatSettings:{model:t.model,style:t.style,maxTokens:t.maxTokens,randomIndex:t.randomIndex,deepThinking:(o=t.deepThinking)==null?void 0:o,enableMemoryEnhance:(s=t.enableMemoryEnhance)==null?void 0:s,voiceSettings:{ignore_parentheses:(c=t.voiceIgnoreParentheses)==null?void 0:c,only_quotes:(l=t.voiceOnlyQuotes)==null?void 0:l,ignore_english:(u=t.voiceIgnoreEnglish)==null?void 0:u,read_asterisks:(d=t.voiceReadAsterisks)==null?void 0:d}},presetConfig:m,prompts:n,...i!=null&&i.chunkedHistory?{chunkedHistory:!0}:{},supportsSuggestions:typeof window<`u`&&localStorage.getItem(`chat_auto_suggest`)!==`false`,currentStatus:Si()?r:void 0}}var Mi=q({path:K().min(1),durationMs:De().int().positive(),waveform:He(De().min(0).max(1))}),Ni=Te([K(),He(Te([q({type:ue(`text`),text:K()}),q({type:ue(`imag
```

### 请求 schema

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 17，byte 38751，span [38731, 39641)。

```javascript
onal()}).optional(),Fi=q({model:K().nullable().optional(),style:K().nullable().optional(),maxTokens:De().nullable().optional(),randomIndex:De().nullable().optional(),deepThinking:z().optional(),enableMemoryEnhance:z().optional(),assemblyMode:K().optional(),voiceSettings:Pi,voiceId:K().optional(),generateImage:z().optional(),imageGenerationModel:ye(Pt).optional()}),Ii=q({presetIds:He(K()),playerInfo:K().optional(),emptyOverrideDisables:ue(!0).optional()}),Li=He(q({role:K(),content:Ni})),Ri={chatId:K(),cardId:Te([K(),De()]),chatSettings:Fi,presetConfig:Ii,prompts:Li,chunkedHistory:ue(!0).optional(),supportsSuggestions:z().optional(),currentStatus:tt.optional(),parentGenerationId:K().uuid().optional().catch(void 0),replacedGenerationId:K().uuid().optional().catch(void 0)};_e(`operation`,[q({...Ri,operation:ue(`generate`),content:K().max(5e4),imageUrl:K().max(1e7).optional(),recording:Mi.optional()}),
```

### 历史选择

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 17，byte 39832，span [39812, 40207)。

```javascript
min(1).max(5e4)})]);function zi(e,t={}){var n,r;let i=(n=t.endIndex)==null?e.length:n,a=(r=t.limit)==null?500:r,o=e.slice(0,i).filter(e=>!e.isInternalMessage),s=t.chunked!==!0||o.length<=a?a:a+(o.length-a)%100,c=o.slice(-s).map(e=>({role:e.role,content:e.content}));return t.appendedMessage?[...c,t.appendedMessage]:c}var Bi=D(null,(e,t,n)=>{t(Oe(n.chatId),e=>We(n.text,e))});async function Vi(e
```

### 会话与历史 hook

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 20，byte 47565，span [47545, 48015)。

```javascript
agePreview:r}:{}}})}function ya(e){let{t}=J(`error`),{data:n}=Ie(),r=At(e),i=V(W),{messages:a,queryKey:o}=st(e),s=H(O(e)),c=H(oe(e)),l=H(k(e)),u=H(Pe(e)),d=H(F(e)),f=H(le(e)),p=H(te(e)),m=H(qe(e)),h=H(Bi),g=H(bt),_=H(Xe),v=H(me),y=H(T),b=H(lt),x=H(I),S=Ne(),C=R(`chat.chunked-generation-history`),w=(0,Y.useRef)(!1),D=(0,Y.useRef)(a);D.current=a;let A=(0,Y.useCallback)((t,n,a)=>{if(!r)return;let o=a!=null&&a.at&&(t===`regenerate`||t===`edit_user`)?{kind:t,...a.at}:{ki
```

### 历史与当前状态调用

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 20，byte 54108，span [54088, 54543)。

```javascript
h,g,_,v,x,n,M,j,S]),getRecentMessages:(0,Y.useCallback)(e=>zi(D.current,{endIndex:e,chunked:C}),[C]),chunkedGenerationHistory:C,getCurrentStatus:(0,Y.useCallback)(e=>i!=null&&i.statusTemplate?nt(i.statusTemplate,D.current.slice(0,e)):void 0,[i==null?void 0:i.statusTemplate]),locateMessage:(0,Y.useCallback)((e,n,r)=>{let i=D.current.findIndex(t=>t.__chunk===e&&t.__index===n);return i>=0?i:(r&&m(r),E({description:t(`chat.generation.staleBranch`),variant
```

### 新 user 追加

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 20，byte 74272，span [74252, 74522)。

```javascript
l:{url:p}}]:m,A;try{A=await ji(e,r,[...O,{role:`user`,content:k}],l(),{emptyOverrideDisables:n,chunkedHistory:c})}catch{return b(),Wa(),E({description:t(`chat.generation.failed`),variant:`destructive`}),!1}let j=x(D.moreSeseArmTokenAtStart,D.moreSeseModelIdAtStart);if(!
```

### 重新生成前缀

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 20，byte 54859，span [54839, 55529)。

```javascript
t:e.length+1}},[])}}function ba(e){let t=R(`chat.session-empty-preset`),{chatSettings:n,isProcessingRef:r,trackEvent:i,executeGeneration:a,getRecentMessages:o,chunkedGenerationHistory:s,getCurrentStatus:c,locateMessage:l,reportPreparationFailure:u}=ya(e);return{regenerate:(0,Y.useCallback)(async(d,f)=>{if(r.current||!n)return;let p=l(d,f);if(p===null)return;i(`regenerate`,void 0,{at:{chunkId:d,index:f}});let m=o(p),h;try{h=await ji(e,n,m,c(p),{emptyOverrideDisables:t,chunkedHistory:s})}catch{u();return}await a({operation:`regenerate`,...h,chunkId:d,index:f},{audioIndex:0,branchPoint:{chunkId:d,index:f}})},[e,n,r,i,a,o,c,l,t,s,u])}}function xa(e){var t;return e.refused?`refused`:((t
```

### 动态模型目录查询

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 20，byte 72398，span [72378, 72578)。

```javascript
(e=>e.contexts):t))}function to(){let{data:e}=Je(Be().chat.models.queryOptions({service:`chat`},{staleTime:300*1e3}));return(0,Y.useMemo)(()=>eo(e),[e])}var no=`dzmm.voice-reply-settings-hint-shown`;f
```

### 目录与显示名投影

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 20，byte 71595，span [71575, 72125)。

```javascript
cted}var Ya=`Prism`;function Xa(e){var t,n;return[...(t=e==null?void 0:e.categories)==null?[]:t,...((n=e==null?void 0:e.unsupportedLanguages)==null?[]:n).flatMap(e=>e.categories)].flatMap(e=>e.modelGroups)}function Za(e){return e?{internalName:e.internalName,displayName:e.displayName}:null}function Qa(e){return e.seriesKey===Ya||e.seriesKey.startsWith(`${Ya}-`)||e.contexts.some(e=>e.displayName===Ya||e.displayName.startsWith(`${Ya}-`)||e.displayName.startsWith(`${Ya} (`))}function $a(e){return e.find(e=>e.isRecommended)||e.reduce((e,t)=>{var n,
```

### 普通角色发送

[官方资源](https://www.dzmm.ai/assets/1OYk4JId.js)，line 18，byte 43465，span [43445, 43835)。

```javascript
tionRequestError`}};async function ca(e){let{input:t,signal:n,callbacks:r}=e,i=await aa(`/api/chat`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(t)},n,async e=>{if(!e.ok){let t=await la(e);throw new sa(e.status,t)}});if(!i.body)throw new sa(0,`No response body`);let a=``;try{return await pa(i.body,{...r,onInit(e){var t;a=e,(t=r.onInit)==null||t.call(r,e)
```

### tRPC transport base

[官方资源](https://www.dzmm.ai/assets/D12SqV8q.js)，SHA-256 `5dfcb47b825471d5aa49e26333aeef04826ce688702874631f223c794938f420`，line 13，byte 785927，span [785907, 786347)。

```javascript
:r,useTRPCClient:i}}function WN(){return[FM({condition:e=>vbe(e.input),true:pN({url:`/api/trpc`,transformer:{serialize:e=>e,deserialize:hh.deserialize}}),false:FM({condition:e=>kye(e.path),true:xbe({url:`/api/trpc`,transformer:hh,maxItems:10}),false:pN({url:`/api/trpc`,transformer:hh})})})]}var{TRPCProvider:nxe,useTRPC:GN,useTRPCClient:KN}=txe(),qN=CN({links:WN()}),JN=UN({client:qN,queryClient:wh}),YN=()=>{let e=Dm(GN().user.getMe.query
```

### 编辑用户后的重新生成

[官方资源](https://www.dzmm.ai/assets/Dm7jYsLH.js)，SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`，line 33，byte 111400，span [111380, 112170)。

```javascript
n.name,o,s,r,i,a])}}function Ps(e){let t=Ke(`chat.session-empty-preset`),{chatSettings:n,isProcessingRef:r,trackEvent:i,executeGeneration:a,getRecentMessages:o,chunkedGenerationHistory:s,getCurrentStatus:c,locateMessage:l,reportPreparationFailure:u}=Sr(e);return{editAndRegenerate:(0,Q.useCallback)(async(d,f,p)=>{if(r.current||!n)return;let m=l(d,f,p);if(m===null)return;i(`edit_user`,{message_length:p.length},{at:{chunkId:d,index:f}});let h=o(m),g;try{g=await Yn(e,n,[...h,{role:`user`,content:p}],c(m),{emptyOverrideDisables:t,chunkedHistory:s})}catch{u(p);return}await a({operation:`editAndRegenerate`,...g,chunkId:d,index:f,editedContent:p},{pendingUserMessage:{content:p},audioIndex:1,branchPoint:{chunkId:d,index:f},onRestoreInput:p})},[e,n,r,i,a,o,c,l,t,s,u])}}var Fs=({activeChatI
```
