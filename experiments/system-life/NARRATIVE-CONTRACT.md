# 剧情优先 · 系统流 Agent 实验 v2

Only write experiments/system-life. Original AI Tavern untouched. Existing v1 files and saves remain for comparison. New server uses .data/stories (not .data/sessions). Same port3218/UI replaces first iteration. Video absent from primary flow, deferred optional scene descriptor only. Node built-ins, no dependencies.

## Ownership
Engine agent: narrative-engine.mjs + tests/narrative-engine.test.mjs
UI agent: public/index.html style.css app.js
Root: narrative-agent.mjs server.mjs + tests/narrative-server.test.mjs + docs
Research agent: GENRE-NOTES.md only

## APIs (same URL paths, v2 data)
GET /api/health => {ok,story:{configured,model},focus:'narrative'}
GET /api/sessions => {sessions:[{id,name,title,updatedAt,revision,mode,schemaVersion:2}]}
POST /api/sessions {name?,background?,systemName?,location?,ally?,genre?:'urban'|'cultivation'|'business',mode:'ai'|'demo'} => {session}
GET /api/sessions/:id => {session}
POST /api/sessions/:id/turn {revision,requestId,choiceId? | input?} => {session}; idempotent, 409 stale; all model failures leave prior state intact.
POST /api/sessions/:id/rewind {revision,nodeId} => {session}; snapshot+branch restore, revision monotonically advances.
GET /api/sessions/:id/export => full save JSON
POST /api/sessions/import {session} => normalized clone, validate server-side (v2 only; explain old v1 rejection), no old save overwrite.

## Session data (JSON schemaVersion2)
{id,schemaVersion:2,revision,createdAt,updatedAt,mode,preset:{name,background,systemName,location,ally,genre},canon:{facts:string[]},state:State,nodes:Node[]}
State={chapter:number,day:number,location:string,energy:number,credits:number,quests:Quest[],abilities:[{id,name,description}],inventory:[{id,name,description}],relationships:[{id,name,trust:number,stance:string}],facts:[{id,text}],threads:[{id,text}],summary:string,rewardLedger:string[],consequenceLedger:[{id,text}],status:'active'|'chapter-complete'}
Quest={id,title,description,requirements:[{id,text,done:boolean}],reward:{credits:number,ability?:{id,name,description},item?:{id,name,description}},status:'active'|'completed'|'failed',resolution?:string}
Node={id,parentId,revision,title,narrative,action:string|null,outcome:{type:'success'|'partial'|'failure'|'refused'|'opening',reason:string},systemMessage:string,choices:[{id,label,detail,stakes:string,route:string}],changes:string[],events:[{id,text}],source:'ai'|'demo',snapshot:State,scene?:{description:string}}
No five fixed actions, no automatic +XP for every message. Quest progress follows Agent judgment of actual story events; authoritative reward ledger handles exact precommitted reward once. Failure is a real outcome with consequences and further playable choice.

## AgentProposal (raw model JSON; exact names for engine and root)
{title,narrative,outcome:{type,reason},systemMessage,choices:[{label,detail,stakes,route}],events:[{id,text}],resolution:{progress:[{questId,requirementId,eventId}],failures:[{questId,reason,eventId}],energyDelta:number,spendCredits:number,location?:string,dayDelta:number,relationships:[{id,name,trustDelta:number,stance:string,eventId}],newFacts:[{id,text,eventId}],newThreads:[{id,text}],closeThreads:string[],newQuests:Quest[],summary:string},scene?:{description:string}}
Opening proposal outcome.type='opening', resolution.progress/failures=[]; 1-2 active goals, goals have 2-4 concrete requirements, done always false at creation; reward credits max100, ability/item each max1. Never invent completion in same turn as new quest assignment. Events IDs safe /^[-a-zA-Z0-9_]{1,80}$/ plus prose strings. All progress/failures/change-to-relationship/facts require eventId from this exact proposal.events.
Normal proposal progresses existing goals only; type failure/refused cannot complete requirements or grant rewards; failed quest gets no reward. Engine adds completed reward once when all requirements true, writes ledger using quest.id. No arbitrary state patches, no birth binding rewrite, no deletion of inventory/ability/canon, bounded energyDelta(-25..30), spendCredits<=available and <=50, dayDelta0..2, trustDelta -10..10. Only new goals after completion/failure or if fewer than2active. Refused/noevent attempt makes no numeric progress (energy/day changes can be0). Chapters advance when completing goal (root/engine choose exact simple).
Choices stakes explain plausible tradeoff; not false guaranteed numeric promises; UI displays known goal rewards. Number of choices2-4 (must meaningfully different routes), free text always allowed. Player controls next action; Agent may narrate the submitted action and immediate consequences, never choose the next route for player.

## narrative-engine.mjs interface
export DEFAULT_PRESET
export normalizePreset(input)
export createSession(input, optionalId) => session with nodes:[] and initialized state (server applyOpening before persisting)
export applyOpening(session,proposal) => session with node0 validated
export prepareAction(session,{revision,choiceId?,input?}) => {action,choice:null|Choice,revision} validated no state changes
export applyTurn(session,prepared,proposal) => new session; server is sole caller; validate no stale/out-of-scope grants.
export rewindSession(session,nodeId)
export validateSession(input) => independent clone new id; validate every node/snapshot and event/reward integrity, retain valid outcomes/choices/canon; forbid unsafe keys and unsafe resource values. Preserve readable v2 imported story, not old v1 replay five kinds.
export demoOpening(session) => AgentProposal
export demoTurn(session,prepared) => AgentProposal; authored branching vertical slice at least3 meaningful routes with different consequences, goal+reward+next decision in <=4 meaningful actions; no matter every free input gains progress. Input plot relevant approaches accepted, power/resource-demand refused, inability failure, transparent authored/demo labels. Genre custom presets respected.

## UI focus
Conversation/narrative primary, no city/video placeholder and no media button in current flow. Atmosphere restrained dark/amber existingquality. Opening default urban/fog city genre canchoose cultivation/business, name/system/location/ally/background canedit. Player action bubbles / current turn outcome / consequential narrative /2-4 concrete choices with stakes + free prompt. Sidebar current goals with actual requirements and precommitted reward; abilities/items/relationships/facts+consequences collapsible. Story history click/read/rewind, clear source and errors, save/export/import, no automaticdemo fallback. Show chapter and day (no v1 level/XP). Ignore absent v1 scene/video state; no video health calls/polling. User messages/AI body DOM textContent safe. Save runs separate story namespace no needv1UIcompat.
