// One persistent idle layer; switch only after decoded video + audible PCM playback.
class AvatarPlayer {
  constructor({idle, reply, resume, onSpeaking=()=>{}, onWaiting=()=>{}, onEnded=()=>{}, onError=()=>{}}) {
    Object.assign(this,{idle,reply,resume,onSpeaking,onWaiting,onEnded,onError});
    this.version=0; this.raf=null; this.timer=null; this.context=null; this.frameReady=false;
    idle.loop=true; idle.muted=true;
    this.keepIdle=()=>{if(idle.paused&&!document.hidden)idle.play().catch(()=>{});};
    this.keepIdle(); this.watch=setInterval(this.keepIdle,1000);
    this.visibility=()=>this.keepIdle();document.addEventListener('visibilitychange',this.visibility);
    resume.onclick=()=>this.tryPlay(this.version);
  }
  async unlock(){
    if(!this.context){
      this.context=new AudioContext();
      this.source=this.context.createMediaElementSource(this.reply);
      this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;
      this.source.connect(this.analyser);this.analyser.connect(this.context.destination);
      this.pcm=new Float32Array(this.analyser.fftSize);
    }
    if(this.context.state!=='running')await this.context.resume();
  }
  stop(){
    this.version++;clearTimeout(this.timer);cancelAnimationFrame(this.raf);
    if(this.frameId!=null)this.reply.cancelVideoFrameCallback?.(this.frameId);
    this.frameId=null;this.frameReady=false;this.shown=false;this.started=false;
    this.reply.onended=this.reply.onerror=this.reply.onwaiting=this.reply.onplaying=this.reply.onpause=null;
    this.reply.pause();this.reply.muted=true;this.reply.classList.remove('visible');this.resume.hidden=true;
    this.keepIdle();
  }
  finish(){this.stop();this.onEnded();}
  async tryPlay(version){
    try{
      await this.unlock();if(version!==this.version)return;
      this.reply.muted=false;this.reply.volume=1;
      await this.reply.play();if(version!==this.version)return;
      this.resume.hidden=true;
    }catch(error){
      if(version!==this.version)return;
      clearTimeout(this.timer);this.reply.classList.remove('visible');this.resume.hidden=false;
      this.onWaiting('点击播放回复以允许声音播放');
    }
  }
  play(url){
    this.stop();const version=this.version, video=this.reply;
    // Hide immediately before assigning a different media source.
    video.style.transition='none';video.classList.remove('visible');void video.offsetWidth;video.style.transition='';
    this.onWaiting('回复准备中 · 待机持续播放');
    video.loop=false;video.src=url;video.load();
    const valid=()=>version===this.version;
    const fail=()=>{if(!valid())return;this.stop();this.onError('回复视频加载失败，待机继续播放');};
    video.onerror=fail;
    video.onended=()=>{if(!valid())return;this.finish();};
    const buffering=()=>{if(!valid())return;this.shown=false;video.classList.remove('visible');this.onWaiting('回复缓冲中 · 待机持续播放');this.keepIdle();};
    video.onwaiting=buffering;
    video.onpause=()=>{if(valid()&&!video.ended){buffering();this.resume.hidden=false;}};
    if(video.requestVideoFrameCallback)this.frameId=video.requestVideoFrameCallback(()=>{if(valid())this.frameReady=true;});
    const monitor=()=>{
      if(!valid())return;
      if(!video.requestVideoFrameCallback&&video.readyState>=2&&video.currentTime>0)this.frameReady=true;
      let rms=0;
      if(this.analyser&&this.context.state==='running'){
        this.analyser.getFloatTimeDomainData(this.pcm);
        for(const sample of this.pcm)rms+=sample*sample;
        rms=Math.sqrt(rms/this.pcm.length);
      }
      // No transition on loadeddata, server audio events, or a silent leading frame.
      if(!this.shown&&this.frameReady&&!video.paused&&!video.muted&&video.readyState>=3&&video.currentTime>0&&rms>.002){
        this.shown=true;const first=!this.started;this.started=true;clearTimeout(this.timer);
        video.classList.add('visible');this.onSpeaking({first,mediaTime:video.currentTime,rms,at:performance.now()});
      }
      this.raf=requestAnimationFrame(monitor);
    };
    this.raf=requestAnimationFrame(monitor);
    this.timer=setTimeout(()=>{if(valid()&&!this.started){this.onWaiting('尚未检测到回复声音 · 待机持续播放');}},30000);
    this.tryPlay(version);
  }
  destroy(){this.stop();clearInterval(this.watch);document.removeEventListener('visibilitychange',this.visibility);this.context?.close().catch(()=>{});}
}
window.AvatarPlayer=AvatarPlayer;
