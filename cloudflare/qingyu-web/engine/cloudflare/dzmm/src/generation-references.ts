import { createHash } from 'node:crypto';
import { ApiError, json, readJson } from './http';
import { rateLimit } from './auth';
import type { Env, UserRecord } from './types';
import { assetType, boundedBytes } from './generation-provider';

export const REFERENCE_MAX_BYTES=512*1024*1024;
export const REFERENCE_TTL=30*86400000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type ReferenceRow={id:string;user_id:string;name:string;mime_type:string;byte_length:number;width:number;height:number;content_hash:string;object_key:string;created_at:number;expires_at:number;deleted_at:number|null};
export function publicReference(row:ReferenceRow){return {id:row.id,name:row.name,mimeType:row.mime_type,byteLength:row.byte_length,width:row.width,height:row.height,
  assetUrl:`/api/backend/v1/generation/reference-assets/${row.id}`};}
export function referenceSnapshot(row:ReferenceRow){return {...publicReference(row),contentHash:row.content_hash};}
export function referenceHash(bytes:Uint8Array){return createHash('sha256').update(bytes).digest('hex');}
export function parseReferenceImage(dataUrl:unknown){
  if(typeof dataUrl!=='string')throw new ApiError(400,'参考图须为有效的 PNG、JPEG 或 WebP 图片。');
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if(match && match[2].length > 4*Math.ceil(REFERENCE_MAX_BYTES/3)) throw new ApiError(413,'参考图文件过大。');
  if(!match||!match[2]||match[2].length%4!==0)throw new ApiError(400,'参考图须为有效的 PNG、JPEG 或 WebP 图片。');
  let binary:string;try{binary=atob(match[2]);}catch{throw new ApiError(400,'参考图编码无效。');}
  if(btoa(binary)!==match[2])throw new ApiError(400,'参考图编码无效。');
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));if(!bytes.length)throw new ApiError(400,'参考图须为有效的 PNG、JPEG 或 WebP 图片。');
  if(bytes.byteLength>REFERENCE_MAX_BYTES) throw new ApiError(413,'参考图文件过大。');
  let mime:string;try{mime=assetType(bytes,'image');}catch{throw new ApiError(400,'参考图内容与文件类型不匹配。');}
  if(mime!==match[1])throw new ApiError(400,'参考图内容与文件类型不匹配。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0;
  if(mime==='image/png'){
    if(bytes.length<45||view.getUint32(8)!==13||new TextDecoder().decode(bytes.subarray(bytes.length-8,bytes.length-4))!=='IEND')throw new ApiError(400,'参考图文件不完整。');
    width=view.getUint32(16);height=view.getUint32(20);
  }else if(mime==='image/jpeg'){
    let p=2;while(p+4<=bytes.length){if(bytes[p++]!==255)break;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;const length=view.getUint16(p);if(length<2||p+length>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=view.getUint16(p+3);width=view.getUint16(p+5);break;}p+=length;}
  }else{
    if(view.getUint32(4,true)+8!==bytes.length)throw new ApiError(400,'参考图文件不完整。');
    const chunk=new TextDecoder().decode(bytes.subarray(12,16));
    if(chunk==='VP8X'&&bytes.length>=30){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
    else if(chunk==='VP8L'&&bytes.length>=25&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
    else if(chunk==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}
  }
  if(!width||!height||width>8192||height>8192||width*height>20_000_000)throw new ApiError(400,'参考图尺寸须不超过 8192 像素且总像素不超过 2000 万。');
  return {bytes,mime,width,height,hash:referenceHash(bytes)};
}
export async function findReference(env:Env,userId:string,id:unknown,now:number){
  if(typeof id!=='string'||!UUID.test(id))throw new ApiError(400,'参考图编号无效。');
  const row=await env.DB.prepare('SELECT * FROM generation_references WHERE user_id=? AND id=? AND deleted_at IS NULL AND expires_at>?').bind(userId,id,now).first<ReferenceRow>();
  if(!row)throw new ApiError(404,'参考图已移除或过期，请重新上传。',{code:'generation_reference_missing'});return row;
}
export async function referenceDataUrl(env:Env,row:ReferenceRow){
  if(!env.MEDIA)throw new ApiError(503,'参考图存储尚未启用。');const object=await env.MEDIA.get(row.object_key);
  if(!object||!('body'in object)||object.size!==row.byte_length||object.customMetadata?.ownerId!==row.user_id||object.customMetadata?.referenceId!==row.id||object.customMetadata?.contentHash!==row.content_hash)throw new ApiError(404,'参考图文件暂时不可用，请重新上传。',{code:'generation_reference_missing'});
  const bytes=await boundedBytes(new Response(object.body as unknown as ReadableStream<Uint8Array>),REFERENCE_MAX_BYTES);
  if(bytes.length!==row.byte_length||referenceHash(bytes)!==row.content_hash)throw new ApiError(404,'参考图文件暂时不可用，请重新上传。',{code:'generation_reference_missing'});
  // Private uploads are forwarded only in the authenticated supplier request.
  // No public object URL, bearer token, or platform secret reaches the browser.
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return `data:${row.mime_type};base64,${btoa(binary)}`;
}
async function cleanExpiredReferences(env:Env,userId:string,now:number){
  if(!env.MEDIA)return;
  const rows=await env.DB.prepare('SELECT id,object_key FROM generation_references WHERE user_id=? AND (deleted_at IS NOT NULL OR expires_at<=?) LIMIT 20').bind(userId,now).all<{id:string;object_key:string}>();
  for(const row of rows.results){
    // Keep the tombstone if deletion fails, so a later upload retries cleanup.
    // Frozen job JSON carries identity independently of this upload row.
    try{await env.MEDIA.delete(row.object_key);await env.DB.prepare('DELETE FROM generation_references WHERE user_id=? AND id=? AND (deleted_at IS NOT NULL OR expires_at<=?)').bind(userId,row.id,now).run();}catch{/* Bounded best-effort cleanup does not discard another upload. */}
  }
  // Expiry is also part of the object key. This bounded own-prefix sweep can
  // reclaim an upload whose SQL acknowledgment/verification both stayed unknown.
  try{const prefix=`generation-reference/${userId}/`,objects=await env.MEDIA.list({prefix,limit:20});
    for(const object of objects.objects){const suffix=object.key.slice(prefix.length),match=/^(\d{13})\/[a-f0-9-]{36}$/.exec(suffix);if(match&&Number(match[1])<=now)await env.MEDIA.delete(object.key);}}
  catch{/* A later upload retries the expired own-prefix objects. */}
}
export async function handleGenerationReferences(request:Request,env:Env,user:UserRecord,now:number):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(path==='/v1/generation/references'){
    if(request.method!=='POST')throw new ApiError(405,'此接口仅支持 POST。');
    if(user.isGuest)throw new ApiError(403,'请注册或登录后再上传参考图。');if(!env.MEDIA)throw new ApiError(503,'参考图存储尚未启用。');
    await rateLimit(request,env,'generation-reference-upload',20,user.id);
    await cleanExpiredReferences(env,user.id,now);
    const body=await readJson(request,REFERENCE_MAX_BYTES);
    if(Object.keys(body).some(key=>!['accountId','name','dataUrl'].includes(key))||body.accountId!==user.id)throw new ApiError(body.accountId!==user.id?409:400,'参考图请求参数无效或账户已变化。');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||/[\x00-\x1f\x7f/\\]/.test(body.name))throw new ApiError(400,'参考图名称无效，请使用 100 字以内的文件名。');
    const image=parseReferenceImage(body.dataUrl),id=crypto.randomUUID(),key=`generation-reference/${user.id}/${now+REFERENCE_TTL}/${id}`;
    const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_references WHERE user_id=? AND deleted_at IS NULL AND expires_at>?').bind(user.id,now).first<{n:number}>();
    if(count&&count.n>=50)throw new ApiError(429,'参考图数量已达上限，请先移除不再使用的参考图。');
    const row:ReferenceRow={id,user_id:user.id,name:body.name.trim(),mime_type:image.mime,byte_length:image.bytes.length,width:image.width,height:image.height,content_hash:image.hash,object_key:key,created_at:now,expires_at:now+REFERENCE_TTL,deleted_at:null};
    await env.MEDIA.put(key,image.bytes,{httpMetadata:{contentType:image.mime},customMetadata:{ownerId:user.id,referenceId:id,contentHash:image.hash}});
    try{const inserted=await env.DB.prepare(`INSERT INTO generation_references(id,user_id,name,mime_type,byte_length,width,height,content_hash,object_key,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM generation_references WHERE user_id=? AND deleted_at IS NULL AND expires_at>?)<50`)
      .bind(id,user.id,row.name,row.mime_type,row.byte_length,row.width,row.height,row.content_hash,key,now,row.expires_at,user.id,now).run();
      if(inserted.meta.changes!==1)throw new ApiError(429,'参考图数量已达上限，请先移除不再使用的参考图。');}
    catch(error){let provenAbsent=false;try{provenAbsent=!(await env.DB.prepare('SELECT id FROM generation_references WHERE id=? AND user_id=?').bind(id,user.id).first());}catch{/* An unavailable confirmation cannot prove the INSERT rolled back. */}
      if(provenAbsent)await env.MEDIA.delete(key).catch(()=>{});throw error;}
    return json({accountId:user.id,reference:publicReference(row)},201);
  }
  const match=/^\/v1\/generation\/(references|reference-assets)\/([a-f0-9-]{36})$/i.exec(path);if(!match)return null;
  const row=await findReference(env,user.id,match[2],now);
  if(match[1]==='reference-assets'){
    if(request.method!=='GET')throw new ApiError(405,'此接口仅支持 GET。');
    const data=await referenceDataUrl(env,row),bytes=Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),char=>char.charCodeAt(0));
    return new Response(bytes,{headers:{'Content-Type':row.mime_type,'Content-Length':String(row.byte_length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`inline; filename="${row.id}.${row.mime_type==='image/png'?'png':row.mime_type==='image/webp'?'webp':'jpg'}"`}});
  }
  if(request.method==='GET')return json({accountId:user.id,reference:publicReference(row)});
  if(request.method!=='DELETE')throw new ApiError(405,'此接口仅支持 GET 或 DELETE。');
  const result=await env.DB.prepare(`UPDATE generation_references SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM generation_jobs WHERE user_id=? AND finalized_at IS NULL AND expires_at>MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND reference_json IS NOT NULL AND json_extract(reference_json,'$.id')=?)`).bind(now,row.id,user.id,user.id,now,row.id).run();
  if(result.meta.changes!==1)throw new ApiError(409,'参考图正在用于未完成的任务，请任务结束后再移除。',{code:'generation_reference_in_use'});
  await env.MEDIA?.delete(row.object_key).catch(()=>{});return json({accountId:user.id,deleted:true});
}
