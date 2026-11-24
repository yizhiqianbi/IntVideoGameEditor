import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { text } from './protocol.mjs';
const exec = promisify(execFile);
export function rtcConfig(value) {
  const r = value || {};
  const result = Object.fromEntries(['app_id','channel_id','user_id','token','viewer_id','viewer_token'].map(k => [k,text(r[k], `RTC ${k}`, 12000)]));
  if(result.user_id === result.viewer_id) throw new Error('RTC 推流用户与观看用户必须不同');
  return result;
}
export function wavPcm(wav) {
  if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE') throw new Error('语音不是 WAV');
  let pcm, valid=false;
  for(let offset=12;offset+8<=wav.length;) {
    const kind=wav.toString('ascii',offset,offset+4), size=wav.readUInt32LE(offset+4), start=offset+8;
    if(start+size>wav.length) throw new Error('WAV 数据不完整');
    if(kind==='fmt ' && size>=16) valid=wav.readUInt16LE(start)===1&&wav.readUInt16LE(start+2)===1&&wav.readUInt32LE(start+4)===24000&&wav.readUInt16LE(start+14)===16;
    if(kind==='data') pcm=wav.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  if(!valid||!pcm?.length||pcm.length%2) throw new Error('需要 24kHz / 单声道 / 16-bit PCM 语音');
  return pcm;
}
export const defaultVoice = process.env.PIPER_MODEL ? 'zh_CN-huayan-medium' : 'Tingting (中文（中国大陆）)';
export async function synthesize(line, voice=defaultVoice) {
  if(process.platform!=='darwin' && !process.env.PIPER_MODEL) throw new Error('请配置 PIPER_MODEL 和 PIPER_PYTHON');
  const dir=await mkdtemp(path.join(tmpdir(),'vidu-director-'));
  try {
    await writeFile(path.join(dir,'line.txt'),line);
    if (process.env.PIPER_MODEL) {
      await exec(process.env.PIPER_PYTHON || 'python3',['-m','piper','-m',process.env.PIPER_MODEL,'--input-file',path.join(dir,'line.txt'),'-f',path.join(dir,'source.wav')],{timeout:60000, env:{...process.env,OMP_NUM_THREADS:'2'}});
      await exec('ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(dir,'source.wav'),'-ar','24000','-ac','1','-c:a','pcm_s16le',path.join(dir,'voice.wav')],{timeout:15000});
    } else {
      await exec('/usr/bin/say',['-v',voice,'-f',path.join(dir,'line.txt'),'-o',path.join(dir,'voice.wav'),'--file-format=WAVE','--data-format=LEI16@24000','--channels=1'],{timeout:60000});
    }
    const wav=await readFile(path.join(dir,'voice.wav'));
    return {wav,pcm:wavPcm(wav)};
  } finally {await rm(dir,{recursive:true,force:true});}
}
