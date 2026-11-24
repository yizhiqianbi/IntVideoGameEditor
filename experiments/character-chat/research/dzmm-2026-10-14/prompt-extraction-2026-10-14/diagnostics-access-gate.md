# 普通角色生成诊断 UI：准确权限门控与勘误

2026-10-14，Asia/Shanghai。仅只读已有公开 JavaScript，没有调用 API、浏览器或任何账户私有资料。父代理已报告：自有游客聊天成功生成中性回复，但菜单中没有诊断项；本文不声称自己读取了该会话的变量或生成记录。

## 关键勘误

此前将 `hi()` 的 `r.userId === profile.id` 解读为「聊天会话所有者」不准确。追踪 import/数据写入后可确认：r 是**当前角色卡来源的元数据**，来自 card.getForChat，不是 chat.getSettings。按角色数据语义，该 userId 指向卡作者/所有者，而非正在与这张卡聊天的人。

因此「自己的游客聊天」本身不够。前端接受的两类身份是：profile.canViewDebug 为 true，或 profile.id 与当前角色卡数据 userId 相等。后者打开完整组装诊断还需该生成在后台 access 探测中为 viewable。

## 完整 UI 条件

| 项目 | 普通角色源码表达式 | 含义 |
|---|---|---|
| 候选生成 ID | `t.role === "assistant" && !t.editedFromGenerationId ? t.generationId : undefined` | 新生成、未编辑的 assistant 消息，需有 generationId |
| 特殊调试标志 i | `profile.canViewDebug === true` | 前端直接接受这个标志；没有在这里读取 adminLevel/VIP，不能猜后台授予条件 |
| 角色数据身份匹配 a | `!!card.userId && !!profile.id && card.userId === profile.id` | 卡作者/所有者匹配，不是会话创建者匹配 |
| 世界书 canViewDebug | `i || a` | 满足任一身份条件 |
| 普通身份 access probe s | `!i && a && !!chatId && !!generationId` | 只有角色身份匹配者才自动探测；其他普通聊天者不会由此自动获得 access |
| 组装 canViewPromptAssemblyDebug | `i || (s && accessResult === true)` | 完整组装另需后台 viewable 结果 |
| 世界书菜单 | `I && L` | I 是生成 ID，L 是 canViewDebug |
| 组装菜单 | `I && z` | z 是 canViewPromptAssemblyDebug |

内部消息提前走另一组菜单，不追加普通诊断动作。桌面工具栏使用等价条件。世界书和组装不是一个权限等级。

## 控件位置与名称

普通消息正文使用 context 菜单；符合条件时出现 **世界书诊断**、**查看组装上下文**。桌面消息下方也有同名 tooltip/aria-label 图标，工具栏随消息组悬停显示。权限不足时是**不生成菜单项**，并非仅将按钮置灰。

组装弹窗名为 **Prompt Assembly 调试**，页签为最终输入、原始输入、元数据。世界书诊断仍受服务端视图控制，可只显示「仅汇总」；此前核验的记录期限为 24 小时。

已有源码没有单独名为 preset-debug 的普通消息菜单。可观察到的是世界书诊断，以及其中对条目来源、预设/世界书命中的展示。

## 数据来源链，避免再混淆 userId

1. 1OY 引入 `dc as W`；Dm7 引入 `dc as It`，指向同一 D12 导出。
2. D12 把 RF 导出为 dc，RF 是共享 atom。
3. 普通角色页面 Sl 令 c 为 W(It) 的 setter。
4. Sl 查询 card.getForChat({cardId, chatId})，从结果 T 得到角色数据 A，执行 c(A)。
5. 1OY 的 hi() 从 V(W) 读到上述角色数据。会话设置另由 DQpo 的 chat.getSettings hook 提供，hi() 没有用该 hook 判断身份。
6. profile 来自 D12 的 YN/user.getMe，导出为 ll，由 1OY 引作 Ie。

