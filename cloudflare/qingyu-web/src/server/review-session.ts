import {ContentError} from './policy';
/** Authenticate before any paid review; the backend remains the identity authority. */
export async function requireReviewSession(request:Request,sessionFetch:(request:Request)=>Promise<Response>){
 const cookie=(request.headers.get('Cookie')??'').split(';').map(value=>value.trim()).find(value=>/^qingyu_session=[^;\s]+$/.test(value));
 if(!cookie)throw new ContentError(401,'请先建立会话，再保存或发布内容。');
 let response:Response;
 try{response=await sessionFetch(new Request('https://qingyu-backend.internal/v1/session',{headers:{Cookie:cookie},signal:request.signal}));}
 catch{throw new ContentError(503,'账户服务暂时不可用。');}
 if(!response.ok){await response.body?.cancel();throw new ContentError(response.status===401?401:503,'账户会话暂不可用，请刷新后重试。');}
 const value=await response.json().catch(()=>null)as {user?:{id?:unknown}}|null;
 if(!value?.user||typeof value.user.id!=='string'||!value.user.id)throw new ContentError(401,'账户会话已失效，请刷新后重试。');
}
