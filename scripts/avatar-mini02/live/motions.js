// Generated portrait clips, preloaded independently of the audio-driven reply.
// Keep the last decoded picture underneath until a new video's frame is ready.
const motions = (() => {
  const stage = document.getElementById('avatar-stage');
  const fallback = document.getElementById('idle-avatar');
  const clips = new Map();
  let generation = 0, current = null, pending = null;
  for (const name of ['listening', 'thinking', 'smiling', 'nodding']) {
    const video = document.createElement('video');
    video.className = 'motion-video';
    video.dataset.motion = name;
    video.src = `/behaviors/${name}.mp4?v=2`;
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.loop = name === 'listening' || name === 'thinking';
    stage.insertBefore(video, document.getElementById('avatar'));
    clips.set(name, video);
  }
  function cancel() {
    generation++;
    if (pending) {
      clearTimeout(pending.timeout);
      if (pending.frame != null) pending.video.cancelVideoFrameCallback?.(pending.frame);
      pending.video.onplaying = null;
      if (pending.video !== current) pending.video.pause();
      pending = null;
    }
  }
  function select(name) {
    cancel();
    if (name === 'speaking') return; // Keep the underlying idle clip running.
    const video = clips.get(name);
    if (!video) return;
    const version = generation;
    video.onended = () => {
      if (version === generation && (name === 'nodding'||name === 'smiling')) director.dispatch('gesture_done');
    };
    if (current === video && !video.ended) {
      video.play().catch(() => {});
      return;
    }
    video.currentTime = 0;
    const load = {video, timeout: null, frame: null}; pending = load;
    const reveal = () => {
      if (version !== generation) return;
      clearTimeout(load.timeout); pending = null;
      clips.forEach(v => {v.classList.toggle('motion-visible', v === video); if (v !== video) v.pause();});
      current = video;
      stage.dataset.motion = name;
      document.getElementById('motion-status').textContent = 'H3 生成动作 · ' + ({listening:'倾听',thinking:'思考',smiling:'微笑',nodding:'点头'})[name];
    };
    const failed = () => {
      if (version !== generation) return;
      cancel();
      document.getElementById('motion-status').textContent = '动作加载失败，保留上一画面';
      if (name === 'nodding'||name === 'smiling') director.dispatch('gesture_done');
    };
    video.onerror = failed;
    load.timeout = setTimeout(failed, 12000);
    if (video.requestVideoFrameCallback) load.frame = video.requestVideoFrameCallback(reveal);
    else video.onplaying = () => requestAnimationFrame(() => requestAnimationFrame(reveal));
    video.play().catch(failed);
  }
  return {select};
})();