这是跨模块来源链的静态确认，不是读取真实用户 profile。后台 card.getForChat 返回内容与 profile.canViewDebug 授权规则的运行值仍未取得。

## 为什么当前普通游客菜单可能没有诊断

当前现象与「游客是在聊天第三方角色，而非该角色作者，且没有特殊调试标志」这一权限路径相符。仅根据菜单缺项仍不能断定每一个实际变量值；缺 generationId、编辑标志等也会排除动作。

这段 UI gate 不判断当前 model/style/VIP 等级。因此不能把缺项直接归因于 Surge 模型不支持诊断。后台 viewable 的具体政策未知；没有尝试绕开菜单请求诊断端点。

## 与念白 agent 分离

B28 入口按 `P.type === agent` 进入 C58 念白组件；普通角色走 Dm7/1OY。本文 hi/menu 控制的是普通角色消息，不是念白工具流/agent 调试。念白中的 SDK 默认 `/api/chat` 或工具显示逻辑不能用于判断这个 UI 权限。

## 需要父代理统一纠正的旧文字

以下是本次只读扫描时的文件与行号，没有修改旧文件：

| 文件 / 行 | 必须纠正的表述 |
|---|---|
| guest-ui-notes.md:15 | 「当前会话设置的 userId」「会话 userId 等于 profile.id」应改为当前角色卡来源元数据的 userId 匹配 |
| guest-ui-notes.md:17 | 「普通会话所有者」应改为角色卡作者/所有者；仍需 viewable 探测 |
| report.md:117 | 「会话所有者身份开放」「普通所有者」应明确为角色卡作者/所有者 |
| live-findings.md:50 | 泛称「所有者」容易被理解为会话拥有者，应明确为卡作者/所有者 |

report.md:85 的「自己的会话也不保证能查看」本身正确；report.md:87、reverse-engineering-round2.md:70 所述“自己的生成诊断”是材料来源目标，但应补充卡作者/特殊调试身份这一访问前提，不宜让人以为任意自有会话都有正常入口。

## 可复核短段

以下均是官方公开脚本。每项包含源文件 SHA-256、UTF-8 零基 byte、一基 line；短段对原始字节回验。不是运行权限验证。

### 准确权限函数

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 15；byte 33715，span [33695, 34290)。

```javascript
)})}var pi=1e4,mi=4;function hi(e,t){let{data:n}=Ie(),r=V(W),i=(n==null?void 0:n.canViewDebug)===!0,a=!!(r!=null&&r.userId)&&!!(n!=null&&n.id)&&r.userId===n.id,o=i||a,s=!i&&a&&!!e&&!!t,{data:c}=Je({queryKey:[`prompt-assembly-access`,e,t],queryFn:()=>fi(e,t),enabled:s,staleTime:1/0,refetchInterval:e=>e.state.data===!1&&e.state.dataUpdateCount<mi?pi:!1});return{canViewDebug:o,canViewPromptAssemblyDebug:i||s&&c===!0}}function gi(e){let t=Ze(),n=Be(),r=Ke(),i=At(e),a=H(_t),o=H(yt),s=H(Mt),c=H(Xe),l=V(_t),{mutateAsync:u}=je(n.chat.generateTTS.mutationOptions());return{playOrGenerate:(0,Y.useCa
```

### 普通消息菜单条件

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；byte 58245，span [58225, 58520)。

```javascript
=st(e),F=t.__branch,I=t.role===`assistant`&&!t.editedFromGenerationId?t.generationId:void 0,{canViewDebug:L,canViewPromptAssemblyDebug:z}=hi(e,I==null?null:I),{rating:B,toggleUp:ee,toggleDown:ne}=Ea(e,t),re=R(`chat.reply-feedback`),ie=R(`chat.edit-follow-up-guidance`);return{items:(0,Y.useMemo)
```

