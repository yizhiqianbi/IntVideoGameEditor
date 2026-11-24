const $ = id => document.getElementById(id);
let csrf = '', avatar = '', references = [], session = null, engine = null, configured = false, count = 0, toastTimer, currentOwner = false;
const tasks = new Map(), polling = new Set(), remoteUsers = new Set();
let mediaDeadline, executing=false, sessionError="";
const safeUrl = url => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };
function notify(message) { $('toast').textContent = String(message).replace(/vidu/gi,'直播平台'); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
function log(message) { const p = document.createElement('div'); p.textContent = `${new Date().toLocaleTimeString()} ${String(message).replace(/vidu/gi,'直播平台')}`; $('log').prepend(p); while ($('log').children.length > 60) $('log').lastChild.remove(); }
function friendlyError(message) {
  const value=String(message || '请求失败').replace(/vidu/gi,'直播平台');
  if (/failed to connect qwen realtime websocket/i.test(value)) return '直播服务连接 Qwen 实时服务失败，直播未能初始化。请稍后重新开播。';
  if (/Unexpected end of JSON input|Unexpected token.*JSON/i.test(value)) return '接口返回了空内容或无效 JSON，无法确认操作结果。请查看连接日志和直播状态后再重试。';
  return value;
}
async function readResponse(res) {
  const raw=await res.text(); let data;
  if (!raw.trim()) throw new Error('接口返回空内容（HTTP '+res.status+'），无法确认操作结果，请检查直播状态后再重试');
  try {data=JSON.parse(raw);} catch {throw new Error('接口返回格式异常（HTTP '+res.status+'），请稍后重试');}
  if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('接口返回格式异常（HTTP '+res.status+'）');
  if (!res.ok) throw new Error(friendlyError(data.error || '请求失败（HTTP '+res.status+'）'));
  return data;
}
async function api(route, body = {}) { const res = await fetch('/api/'+route, { method: 'POST', headers: { 'Content-Type':'application/json', 'X-Studio-Token':csrf }, body: JSON.stringify(body) }); return readResponse(res); }
function action(fn) { return async event => { try { await fn(event); } catch (error) { notify(friendlyError(error.message)); log(error.message); } }; }
async function loadImage(file) {
  if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  if (file.size > 5 * 1024 * 1024) throw new Error('图片请小于 5 MB');
  const url = await new Promise((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('图片读取失败')); r.readAsDataURL(file); });
  const img = new Image(); img.src = url; await img.decode();
  if (img.width < 128 || img.height < 128 || img.width / img.height >= 4 || img.height / img.width >= 4) throw new Error('图片至少 128 × 128，长宽比在 1:4 到 4:1 之间');
  return url;
}
function setAvatar(url) { avatar = url; $('avatarPreview').src = url; $('avatarPreview').hidden = false; $('avatarHint').hidden = true; }
$('avatarInput').onchange = action(async e => { if(e.target.files[0]) setAvatar(await loadImage(e.target.files[0])); });
$('referenceInput').onchange = action(async e => {
  const files = [...e.target.files]; if (files.length + references.length > 3) throw new Error('最多添加 3 张动态参考图');
  for (const f of files) references.push({ url:await loadImage(f), kind:'object', description:'' });
  renderReferences(); e.target.value = '';
});
function renderReferences() {
  $('references').replaceChildren();
  if (!references.length) { const p = document.createElement('p'); p.className='empty-small'; p.textContent='添加素材，让直播画面随你变化。'; $('references').append(p); }
  references.forEach((ref, i) => {
    const div = document.createElement('div'); div.className='ref';
    const img = new Image(); img.src=ref.url; img.alt='动态参考图';
    const fields = document.createElement('div'), select = document.createElement('select'); select.setAttribute('aria-label','参考图类型');
    for (const [value,label] of [['object','物品'],['garment','服装'],['background','背景']]) select.add(new Option(label,value));
    select.value=ref.kind; select.onchange=()=> ref.kind=select.value;
    const desc=document.createElement('input'); desc.placeholder='希望如何变化'; desc.setAttribute('aria-label','参考图说明'); desc.value=ref.description; desc.oninput=()=>ref.description=desc.value;
    fields.append(select,desc); const remove=document.createElement('button'); remove.textContent='×'; remove.setAttribute('aria-label','移除参考图'); remove.onclick=()=>{references.splice(i,1);renderReferences();};
    div.append(img,fields,remove); $('references').append(div);
  });
}
async function leaveRtc() { clearTimeout(mediaDeadline); remoteUsers.clear(); const old = engine; engine=null; if(old) { try { await old.leaveChannel(); } catch {} try { old.destroy(); } catch {} } $('remote').replaceChildren(); $('placeholder').hidden=false; }
function updateSession(value) {
  if (value?.id!==session?.id || value?.status==='ready') sessionError='';
  session=value; const active=session && session.status!=='ended', ready=active && session.status==='ready';
  for(const id of ['send','interrupt','applyRefs','clearRefs']) $(id).disabled=!ready;
  $('execute').disabled=!ready||executing;
  $('recording').disabled=session?.mode!=='real';
  $('stop').disabled=!active; $('start').disabled=Boolean(active); $('mode').disabled=Boolean(active);
  $('status').textContent = !session ? '本地工作台' : session.status==='ended' ? session.reason || '直播结束' : session.mode==='rehearsal' ? '本地演练中' : ready ? 'S2 控制已连接' : '正在连接 S2';
  const errorBox=$('sessionError'); errorBox.textContent=sessionError; errorBox.hidden=!sessionError;
  $('lamp').classList.toggle('active',Boolean(ready));
  $('modeBadge').textContent=active ? (session.mode==='rehearsal' ? 'REHEARSAL' : 'S2 / LIVE') : 'STANDBY';
  if (session?.mode==='rehearsal' && active) $('mediaStatus').textContent='本地演练 · 不生成视频';
  if (!active) { currentOwner=false; void leaveRtc(); $('mediaStatus').textContent='等待视频输入'; }
}
async function joinRtc(rtc) {
  if(!rtc?.token || !rtc.user_id) throw new Error('平台未返回有效 RTC 凭证');
  if (!window.AliRtcEngine) throw new Error('RTC SDK 加载失败');
  const support = await window.AliRtcEngine.isSupported(); if(!support.support) throw new Error('当前浏览器不支持 RTC，请使用最新版 Chrome');
  engine=window.AliRtcEngine.getInstance(); const rtcEngine=engine;
  rtcEngine.on('remoteUserOnLineNotify',uid=>remoteUsers.add(uid));
  rtcEngine.on('remoteUserOffLineNotify',uid=>remoteUsers.delete(uid));
  rtcEngine.on('remoteAudioAutoPlayFail',uid=>{remoteUsers.add(uid);notify('浏览器暂停了声音，请点击「开启播放声音」');});
  rtcEngine.on('remoteVideoAutoPlayFail',()=>notify('浏览器暂停了视频，请点击「开启播放声音」')); 
  await rtcEngine.publishLocalAudioStream(false); await rtcEngine.publishLocalVideoStream(false);
  rtcEngine.on('videoSubscribeStateChanged',(uid,oldState,newState)=>{
    if(engine!==rtcEngine) return;
    if(newState===3) {
      remoteUsers.add(uid);
      let video = [...$('remote').children].find(v=>v.dataset.uid===uid);
      if(!video) {video=document.createElement('video'); video.dataset.uid=uid;video.autoplay=true;video.playsInline=true;video.muted=true;$('remote').append(video);}
      rtcEngine.setRemoteViewConfig(video,uid,1);
      video.onplaying=()=>{ clearTimeout(mediaDeadline); $('placeholder').hidden=true; $('mediaStatus').textContent='实时视频已接收'; };
      video.play().catch(()=>notify('点击「开启播放声音」开始播放'));
    } else if(newState===1) { const video=[...$('remote').children].find(v=>v.dataset.uid===uid); video?.remove(); if(!$('remote').children.length){$('placeholder').hidden=false;$('mediaStatus').textContent='等待远端视频恢复';} }
  });
  rtcEngine.on('bye',()=>{ if(engine===rtcEngine) {notify('RTC 已断开，直播已请求结束');void api('stop').catch(e=>notify(e.message));void leaveRtc();} });
  rtcEngine.on('authInfoExpired',()=>{notify('RTC 凭证过期，请重新开播');void api('stop').catch(e=>notify(e.message));});
  await rtcEngine.joinChannel(rtc.token,rtc.user_id);
  if(engine!==rtcEngine || session?.status==='ended') { await rtcEngine.leaveChannel(); return; }
  $('mediaStatus').textContent='RTC 已连接 · 等待首帧';log('RTC 加入成功');
  mediaDeadline=setTimeout(()=>{if(engine===rtcEngine && $('placeholder').hidden===false){notify('60 秒内未收到视频首帧，已请求结束；请检查 S2 权限和网络');void api('stop').catch(e=>notify(e.message));void leaveRtc();}},60000);
}
$('mode').onchange=()=>{$('start').textContent=$('mode').value==='real'?'开始直播 ↗':'开始演练 ↗';};
$('start').onclick=action(async()=>{
  if(!avatar) throw new Error('请先上传主播形象');
  if($('mode').value==='real' && !configured){$('settings').showModal();return;}
  sessionError='';$('sessionError').hidden=true;$('status').textContent='正在请求开播';
  $('start').disabled=true;
  try {
    const result=await api('start',{mode:$('mode').value,avatar,control:'performance',persona:$('persona').value,voice:$('voice').value});
    currentOwner=true; updateSession(result.session);
    if(result.rtc) { try {await joinRtc(result.rtc);} catch(e){await api('stop');await leaveRtc();throw e;} }
    else if(result.session.mode==='real'){await api('stop');throw new Error('平台未返回 RTC 信息，已结束会话');}
  } catch(error) {sessionError='本次开播失败：'+friendlyError(error.message);$('sessionError').textContent=sessionError;$('sessionError').hidden=false;$('status').textContent='本次开播请求失败';throw error;} finally { if(!session || session.status==='ended') $('start').disabled=false; }
});
$('stop').onclick=action(async()=>{await api('stop');await leaveRtc();});
$('applyRefs').onclick=action(async()=>{await api('references',{images:references});});
$('clearRefs').onclick=action(async()=>{await api('references',{remove:true});});
$('interrupt').onclick=action(async()=>{await api('interrupt');notify('已发送打断请求');});
$('chatForm').onsubmit=action(async e=>{e.preventDefault();await api('danmaku',{name:$('name').value,text:$('message').value});$('message').value='';});
$('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chatForm').requestSubmit();}};
for(const button of document.querySelectorAll('[data-motion]')) button.onclick=()=>{$('motion').value=button.dataset.motion;$('motion').focus();};
$('directorForm').onsubmit=action(async e=>{
  e.preventDefault(); if(executing)return; executing=true; $('execute').disabled=true;
  try {await api('execute',{intent:$('intent').value,emotion:$('emotion').value,motion:$('motion').value});notify(session?.mode==='rehearsal'?'指令演练通过 · 未调用 S2':'已发送表演指令');}
  finally {executing=false;updateSession(session);}
});
function addMessage(name,text,delivery) {
  if(!text) return; document.querySelector('.empty-chat')?.remove();
  const div=document.createElement('div');div.className='message';
  const meta=document.createElement('div');meta.className='meta';const who=document.createElement('span'),time=document.createElement('span');who.textContent=name;time.textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});meta.append(who,time);
  const p=document.createElement('p');p.textContent=text;const small=document.createElement('small');small.textContent=delivery||'';div.append(meta,p,small);$('messages').append(div);
  while($('messages').children.length>100)$('messages').firstChild.remove();$('messages').scrollTop=$('messages').scrollHeight;$('messageCount').textContent=String(++count);
}
function handleEvent(event) {
  if(event.type==='session') updateSession(event.data);
  else if(event.type==='start_error'){sessionError='本次开播失败：'+friendlyError(event.data.message);$('sessionError').textContent=sessionError;$('sessionError').hidden=false;$('status').textContent='本次开播请求失败';log(sessionError);}
  else if(event.type==='direction') addMessage('导演','方向：'+(event.data.intent||'（无）')+'；情绪：'+(event.data.emotion||'（无）')+'；动作：'+(event.data.motion||'（无）'),event.data.rehearsal?'本地演练 · 动作未生成':'已发送至 S2');
  else if(event.type==='danmaku') {
    const {name,text,delivery}=event.data;addMessage(name,text,delivery);
    const span=document.createElement('span');span.className='danmaku';span.textContent=`${name}：${text}`;span.style.top=`${15+Math.random()*50}%`;$('overlays').append(span);setTimeout(()=>span.remove(),8000);
  } else if(event.type==='transcript') addMessage(event.data.role,event.data.text,'S2 实时转写');
  else if(event.type==='reference'){const d=event.data;const msg=d.pending?d.message:d.success?'参考图已生效':`参考图失败：${d.error_msg||d.error_code}`;notify(msg);log(msg);}
  else if(event.type==='error'){sessionError=friendlyError(event.data);$('sessionError').textContent=sessionError;$('sessionError').hidden=false;notify(sessionError);log(event.data);}
  else if(event.type==='task'){tasks.set(event.data.id,event.data);renderTasks();}
}
function renderTasks() {
  $('tasks').replaceChildren();
  for(const task of [...tasks.values()].reverse()) {
    const div=document.createElement('div');div.className='task';
    const title=document.createElement('div');title.textContent=`${task.kind==='image'?'参考图':'视频'} · ${task.state}`;div.append(title);
    if(task.error){const p=document.createElement('p');p.textContent=task.error;div.append(p);}
    for(const creation of task.creations||[]) {
      if(!safeUrl(creation.url))continue;
      const media=document.createElement(task.kind==='image'?'img':'video');media.src=creation.url;
      if(task.kind==='video')media.controls=true;else media.alt='生成的参考图';div.append(media);
      const link=document.createElement('a');link.textContent='打开原文件 ↗';link.href=creation.url;link.target='_blank';link.rel='noreferrer';div.append(link);
      if(task.kind==='image'){
        const use=document.createElement('button');use.textContent='用作参考图';use.onclick=action(async()=>{if(references.length>=3)throw new Error('请先移除一张参考图');references.push({url:creation.url,kind:'object',description:''});renderReferences();notify('已加入动态参考图');});
        const avatarButton=document.createElement('button');avatarButton.textContent='用作主播';avatarButton.onclick=()=>setAvatar(creation.url);div.append(use,avatarButton);
      }
    }
    if(!['success','failed'].includes(task.state)) {const refresh=document.createElement('button');refresh.textContent='刷新状态';refresh.onclick=action(()=>api('task',{id:task.id}));div.append(refresh);}
    $('tasks').append(div);
  }
}
async function generate(kind) {
  if(!configured){$('settings').showModal();return;}
  const id=kind==='image'?'generateImage':'generateVideo';$(id).disabled=true;
  try { const task=await api('generate',{kind,prompt:$('prompt').value,images:references.length ? references.map(r=>r.url) : avatar ? [avatar] : []});tasks.set(task.id,task);renderTasks();notify('已提交生成任务'); } finally {$(id).disabled=false;}
}
$('generateImage').onclick=action(()=>generate('image'));$('generateVideo').onclick=action(()=>generate('video'));
setInterval(()=>{
  for(const task of tasks.values()) {
    if(['success','failed'].includes(task.state)||polling.has(task.id)||Date.now()-task.createdAt>30*60*1000)continue;
    polling.add(task.id);api('task',{id:task.id}).catch(e=>log(e.message)).finally(()=>polling.delete(task.id));
  }
},6000);
$('settingsButton').onclick=()=>$('settings').showModal();$('closeSettings').onclick=()=>$('settings').close();
$('configForm').onsubmit=action(async e=>{e.preventDefault();const result=await api('config',{region:$('region').value,key:$('apiKey').value});configured=result.configured;$('keyState').textContent=configured?'已配置':'未配置';$('apiKey').value='';$('settings').close();notify('连接设置已保存');});
$('fullscreen').onclick=action(()=> $('stage').requestFullscreen());
$('audio').onclick=action(async()=>{if(engine){engine.muteAllRemoteAudioPlaying(false);for(const uid of remoteUsers){engine.resumeRemoteAudioStream(uid);engine.resumeRemoteMediaStream(uid,1);}}for(const video of document.querySelectorAll('#remote video')){video.muted=false;await video.play();}notify(engine?'已允许视频有声播放':'收到实时视频后可开启声音');});
$('recording').onclick=action(async()=>{const data=await api('recording');const url=data.recording?.video_url;if(url&&safeUrl(url)){$('recordingLink').href=url;$('recordingLink').hidden=false;}else notify(data.recording?.error_message||'录像尚未就绪；结束真实直播约 2 分钟后重试');});
setInterval(()=>{
  if(session&&session.status!=='ended') {
    const s=Math.floor((Date.now()-session.startedAt)/1000);$('timer').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }
},1000);
setInterval(()=>{if(currentOwner&&session?.status!=='ended')api('heartbeat',{id:session.id}).catch(e=>log(e.message));},8000);
window.addEventListener('pagehide',()=>{if(currentOwner)fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':csrf},body:'{}',keepalive:true}).catch(()=>{});});
try {
  const status=await readResponse(await fetch('/api/status')); csrf=status.csrf;configured=status.configured;$('region').value=status.region;$('keyState').textContent=configured?'已配置':'未配置';updateSession(status.session);
  const lastError=(status.events||[]).filter(e=>e.type==='error' && e.time>=(status.session?.startedAt||Infinity)).at(-1);
  if(status.lastStartError && status.lastStartError.time>(status.session?.startedAt||0)) handleEvent({type:'start_error',data:status.lastStartError});
  else if(lastError && status.session?.reason==='直播初始化失败') {handleEvent(lastError);$('sessionError').textContent='上次开播记录：'+sessionError;}
  for(const t of status.tasks)tasks.set(t.id,t);renderTasks();
  const events=new EventSource('/api/events');events.onmessage=e=>handleEvent(JSON.parse(e.data));events.onerror=()=>log('本地事件连接中断，正在重连');
  log('本地控制台就绪');
} catch(e){notify(`本地服务连接失败：${e.message}`);}
