import {readFile,writeFile} from "node:fs/promises";
import {QINGYU_CHARACTERS,QINGYU_CARD_VERSION} from "../engine/src/lib/qingyu-catalog";
import {buildDzmmPromptPlan} from "../engine/src/lib/dzmm-chat";
import {reviewContent} from "../src/server/policy";

const env=Object.fromEntries((await readFile(new URL('../.dev.vars',import.meta.url),'utf8')).split('\n').filter(x=>/^[A-Z_][A-Z_0-9]*=/.test(x)).map(x=>{const at=x.indexOf('=');return [x.slice(0,at),JSON.parse(x.slice(at+1))];}));
const inputs=[
  [0,"comfort","今天汇报被否了，我很委屈，只想听你认真哄一句。别讲大道理，也先别邀我听音乐。"],
  [1,"evidence","邮戳早只能说明信可能比较早，并不能证明这本书很早入馆。这样想对吗？别直接替我猜寄信人。"],
  [2,"withdrawal","我刚才答应接受采访，现在反悔了。文字和照片都别放进影集。"],
  [3,"no-lecture","我不懂这些原理，也不想学，只想看看漂亮的星图。你会觉得我不认真吗？"],
  [0,"new-scene","一个月后，音乐会已结束。今天在菜市场碰见你，我们聊聊做饭，不再聊开场曲。"],
  [1,"decline","今天不想查信，也不想让你安排别的，我只想自己在海边坐一会儿。"],
  [2,"continuity","两周后，车站的采访已经结束。今天我在花店整理录音，先只聊工作，不要暧昧。"],
  [3,"time-jump","半年后，老望远镜已经正常开放。我们今天来社区下棋，不聊设备和检修。"],
] as const;
const model=process.env.QINGYU_TRIAL_MODEL??env.CHAT_MODEL;
const selected=process.env.QINGYU_TRIAL_CASES?.split(',');
const results=await Promise.all(inputs.filter(([,name])=>!selected||selected.includes(name)).map(async([index,caseName,input])=>{
  const card=QINGYU_CHARACTERS[index];
  const plan=buildDzmmPromptPlan({character:card,messages:[{role:'assistant',content:card.firstMessage},{role:'user',content:input}],model:'fast',maxTokens:700});
  try {
    const r=await fetch(env.CHAT_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.CHAT_API_KEY},body:JSON.stringify({model,messages:plan.messages,max_tokens:700,temperature:.65,reasoning:{effort:'none',exclude:true}}),signal:AbortSignal.timeout(60000)});
    if(!r.ok)return {name:card.name,caseName,input,status:r.status,output:null};
    const v=await r.json() as {choices?:Array<{message?:{content?:string};finish_reason?:string}>};
    const output=v.choices?.[0]?.message?.content??'';
    let moderation='allowed';try{await reviewContent(output,env);}catch{moderation='not-approved';}
    return {name:card.name,caseName,input,status:r.status,output,moderation,finishReason:v.choices?.[0]?.finish_reason,diagnostics:plan.diagnostics};
  } catch { return {name:card.name,caseName,input,status:'request-failed',output:null}; }
}));
await writeFile(new URL(model===env.CHAT_MODEL?'../evidence/character-cards-live-samples.json':'../evidence/character-cards-live-stronger.json',import.meta.url),JSON.stringify({version:QINGYU_CARD_VERSION,date:new Date().toISOString(),model,scope:'Synthetic live samples using the production prompt assembler. No native core sessions or long historical memory were exercised. Outputs require manual review; no quality score is inferred.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({name,caseName,status,output,...rest})=>({name,caseName,status,output,...rest})),null,2));
if(results.some(x=>x.status!==200||!x.output||('moderation' in x&&x.moderation!=='allowed')))process.exitCode=1;
