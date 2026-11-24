# 独立系统流实验接口（v1）

Only write inside experiments/system-life. No imports from original project; no original package/config changes. Node built-in HTTP + vanilla browser modules, no install/build.

## API
- GET /api/health => {ok:true,story:{configured,model},video:{connected,model,error?}}
- GET /api/sessions => {sessions:[{id,name,title,updatedAt,revision}]}
- POST /api/sessions {name?,background?,systemName?,appearance?,visualStyle?,location?,ally?,mode?:"ai"|"demo"} => {session}
- GET /api/sessions/:id => {session}
- POST /api/sessions/:id/turn {revision,requestId,choiceId? | input?} => {session}; 409 stale revision. No automatic fallback to demo after AI errors.
- POST /api/sessions/:id/rewind {nodeId,revision} => {session}; truncates branch, keeps immutable prior node snapshots.
- POST /api/sessions/:id/video {nodeId,referenceImage?} => {session}; task bound to exact node; async returns pending.
- POST /api/sessions/:id/video/import {nodeId,url? | data?,mime?} => {session}; URL http(s) or local base64 video, server persists.
- GET /api/sessions/:id/video/:nodeId => {session}; polls exact node video state.
- GET /api/sessions/:id/export => downloadable full JSON
- POST /api/sessions/import {session} => {session}; validate before persisting new id
- GET /api/media?... => video proxy or stored file. Local only host 127.0.0.1.

## Session schema
{id,schemaVersion:1,revision,createdAt,updatedAt,mode,preset:{name,background,systemName,appearance,visualStyle,location,ally},canon:{facts:string[]},state:{age:18,day:number,chapter:number,location:string,level:number,xp:number,energy:number,credits:number,traits:{insight:number,resolve:number,empathy:number},inventory:string[],quests:[{id,title,progress,target,status}],flags:string[],relationships:[{name,trust}]},nodes:Node[]}
Node={id,parentId:null|string,revision,title,narrative,systemMessage,action:string|null,choices:[{id,label,detail,kind}],changes:string[],scene:{prompt,negativePrompt,continuity:string[],duration:5,seed:number},video:{status:"none"|"queued"|"running"|"completed"|"failed",taskId?,url?,error?},source:"ai"|"demo",snapshot:State}
Kinds = observe | train | talk | explore | rest. Rest cost 0, others engine decides fixed costs and rewards. Engine is sole authority for progression; AI writes prose only against resolved state.

## engine.mjs interface (root integration)
export DEFAULT_PRESET
export normalizePreset(input)
export createSession(input, optionalId)
export resolveTurn(session,{choiceId?,input?,requestId?,revision}) => {state,action,kind,changes} or throws Error with .status
export commitTurn(session,resolved,story) => new session
export initialStory(session) => {title,narrative,systemMessage,choices}
export demoStory(session,resolved) => {title,narrative,systemMessage,choices}
export rewindSession(session,nodeId) => new session
export validateSession(session) => normalized session or throws
export buildScene(session,story,state,action) => scene (root can use in story pipeline)
commitTurn builds scene if story.scene absent, stores snapshot. initial createSession includes a demo initial node; server can replace narrative/scene/source before save.

## Narrative contract
AI returns {title,narrative,systemMessage,choices:[{label,detail,kind}],shot:string}; bounded validate schema; cannot mutate state/canon/inventory/quests. Scene prompt includes immutable appearance, visual style, location, newest action, canonical facts. shot adds camera/event only. Source/mode visible.

## Frontend ownership
Frontend agent owns only public/index.html, public/style.css, public/app.js. All API calls relative. UI Chinese, premium dark cinematic story player, orange/amber accent. Large scene/video panel + prose/choices + right system status inspector. Setup modal/preset editing, AI/demo mode, free input, history/rewind, video generate/import local MP4+URL, polling, export/import, clear errors, disable actions while busy. Built-in abstract canvas/SVG scene placeholder honestly labeled video pending, no claimed generated imagery. On opening auto list/resume latest session; if none show compelling setup screen. Config/API adapter root may tweak app.
