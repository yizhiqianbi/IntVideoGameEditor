async page => {
  await page.goto('https://politics-feeling-tries-discuss.trycloudflare.com/');
  await page.route('**/perf-input.wav', route => route.fulfill({path:'/Users/pencil/Documents/IntVideoGameEditor/output/avatar-mini02/perf/input.wav',contentType:'audio/wav'}));
  await page.evaluate(async()=>{
    const input=await (await fetch('/perf-input.wav')).arrayBuffer();
    window.streamRun={events:[],start:performance.now()};
    const record=(type,extra={})=>streamRun.events.push({type,at:Math.round(performance.now()-streamRun.start),...extra});
    navigator.mediaDevices.getUserMedia=async()=>{
      const context=new AudioContext({sampleRate:16000});await context.resume();
      const buffer=await context.decodeAudioData(input.slice(0));
      const destination=context.createMediaStreamDestination();
      const source=context.createBufferSource();source.buffer=buffer;source.connect(destination);source.start(context.currentTime+3);
      source.onended=()=>record('user_end');window.syntheticMic={context,source,destination};
      return destination.stream;
    };
    const accept=player.accept.bind(player);player.accept=e=>{record(e.type,{segment:e.segment,reply:e.reply_id,infer:e.infer_ms,encode:e.encode_ms,encoder:e.encoder});accept(e);};
    const speaking=player.onSpeaking;player.onSpeaking=e=>{record('audible',{first:e.first,media:e.mediaTime});speaking(e);};
    const ended=player.onEnded;player.onEnded=()=>{record('complete');ended();window.syntheticMic?.context.close();};
    for(const type of ['waiting','playing','error'])document.getElementById('avatar').addEventListener(type,()=>record(type,{media:document.getElementById('avatar').currentTime}));
  });
  await page.getByRole('button',{name:'开始对话',exact:true}).click();
}
