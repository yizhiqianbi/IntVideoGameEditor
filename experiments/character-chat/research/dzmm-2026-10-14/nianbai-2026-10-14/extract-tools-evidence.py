from pathlib import Path
import hashlib,json,re
root=Path(__file__).resolve().parent.parent
out=Path(__file__).resolve().parent
main=root/'public/scripts/C58mxSVt2.js'
entry=root/'public/scripts/B28hEJCi.js'
sources={p.name:{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size_bytes':p.stat().st_size} for p in [main,entry]}
text=main.read_text(); records=[]
def ev(i,needle,claim,size=650,source=main,level='static_application'):
 s=source.read_text();pos=s.index(needle);snippet=s[pos:pos+size]
 records.append({'id':i,'claim':claim,'evidence_type':level,'source':source.name,'sha256':sources[source.name]['sha256'],'byte_offset':len(s[:pos].encode()),'byte_length':len(snippet.encode()),'snippet':snippet})
ev('N01','Bi=Q.lazy','Agent conversation routes lazy-load this module',400,entry)
ev('N02','P.type===`agent`?','Agent is separate from regular AI character chat rendering',600,entry)
ev('N03','function Iu({conversationId','Hook defaults: companion / gentle / manual',220)
ev('N04','let he=(0,F.useMemo)','Application configures /api/agent/pod/chat and only messages.slice(-1)',600)
ev('N05','let t=await ye.agent.messages.query','Server history API: limit 200, includeStalled, sort seq, keep user/assistant/system',1100)
ev('N06','function Du(e)','Stored toolInvocations are reconstructed into tool-* output-available parts; metadata restored',740)
ev('N07','let Ae=(0,F.useCallback)','Create deduped via pending promise; creates conversation before sending',670)
ev('N08','let t={conversationId:e,mode:','Application submit body includes conversationId, mode, persona, personaMode, optional imageUrls',400)
ev('N09','var gl=`','Bundled AI SDK version string',40,level='static_sdk')
ev('N10','async reconnectToStream(e)','SDK default reconnect route derived from configured API and chatId, GET, 204 is no stream',1200,level='static_sdk')
ev('N11','if(!n())return;let o=await ye.agent.activeRun.query','Application actively queries running status, handles recovering, and resumes stream',1800)
ev('N12','var Ou=6','Application retry/time constants: max retries, idle, cold start, migration',260)
ev('N13','let De=(0,F.useRef)','Visibility/pageshow/online recovery; optional idle history reload feature flag',1670)
ev('N14','let n=O.current.messages.at(-1)','Cold start/capacity automatic regenerate every 5s, preserving message body',1000)
ev('N15','Ne=(0,F.useCallback)','Cancel RPC serialized and local stream aborted',1000)
ev('N16','var hu={replyStalled','Application error states preserve input, acknowledge settlement and migration',1200)
ev('N17','function Tu(e,t)','Memory recovery pending/conflict and replyStalled metadata',560)
ev('N18','function Lu(e)','Completed switch_persona tool results update gentle/direct persona',760)
ev('N19','var Wu=','Bubble splitting uses blank paragraphs and removes horizontal-rule-only segments',480)
ev('N20','function Uu(e,t,n)','One additional bubble made visible no sooner than 800ms',400)
ev('N21','Pd=600','Greeting entrance uses typing delay of 600ms',770)
ev('N22','entranceDelay:dt?e.index*1200','Greeting entrance spacing 1200ms; bubble/tool feature flags passed',160)
ev('N23','let{t}=De(),n=Oe(),r=xe(),i=qe()','Application conversation component and billing configuration query',570)
ev('N24','onMemoryChanged:(0,F.useCallback)','Generation finish invalidates memories/files/diaries/countdowns/capsules',480)
ev('N25','Td=F.memo','Dedicated result renderers dispatch by tool name; not backend definitions',3000)
ev('N26','Ed={memory_save:','Tool names have UI running labels, including workspace and shell',3000)
ev('N27','function jd(e)','UI tool envelope reads toolCallId/name/input/output/state; preserves text/tool order',700)
ev('N28','var Hd=','Offline task reminder UI schemas/defaults and feature gate',920)
ev('N29','function Gd({conversationId','Reminder settings RPC binding and save',1020)
ev('N30','function Bd()','Memory RPCs list/remove/pin; capsule RPC',1230)
ev('N31','let c=ke(i.agent.memoryFile.queryOptions','Lazy read memory file by path',660)
ev('N32','n[0].id===`memory-file`','Memory UI supports file-based and legacy row-based representations',630)
ev('N33','function Id(e)','Memory parser accepts JSON with content/title/createdAt/mood/pinned',560)
ev('N34','function Ld(e)','Memory parser supports Markdown metadata and hides file references',2200)
ev('N35','od=({data:e})','Proposed actions use ID, get/confirm/cancel APIs; feature-gated',1250)
ev('N36','let i=await n.fetchQuery(t.agent.actions.get.queryOptions','Forum draft rechecks actor and action status, opens editor, not directly publishes',950)
ev('N37','let s=C(`nianbai.studio-copilot`)','Card draft tool previews require separate confirmation/cancel API',700)
ev('N38','let[r,i]=(0,F.useState)(null),a=(0,F.useCallback)','Choice click submits selected label via callback',620)
ev('N39','var Jl=class','SDK default /api/chat is generic; app overrides with /api/agent/pod/chat',370,level='static_sdk')
block=text[text.index('Ed={memory_save:'):text.index('},Dd={memory_write:')]
tools=[{'name':m.group(1),'ui_label':m.group(2)} for m in re.finditer(r'([a-z_]+):\{label:`([^`]+)`',block)]
commandsblock=text[text.index('zu=Object.freeze({'):text.index('}),Bu=e=>Object.hasOwn(zu,e)')]
commands=[{'command':m.group(1) or m.group(2),'ui_label':m.group(3)} for m in re.finditer(r'(?:"([^"]+)"|([a-z]+)):`([^`]+)`',commandsblock)]
rpc=sorted(set(m.group(0) for m in re.finditer(r'agent\.[A-Za-z]+(?:\.[A-Za-z]+)?\.(?:query|mutate|queryOptions|mutationOptions)',text)))
data={'scope':'Read-only static inspection of two previously saved public shipped JS modules. No source code execution, no private history, no online calls or runtime observation.','sources':sources,'records':records,'tool_ui_inventory':tools,'workspace_command_labels':commands,'application_rpc_references':rpc,'limitations':['UI support does not prove a tool is enabled or called in a run.','Tool input JSON schemas and server tool implementations are not present in these extracted app sections.','No server prompt or model identity is inferred from SDK, UI labels, or endpoint names.','Memory file rendering does not independently prove filesystem storage or vector retrieval technology.']}
(out/'tools-evidence.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'tools':len(tools),'commands':len(commands),'evidence':len(records),'sources':sources},ensure_ascii=False,indent=2))
