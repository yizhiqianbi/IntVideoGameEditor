// Append fragments to one media timeline: no source swaps between speech chunks.
class StreamingAvatarPlayer extends AvatarPlayer {
  constructor(options) {
    super(options);
    this.streamState=null;this.pendingReplies=[];this.bufferSeconds=options.bufferSeconds||(()=>3.84);
    const ended=this.onEnded;
    this.onEnded=()=>{if(this.pendingReplies.length){const events=this.pendingReplies.shift();for(const e of events)this.accept(e);}else ended();};
  }
  async tryPlay(version){
    if(this.pendingStreamStart)return;
    const state=this.streamState;
    const target=this.bufferSeconds();
    if(state && state.offset<target-.001 && !(state.done && state.appended===state.next)){
      this.onWaiting(`正在预缓冲 ${state.offset.toFixed(1)} / ${target.toFixed(1)} 秒 · 待机循环`);return;
    }
    return super.tryPlay(version);
  }
  finish(){const pending=this.pendingReplies;this.stop();this.pendingReplies=pending;this.onEnded();}
  stop() {
    const state=this.streamState;
    this.streamState=null;
    if(state){state.controller.abort();if(state.url)URL.revokeObjectURL(state.url);}
    this.pendingReplies=[];
    super.stop();
  }
  accept(event) {
    const mime='video/mp4; codecs="avc1.4D401F, mp4a.40.2"';
    if(!window.MediaSource || !MediaSource.isTypeSupported(mime)){
      this.onError('当前浏览器不支持连续视频流，请使用最新版 Chrome 或 Edge。');return;
    }
    let state=this.streamState;
    if(state && state.id!==event.reply_id){
      let group=this.pendingReplies.find(g=>g[0].reply_id===event.reply_id);
      if(!group){group=[];this.pendingReplies.push(group);}group.push(event);return;
    }
    if(!state){
      if(event.type==='video_done')return;
      const media=new MediaSource(),url=URL.createObjectURL(media),controller=new AbortController();
      const opened=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('视频流打开超时')),15000);
        media.addEventListener('sourceopen',()=>{clearTimeout(timeout);resolve();},{once:true});
        controller.signal.addEventListener('abort',()=>{clearTimeout(timeout);reject(new DOMException('Cancelled','AbortError'));},{once:true});
      });
      opened.catch(()=>{});
      this.pendingStreamStart=true;
      super.play(url);
      state={id:event.reply_id,media,url,controller,chain:opened,offset:0,next:0,appended:0,done:false};
      this.streamState=state;this.pendingStreamStart=false;
    }
    if(event.type==='video_done'){
      state.done=true;
      state.chain=state.chain.then(()=>{if(this.streamState===state&&state.media.readyState==='open'){state.media.endOfStream();this.tryPlay(this.version);}});
    }else{
      if(event.segment!==state.next){this.stop();this.onError('视频片段顺序异常，请重新开始');return;}
      state.next++;
      // Fetch immediately; ordered append is independent of network completion order.
      const bytes=fetch(event.url,{signal:state.controller.signal}).then(r=>{if(!r.ok)throw new Error(`视频下载失败 ${r.status}`);return r.arrayBuffer();});
      bytes.catch(()=>{});
      state.chain=state.chain.then(async()=>{
        const data=await bytes;if(this.streamState!==state)return;
        const buffer=state.buffer||(state.buffer=state.media.addSourceBuffer(mime));
        buffer.timestampOffset=state.offset;
        buffer.appendWindowEnd=Infinity;
        buffer.appendWindowStart=state.offset;
        buffer.appendWindowEnd=state.offset+event.duration;
        await new Promise((resolve,reject)=>{
          const clean=()=>{buffer.removeEventListener('updateend',ok);buffer.removeEventListener('error',bad);state.controller.signal.removeEventListener('abort',cancel);};
          const ok=()=>{clean();resolve();},bad=()=>{clean();reject(new Error('视频片段解码失败'));},cancel=()=>{clean();reject(new DOMException('Cancelled','AbortError'));};
          buffer.addEventListener('updateend',ok,{once:true});buffer.addEventListener('error',bad,{once:true});state.controller.signal.addEventListener('abort',cancel,{once:true});
          try{buffer.appendBuffer(data);}catch(e){clean();reject(e);}
        });
        state.offset+=event.duration;state.appended++;
        if(!this.started)this.tryPlay(this.version);
      });
    }
    state.chain=state.chain.catch(error=>{
      if(error.name==='AbortError'||this.streamState!==state)return;
      this.stop();this.onError(error.message);
    });
  }
}
window.StreamingAvatarPlayer=StreamingAvatarPlayer;
