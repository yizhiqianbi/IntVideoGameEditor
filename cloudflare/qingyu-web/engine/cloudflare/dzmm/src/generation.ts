import { digest, tokenFrom } from './auth';
import { ApiError, json, readJson } from './http';
import type { Env, UserRecord } from './types';
import { findReference, handleGenerationReferences, referenceDataUrl, referenceSnapshot } from './generation-references';
import { handleStudioStillBilling } from './studio-still-billing';
import { GENERATION_MODELS, OPENROUTER_ORIGIN, ProviderRejected, assetType, boundedBytes, freezeGenerationPolicy,
  generationCharge, generationFx, imageBytes, providerCost, providerJson, readGenerationPolicy,
  type FrozenGenerationPolicy, type GenerationFetch, type GenerationKind, type GenerationModel } from './generation-provider';

type GenerationEnv=Env&{GENERATION_ENABLED?:string;GENERATION_OPENROUTER_API_KEY?:string;GENERATION_USD_TO_CNY?:string};
export type GenerationOptions={now?:()=>number;fetch?:GenerationFetch};
type Status='pending'|'processing'|'ready'|'failed'|'unknown';
type JobRow={id:string;user_id:string;request_id:string;request_fingerprint:string;kind:GenerationKind;model_id:string;prompt:string;template_id:string|null;
  aspect_ratio:string;duration:number|null;status:Status;provider_job_id:string|null;policy_json:string;reserved_credits:number;charged_credits:number;
  provider_cost_usd:number|null;cost_basis:string|null;exceeds_reservation:number;processing_token:string;poll_token:string|null;poll_started_at:number;
  object_key:string|null;mime_type:string|null;byte_length:number|null;error_code:string|null;created_at:number;updated_at:number;expires_at:number;finalized_at:number|null;deleted_at:number|null;reference_json:string|null};