### 诊断菜单动作

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；byte 60383，span [60363, 60807)。

```javascript
ole===`assistant`&&(I&&L&&c.push({key:`lorebook-debug`,label:`世界书诊断`,icon:(0,Q.jsx)(d,{className:`size-4`}),onClick:()=>{j({chatId:e,generationId:I})}}),I&&z&&c.push({key:`assembly-debug`,label:`查看组装上下文`,icon:(0,Q.jsx)(r,{className:`size-4`}),onClick:()=>{M({chatId:e,generationId:I})}}),o||c.push({key:`audio`,label:f(O?`chat.toolbar.stopPlaying`:`chat.toolbar.playVoice`),icon:S?(0,Q.jsx)(Ge,{size:16}):O?(0,Q.jsx)(l,{
```

### 桌面工具栏等价门控

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 20；byte 66041，span [66021, 66465)。

```javascript
},`feedback`),T(w)),_&&y&&T((0,Q.jsx)($,{onClick:()=>g({chatId:e,generationId:_}),tooltip:`查看组装上下文`,icon:r},`assembly-debug`)),_&&v&&T((0,Q.jsx)($,{onClick:()=>h({chatId:e,generationId:_}),tooltip:`世界书诊断`,icon:d},`lorebook-debug`)),t.role===`assistant`&&(m||T((0,Q.jsx)(Ba,{message:t,chatId:e},`audio`)),T((0,Q.jsx)(Va,{message:t,chatId:e},`generate-image`))));let E=i&&t.role===`assistant`&&!a&&o;return(0,Q.jsxs)(`div`
```

### 1OY atom导入

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 2；byte 1675，span [1655, 1745)。

```javascript
e,_r as we,ap as Te,dc as W,dl as Ee,ep as De,fc as Oe,fl as ke,fm as G,gc as Ae,gm as je,
```

### D12 atom定义

[D12SqV8q.js](https://www.dzmm.ai/assets/D12SqV8q.js)；SHA-256 `5dfcb47b825471d5aa49e26333aeef04826ce688702874631f223c794938f420`；line 13；byte 850579，span [850559, 850734)。

```javascript
`)?t:`${e}\n${t}`:e}var RF=Z(),zF=pM(e=>Z(!1)),BF=pM(e=>Z(!1)),VF=Z(!1),HF=Z(null),UF=Z(e=>!!e(HF)),WF=Z(e=>{let t=e(HF);if(!t)return()=>!1;let[n,r]=t;return e=>e>=n&&e<=r}),G
```

### D12 atom导出

[D12SqV8q.js](https://www.dzmm.ai/assets/D12SqV8q.js)；SHA-256 `5dfcb47b825471d5aa49e26333aeef04826ce688702874631f223c794938f420`；line 57；byte 1688093，span [1688073, 1688158)。

```javascript
u,f9 as d,YAe as da,RF as dc,BO as dd,OE as df,TX as di,JN as dl,$g as dm,M3 as dn,MK
```

### 普通角色绑定setter

[Dm7jYsLH.js](https://www.dzmm.ai/assets/Dm7jYsLH.js)；SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`；line 33；byte 173062，span [173042, 173307)。

```javascript
e),Hc(e);let s=Ma(),c=W(It),l=W(vn(e)),u=W(Wt(e)),d=W(si),f=W(Xr),p=W(Bt(e));(0,Q.useEffect)(()=>(l(!1),u(!1),()=>{l(!1),u(!1)}),[e,u,l]);let m=ni(e),{data:h,isError:g,refetch:_}=ti(e),{isLoading:v,messages:y,error:b,refreshMessages:x}=q(e),S=H(Re(e)),C=H(ke(e)),w=
```

### 普通角色数据读取