type FrozenReference={id:string;name:string;mimeType:string;byteLength:number;width:number;height:number;assetUrl:string;contentHash:string};
type Input={kind:GenerationKind;model:GenerationModel;prompt:string;aspectRatio:string;duration?:number;templateId?:string;fingerprint:string;reference?:FrozenReference;referenceDataUrl?:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SQL_NOW="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const SESSION_GATE=`EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>MAX(?,${SQL_NOW}))`;
const TTL=1800000;
function providerConfigured(env:GenerationEnv){return !!env.GENERATION_OPENROUTER_API_KEY&&!!env.MEDIA;}
function enabled(env:GenerationEnv){return env.GENERATION_ENABLED==='true'&&providerConfigured(env)&&generationFx(env)!==undefined;}
function publicJob(row:JobRow){const reference=row.reference_json?JSON.parse(row.reference_json) as FrozenReference:undefined;return {id:row.id,kind:row.kind,modelId:row.model_id,prompt:row.prompt,...(row.template_id?{templateId:row.template_id}:{}),
  ...(reference?{referenceImage:{id:reference.id,name:reference.name,mimeType:reference.mimeType,byteLength:reference.byteLength,width:reference.width,height:reference.height,assetUrl:reference.assetUrl}}:{}),
  aspectRatio:row.aspect_ratio,...(row.duration!==null?{duration:row.duration}:{}),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,
  reservedCredits:row.finalized_at===null?row.reserved_credits:0,chargedCredits:row.charged_credits,expiresAt:row.expires_at,finalizedAt:row.finalized_at,
  costBasis:row.cost_basis,...(row.provider_cost_usd!==null?{providerCostUsd:row.provider_cost_usd}:{}),exceedsReservation:row.exceeds_reservation===1,
  ...(row.error_code?{error:row.error_code==='expired'?'生成结果未能确认，预留已返还。':row.error_code==='provider_rejected'?'生成服务拒绝了本次请求，预留已返还。':'暂时无法确认生成结果，请稍后刷新；不会重复提交。'}:{}),
  ...(row.status==='ready'&&row.deleted_at===null?{assetUrl:`/api/backend/v1/generation/assets/${row.id}`,mimeType:row.mime_type!}:{})};}
async function input(body:Record<string,unknown>,user:UserRecord,withRequest:boolean,env:GenerationEnv,now:number,prior?:JobRow|null):Promise<Input>{
  const allowed=['accountId','kind','modelId','prompt','aspectRatio','duration','templateId','referenceImageId',...(withRequest?['requestId','expectedMaxCredits']:[])];
  if(Object.keys(body).some(key=>!allowed.includes(key))||body.accountId!==user.id)throw new ApiError(body.accountId!==user.id?409:400,'生成请求参数无效或账户已变化。');
  const model=GENERATION_MODELS.find(m=>m.id===body.modelId&&m.kind===body.kind);
  if(!model||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.prompt)
    ||typeof body.aspectRatio!=='string'||!model.aspectRatios.includes(body.aspectRatio)
    ||(model.kind==='image'?body.duration!==undefined:typeof body.duration!=='number'||!model.durations.includes(body.duration))
    ||(body.templateId!==undefined&&(typeof body.templateId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.templateId)))
    ||(body.referenceImageId!==undefined&&(typeof body.referenceImageId!=='string'||!UUID.test(body.referenceImageId)))
    ||(withRequest&&(typeof body.requestId!=='string'||!UUID.test(body.requestId)||!Number.isSafeInteger(body.expectedMaxCredits)||Number(body.expectedMaxCredits)<1||Number(body.expectedMaxCredits)>1e9)))throw new ApiError(400,'请选择有效模型、画幅和时长，并输入4000字以内的提示。');
  const prompt=body.prompt.trim(),duration=model.kind==='video'?body.duration as number:undefined,templateId=body.templateId as string|undefined;
  let reference:FrozenReference|undefined,dataUrl:string|undefined;
  if(body.referenceImageId!==undefined){
    if(!model.supportsReferenceImage)throw new ApiError(400,'当前模型不支持参考图，请更换模型。',{code:'generation_reference_unsupported'});
    const frozen=prior?.reference_json?JSON.parse(prior.reference_json) as FrozenReference:undefined;
    if(frozen?.id===body.referenceImageId)reference=frozen;
    else{const row=await findReference(env,user.id,body.referenceImageId,now);reference=referenceSnapshot(row);dataUrl=await referenceDataUrl(env,row);}
  }
  return {kind:model.kind,model,prompt,aspectRatio:body.aspectRatio,duration,templateId,
    ...(reference?{reference,referenceDataUrl:dataUrl}:{}),
    fingerprint:digest(JSON.stringify({kind:model.kind,modelId:model.id,prompt,aspectRatio:body.aspectRatio,duration,templateId,...(reference?{referenceImage:{id:reference.id,contentHash:reference.contentHash}}:{}),...(withRequest?{expectedMaxCredits:body.expectedMaxCredits}:{})}))};
}
async function session(request:Request,env:GenerationEnv,user:UserRecord,now:number){
  const token=tokenFrom(request);if(!token)throw new ApiError(401,'登录状态已失效，请重新登录。');const hash=digest(token);
  const found=await env.DB.prepare(`SELECT u.is_guest FROM users u WHERE u.id=? AND ${SESSION_GATE}`).bind(user.id,hash,user.id,now).first<{is_guest:number}>();
  if(!found)throw new ApiError(401,'登录状态已失效，请重新登录。');return {hash,guest:found.is_guest===1};
}
async function lookup(env:GenerationEnv,userId:string,id:string){return env.DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND id=?').bind(userId,id).first<JobRow>();}
async function expire(env:GenerationEnv,userId:string,now:number){await env.DB.batch([
  env.DB.prepare(`UPDATE generation_jobs SET status='unknown',error_code='expired',finalized_at=MAX(created_at,?,${SQL_NOW}),updated_at=MAX(updated_at,?,${SQL_NOW}),cost_basis='released',poll_token=NULL
    WHERE user_id=? AND finalized_at IS NULL AND expires_at<=MAX(?,${SQL_NOW})`).bind(now,now,userId,now),
  env.DB.prepare(`INSERT INTO generation_credit_ledger(job_id,user_id,kind,credits,created_at) SELECT id,user_id,'release',0,finalized_at FROM generation_jobs
    WHERE user_id=? AND finalized_at IS NOT NULL AND cost_basis='released' ON CONFLICT(job_id) DO NOTHING`).bind(userId),
]);}
async function release(env:GenerationEnv,row:JobRow,now:number,error:string){await env.DB.batch([
  env.DB.prepare(`UPDATE generation_jobs SET status='failed',error_code=?,finalized_at=MAX(created_at,?,${SQL_NOW}),updated_at=MAX(updated_at,?,${SQL_NOW}),cost_basis='released',poll_token=NULL
    WHERE id=? AND user_id=? AND processing_token=? AND finalized_at IS NULL`).bind(error,now,now,row.id,row.user_id,row.processing_token),
  env.DB.prepare(`INSERT INTO generation_credit_ledger(job_id,user_id,kind,credits,created_at) SELECT id,user_id,'release',0,finalized_at FROM generation_jobs
    WHERE id=? AND user_id=? AND cost_basis='released' ON CONFLICT(job_id) DO NOTHING`).bind(row.id,row.user_id),
]);}
async function unknown(env:GenerationEnv,row:JobRow,now:number){await env.DB.prepare(`UPDATE generation_jobs SET status='unknown',error_code='provider_unknown',updated_at=MAX(updated_at,?),poll_token=NULL
  WHERE id=? AND user_id=? AND processing_token=? AND finalized_at IS NULL`).bind(now,row.id,row.user_id,row.processing_token).run();}
async function save(env:GenerationEnv,row:JobRow,bytes:Uint8Array,cost:number|undefined,now:number,pollToken?:string){
  const policy=readGenerationPolicy(row.policy_json);if(policy.modelId!==row.model_id||policy.maxCredits!==row.reserved_credits||policy.duration!==(row.duration??undefined)||(policy.referenceImages??0)!==(row.reference_json?1:0))throw new Error('Frozen job mismatch');
  const mime=assetType(bytes,row.kind),objectKey=`generation/${row.user_id}/${row.id}/${pollToken??row.processing_token}`;
  const actualUsd=cost??policy.estimatedUsd,raw=generationCharge(actualUsd,policy.usdToCny),charge=Math.min(row.reserved_credits,raw);
  await env.MEDIA!.put(objectKey,bytes,{httpMetadata:{contentType:mime},customMetadata:{ownerId:row.user_id,jobId:row.id,fingerprint:row.request_fingerprint}});
  // Object persistence precedes one transaction that publishes the private asset
  // and inserts its only charge. A lost batch response never rolls back a charge.
  try{await env.DB.batch([
    env.DB.prepare(`UPDATE generation_jobs SET status='ready',object_key=?,mime_type=?,byte_length=?,charged_credits=?,provider_cost_usd=?,cost_basis=?,
      exceeds_reservation=?,finalized_at=MAX(created_at,?,${SQL_NOW}),updated_at=MAX(updated_at,?,${SQL_NOW}),error_code=NULL,poll_token=NULL
      WHERE id=? AND user_id=? AND processing_token=? AND finalized_at IS NULL AND expires_at>MAX(?,${SQL_NOW}) ${pollToken?'AND poll_token=?':''}`)
      .bind(objectKey,mime,bytes.byteLength,charge,actualUsd,cost===undefined?'frozen_sku':'provider_usage',Number(raw>row.reserved_credits),now,now,row.id,row.user_id,row.processing_token,now,...(pollToken?[pollToken]:[])),
    env.DB.prepare(`INSERT INTO generation_credit_ledger(job_id,user_id,kind,credits,created_at) SELECT id,user_id,'charge',-charged_credits,finalized_at FROM generation_jobs
      WHERE id=? AND user_id=? AND status='ready' AND processing_token=? ON CONFLICT(job_id) DO NOTHING`).bind(row.id,row.user_id,row.processing_token),
  ]);}catch(error){const persisted=await lookup(env,row.user_id,row.id).catch(()=>null);if(persisted?.status==='ready'&&persisted.object_key===objectKey)return;throw error;}
  const latest=await lookup(env,row.user_id,row.id);if(latest?.status!=='ready'||latest.object_key!==objectKey){await env.MEDIA!.delete(objectKey).catch(()=>{});if(latest?.status!=='ready')await expire(env,row.user_id,now);}
}
async function create(request:Request,env:GenerationEnv,user:UserRecord,now:number,fetcher:GenerationFetch){
  const auth=await session(request,env,user,now),body=await readJson(request,20000);
  if(auth.guest)throw new ApiError(403,'请注册或登录后再生成。');
  await expire(env,user.id,now);
  const find=()=>env.DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND request_id=?').bind(user.id,body.requestId).first<JobRow>();
  const prior=typeof body.requestId==='string'&&UUID.test(body.requestId)?await find():null,parsed=await input(body,user,true,env,now,prior);if(prior){if(prior.request_fingerprint!==parsed.fingerprint)throw new ApiError(409,'该请求编号已用于另一条生成请求。');if(prior.deleted_at!==null)throw new ApiError(410,'该任务已清理，请新建生成请求。');return json({accountId:user.id,job:publicJob(prior)});}
  if(!enabled(env))throw new ApiError(503,'图片与视频生成尚未开通。');
  const policy=freezeGenerationPolicy(parsed.model,parsed.duration,generationFx(env)!,parsed.reference?1:0);
  // The client confirms a maximum, never supplies a tariff. Price/FX changes
  // between quote and creation require a fresh confirmation before any hold.
  if(body.expectedMaxCredits!==policy.maxCredits)throw new ApiError(409,'生成费用已变化，请重新获取报价并确认后再生成。',{code:'generation_quote_changed',maxCredits:policy.maxCredits});
  const id=crypto.randomUUID(),token=crypto.randomUUID();
  const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO generation_jobs(id,user_id,request_id,request_fingerprint,kind,model_id,prompt,template_id,aspect_ratio,duration,status,policy_json,reserved_credits,processing_token,created_at,updated_at,expires_at,reference_json)
      SELECT ?,u.id,?,?,?,?,?,?,?,?,'processing',?,?,?,?,?,?,? FROM users u JOIN credit_usage_balances b ON b.user_id=u.id
      WHERE u.id=? AND u.is_guest=0 AND ${SESSION_GATE} AND b.balance>=? AND ?>${SQL_NOW}
      AND (SELECT COUNT(*) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL AND expires_at>${SQL_NOW})<5
      ${parsed.reference?`AND EXISTS(SELECT 1 FROM generation_references WHERE id=? AND user_id=u.id AND content_hash=? AND deleted_at IS NULL AND expires_at>MAX(?,${SQL_NOW}))`:''}
      ON CONFLICT(user_id,request_id) DO NOTHING`)
      .bind(id,body.requestId,parsed.fingerprint,parsed.kind,parsed.model.id,parsed.prompt,parsed.templateId??null,parsed.aspectRatio,parsed.duration??null,
        JSON.stringify(policy),policy.maxCredits,token,now,now,now+TTL,parsed.reference?JSON.stringify(parsed.reference):null,user.id,auth.hash,user.id,now,policy.maxCredits,now+TTL,
        ...(parsed.reference?[parsed.reference.id,parsed.reference.contentHash,now]:[])),
    env.DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND request_id=?').bind(user.id,body.requestId),
  ]);
  const row=result[1].results[0] as unknown as JobRow|undefined;
  if(!row){await session(request,env,user,now);if(parsed.reference)await findReference(env,user.id,parsed.reference.id,now);const count=await env.DB.prepare(`SELECT COUNT(*) AS n FROM generation_jobs WHERE user_id=? AND finalized_at IS NULL AND expires_at>${SQL_NOW}`).bind(user.id).first<{n:number}>();
    throw new ApiError(count&&count.n>=5?429:402,count&&count.n>=5?'正在生成的任务过多，请先等待完成。':'可用 Credit 不足，请充值后重试。',{code:count&&count.n>=5?'generation_limit':'insufficient_credits',maxCredits:policy.maxCredits});}
  if(row.request_fingerprint!==parsed.fingerprint)throw new ApiError(409,'该请求编号已用于另一条生成请求。');
  if(result[0].meta.changes!==1)return json({accountId:user.id,job:publicJob(row)});
  try{
    const payload:Record<string,unknown>={model:policy.modelId,prompt:parsed.prompt,resolution:policy.resolution,aspect_ratio:parsed.aspectRatio,
      ...(parsed.kind==='image'?{n:1,...(policy.quality?{quality:policy.quality}:{})}:{duration:policy.duration,...(policy.generateAudio!==undefined?{generate_audio:policy.generateAudio}:{})})};
    if(parsed.reference){
      if(!parsed.referenceDataUrl)throw new Error('Missing frozen reference image');
      if(parsed.kind==='image')payload.input_references=[{type:'image_url',image_url:{url:parsed.referenceDataUrl}}];
      else payload.frame_images=[{type:'image_url',image_url:{url:parsed.referenceDataUrl},frame_type:'first_frame'}];
    }
    const output=await providerJson(fetcher,env.GENERATION_OPENROUTER_API_KEY!,parsed.kind==='image'?'images':'videos',payload);
    if(parsed.kind==='image')await save(env,row,await imageBytes(output,fetcher),providerCost(output),now);
    else{
      const providerId=output.id;if(typeof providerId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(providerId))throw new Error('Invalid provider video id');
      await env.DB.prepare(`UPDATE generation_jobs SET provider_job_id=?,status='processing',updated_at=MAX(updated_at,?) WHERE id=? AND user_id=? AND processing_token=? AND finalized_at IS NULL`)
        .bind(providerId,now,row.id,user.id,token).run();
    }
  }catch(error){if(error instanceof ProviderRejected)await release(env,row,now,'provider_rejected');else await unknown(env,row,now);}
  return json({accountId:user.id,job:publicJob((await lookup(env,user.id,row.id))!)},201);
}
async function refresh(env:GenerationEnv,row:JobRow,now:number,fetcher:GenerationFetch):Promise<JobRow>{
  // An already submitted job settles using its frozen policy, even while new generation is paused.
  if(row.finalized_at!==null||row.kind!=='video'||!row.provider_job_id||!providerConfigured(env))return row;
  const pollToken=crypto.randomUUID();
  const claim=await env.DB.prepare(`UPDATE generation_jobs SET poll_token=?,poll_started_at=? WHERE id=? AND user_id=? AND finalized_at IS NULL
    AND expires_at>MAX(?,${SQL_NOW}) AND (poll_token IS NULL OR poll_started_at<=?) AND poll_started_at<=?`)
    .bind(pollToken,now,row.id,row.user_id,now,now-180000,now-2000).run();
  if(claim.meta.changes!==1)return row;
  try{
    const output=await providerJson(fetcher,env.GENERATION_OPENROUTER_API_KEY!,'videos/'+encodeURIComponent(row.provider_job_id));
    if(output.id!==row.provider_job_id)throw new Error('Provider task mismatch');
    if(output.status==='completed'){
      const response=await fetcher(OPENROUTER_ORIGIN+'/api/v1/videos/'+encodeURIComponent(row.provider_job_id)+'/content?index=0',{headers:{Authorization:`Bearer ${env.GENERATION_OPENROUTER_API_KEY}`},redirect:'manual',signal:AbortSignal.timeout(90000)});
      await save(env,row,await boundedBytes(response,100*1024*1024),providerCost(output),now,pollToken);
    }else if(output.status==='failed')await release(env,row,now,'provider_rejected');
    else if(['queued','in_progress','pending','processing'].includes(String(output.status)))await env.DB.prepare("UPDATE generation_jobs SET status='processing',updated_at=MAX(updated_at,?),poll_token=NULL,error_code=NULL WHERE id=? AND user_id=? AND poll_token=? AND finalized_at IS NULL").bind(now,row.id,row.user_id,pollToken).run();
    else throw new Error('Unknown provider status');
  }catch{await env.DB.prepare("UPDATE generation_jobs SET status='unknown',error_code='provider_unknown',updated_at=MAX(updated_at,?),poll_token=NULL WHERE id=? AND user_id=? AND poll_token=? AND finalized_at IS NULL").bind(now,row.id,row.user_id,pollToken).run();}
  return (await lookup(env,row.user_id,row.id))!;
}
async function asset(request:Request,env:GenerationEnv,row:JobRow){
  if(!env.MEDIA||row.status!=='ready'||row.deleted_at!==null)throw new ApiError(404,'素材不存在。');
  const range=request.headers.get('Range'),size=row.byte_length!;
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range),start=m?.[1]?Number(m[1]):null,end=m?.[2]?Number(m[2]):null;
    if(!m||(start===null&&end===null)||(start!==null&&(!Number.isSafeInteger(start)||start>=size))||(end!==null&&(!Number.isSafeInteger(end)||(start===null?end<=0:end<start))))
      return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Cache-Control':'private, no-store'}});}
  const object=await env.MEDIA.get(row.object_key!,range?{range:request.headers}:undefined);
  if(!object||!('body'in object)||object.size!==size||object.customMetadata?.ownerId!==row.user_id||object.customMetadata?.jobId!==row.id||object.customMetadata?.fingerprint!==row.request_fingerprint)throw new ApiError(404,'素材暂时不可用。');
  const latest=await lookup(env,row.user_id,row.id);if(!latest||latest.deleted_at!==null||latest.status!=='ready'||latest.object_key!==row.object_key)throw new ApiError(404,'素材不存在。');
  const headers=new Headers({'Content-Type':row.mime_type!,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",
    'Content-Disposition':`inline; filename="${row.id}.${row.mime_type==='video/mp4'?'mp4':row.mime_type==='image/png'?'png':row.mime_type==='image/webp'?'webp':'jpg'}"`});
  if(range&&object.range&&'offset'in object.range&&'length'in object.range){const offset=object.range.offset??0,length=object.range.length??size;headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${size}`);headers.set('Content-Length',String(length));return new Response(object.body as unknown as ReadableStream<Uint8Array>,{status:206,headers});}
  headers.set('Content-Length',String(size));return new Response(object.body as unknown as ReadableStream<Uint8Array>,{headers});
}
export async function handleGeneration(request:Request,env:GenerationEnv,user:UserRecord,options:GenerationOptions={}):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname;if(path!=='/v1/generation'&&!path.startsWith('/v1/generation/'))return null;
  if(url.search)throw new ApiError(400,'生成接口不支持查询参数。');const now=options.now?.()??Date.now(),fetcher=options.fetch??fetch;
  await session(request,env,user,now);
  const studioStill=await handleStudioStillBilling(request,env,user,now);if(studioStill)return studioStill;
  const referenceResponse=await handleGenerationReferences(request,env,user,now);if(referenceResponse)return referenceResponse;
  if(path==='/v1/generation/config'){
    if(request.method!=='GET')throw new ApiError(405,'此接口仅支持GET。');const fx=generationFx(env);
    return json({accountId:user.id,enabled:enabled(env),models:GENERATION_MODELS.map(model=>({id:model.id,label:model.label,kind:model.kind,aspectRatios:model.aspectRatios,resolutions:model.resolutions,durations:model.durations,supportsReferenceImage:model.supportsReferenceImage,
      ...(fx!==undefined?{estimatedCredits:freezeGenerationPolicy(model,model.kind==='video'?model.durations.includes(5)?5:model.durations[0]:undefined,fx).estimatedCredits}:{})})),costMultiplier:3});
  }
  if(path==='/v1/generation/quote'){
    if(request.method!=='POST')throw new ApiError(405,'此接口仅支持POST。');const auth=await session(request,env,user,now),p=await input(await readJson(request,20000),user,false,env,now);
    if(auth.guest)throw new ApiError(403,'请注册或登录后再生成。');if(!enabled(env))throw new ApiError(503,'图片与视频生成尚未开通。');const policy=freezeGenerationPolicy(p.model,p.duration,generationFx(env)!,p.reference?1:0);
    return json({accountId:user.id,quote:{estimatedCredits:policy.estimatedCredits,maxCredits:policy.maxCredits}});
  }
  if(path==='/v1/generation/jobs'){
    if(request.method==='POST')return create(request,env,user,now,fetcher);
    if(request.method!=='GET')throw new ApiError(405,'此接口仅支持GET或POST。');await expire(env,user.id,now);
    const rows=await env.DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 100').bind(user.id).all<JobRow>();return json({accountId:user.id,jobs:rows.results.map(publicJob)});
  }
  const recovery=/^\/v1\/generation\/requests\/([a-f0-9-]{36})$/i.exec(path);
  if(recovery&&UUID.test(recovery[1])){
    if(request.method!=='GET')throw new ApiError(405,'此接口仅支持GET。');
    await expire(env,user.id,now);
    const row=await env.DB.prepare('SELECT * FROM generation_jobs WHERE user_id=? AND request_id=?').bind(user.id,recovery[1]).first<JobRow>();
    if(!row)throw new ApiError(404,'原生成请求尚未找到，请重新核对后获取报价。',{code:'generation_request_missing'});
    if(row.deleted_at!==null)throw new ApiError(410,'该任务已清理，请新建生成请求。');
    return json({accountId:user.id,job:publicJob(row)});
  }
  const match=/^\/v1\/generation\/(jobs|assets)\/([a-f0-9-]{36})$/i.exec(path);if(!match||!UUID.test(match[2]))throw new ApiError(404,'生成接口不存在。');
  await expire(env,user.id,now);let row=await lookup(env,user.id,match[2]);if(!row||row.deleted_at!==null)throw new ApiError(404,'任务不存在。');
  if(match[1]==='assets'){if(request.method!=='GET')throw new ApiError(405,'此接口仅支持GET。');return asset(request,env,row);}
  if(request.method==='DELETE'){
    if(row.finalized_at===null)throw new ApiError(409,'任务尚未完成，请稍后清理。');await env.DB.prepare('UPDATE generation_jobs SET deleted_at=?,updated_at=MAX(updated_at,?) WHERE id=? AND user_id=? AND finalized_at IS NOT NULL AND deleted_at IS NULL').bind(now,now,row.id,user.id).run();
    if(row.object_key&&env.MEDIA)await env.MEDIA.delete(row.object_key).catch(()=>{});return json({accountId:user.id,deleted:true});
  }
  if(request.method!=='GET')throw new ApiError(405,'此接口仅支持GET或DELETE。');row=await refresh(env,row,now,fetcher);return json({accountId:user.id,job:publicJob(row)});
}