[Dm7jYsLH.js](https://www.dzmm.ai/assets/Dm7jYsLH.js)；SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`；line 33；byte 173397，span [173377, 173747)。

```javascript
ror:O,refetch:k}=xn(o.card.getForChat.queryOptions({cardId:w,chatId:e},{enabled:!!w,staleTime:0,refetchOnMount:!0,retry:3})),A=(0,Q.useMemo)(()=>E||T===void 0?null:T===null?s:T.isUnavailable?{...s,takedown:T.takedown}:T,[T,E,s]),j=H(At),ee=(A==null?void 0:A.isGeneralChat)===!0&&y.length===0&&!S&&!C&&!v&&!E,te=(0,Q.useCallback)(e=>{p(e)},[p]),M=(r=A==null?void 0:A.stat
```

### 角色数据写入atom

[Dm7jYsLH.js](https://www.dzmm.ai/assets/Dm7jYsLH.js)；SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`；line 33；byte 173793，span [173773, 173893)。

```javascript
0,Q.useEffect)(()=>{c(A)},[A,c]),(0,Q.useEffect)(()=>{f()},[e,f]);let ne=(0,Q.useRef)(x);ne.current=x;let re=(0,Q.useRef
```

### profile来源

[D12SqV8q.js](https://www.dzmm.ai/assets/D12SqV8q.js)；SHA-256 `5dfcb47b825471d5aa49e26333aeef04826ce688702874631f223c794938f420`；line 13；byte 786309，span [786289, 786499)。

```javascript
qN,queryClient:wh}),YN=()=>{let e=Dm(GN().user.getMe.queryOptions(void 0,wM));return{...e,profile:e.data}};function XN(e,t){e.invalidateQueries({queryKey:t.chat.listAll.queryKey()}),e.invalidateQueries({queryKe
```

### access探测声明

[1OYk4JId.js](https://www.dzmm.ai/assets/1OYk4JId.js)；SHA-256 `3cd914dd36cbe12daa78cc8b48d9888cd5a1dda233dd2a83f25ee7b9c4893c73`；line 15；byte 33049，span [33029, 33499)。

```javascript
00,ci=new Map,li=!1;async function ui(e,t,n){try{let i=await ge(`/api/chat/assembly`,{chatId:e,generationIds:t}),a=new Set(Array.isArray(i==null?void 0:i.viewable)?i.viewable:[]);for(let e of t){var r;for(let t of(r=n.get(e))==null?[]:r)t.resolve(a.has(e))}}catch(e){for(let r of t){var i;for(let t of(i=n.get(r))==null?[]:i)t.reject(e)}}}function di(){li=!1;let e=[...ci];ci.clear();for(let[t,n]of e){let e=[...n.keys()];for(let r=0;r<e.length;r+=si)ui(t,e.slice(r,r+si
```

### 产品分支

[B28hEJCi.js](https://www.dzmm.ai/assets/B28hEJCi.js)；SHA-256 `96ce4d844266606a9b0d182f5e3a8d146477bdf654351af1f7ab92a11fb3eab7`；line 4；byte 87614，span [87594, 88154)。

```javascript
0,$.jsx)(Oi,{}):C?P?P.type===`agent`?(0,$.jsx)(Q.Suspense,{fallback:(0,$.jsx)(Oi,{}),children:(0,$.jsx)(Bi,{conversationId:P.id})}):(0,$.jsx)(Q.Suspense,{fallback:(0,$.jsx)(Oi,{}),children:P.type===`user`?(0,$.jsx)(Hi,{userId:u.id}):P.data.isGamefy?(0,$.jsx)(Ui,{chatId:P.id,data:P.data},P.id):(0,$.jsx)(ee,{chatId:P.id,chat:P.data,isFirstAiConversation:P.id===S})}):(0,$.jsx)(Oi,{}):d&&d.length===0&&!h?(0,$.jsx)(xr,{className:`h-full`}):(0,$.jsx)(Ri,{})};function Ki(e){return e&&Hn.includes(e)?e:void 0}function qi(e){var t;return e==null||(t=e.data)==null?
```
