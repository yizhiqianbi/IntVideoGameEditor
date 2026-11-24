import { test } from "node:test";
import assert from "node:assert/strict";
import media from "../src/lib/drama-reference-media";
import comfy from "../src/lib/drama-comfy";
import drama from "../src/lib/drama";
import archive from "../src/lib/drama-archive";
const video = {id:"a".repeat(32),kind:"video",name:"motion.mp4",url:"/api/drama/reference-media?id="+"a".repeat(32),duration:2};
const audio = {...video,id:"b".repeat(32),kind:"audio",name:"sound.wav"};
const request = {provider:"comfy",videoModel:"h3",mode:"ri2v",aspectRatio:"16:9",prompt:"Follow Video 1 and Audio 1",references:[],referenceMedia:[video,audio]};
test("audio requires visual reference; video-only references work",()=>{
  assert.doesNotThrow(()=>drama.buildDramaInput(request));
  assert.throws(()=>drama.buildDramaInput({...request,referenceMedia:[audio]}),/搭配/);
  assert.throws(()=>drama.buildDramaInput({...request,firstFrame:"https://example.com/a.jpg"}),/首尾帧/);
  assert.throws(()=>drama.buildDramaInput({...request,provider:"fal"}),/自有 GPU/);
});
test("count and duration limits apply independently to audio and video",()=>{
  assert.throws(()=>media.validateReferenceMedia([video,{...video,duration:14}]),/总时长/);
  assert.throws(()=>media.validateReferenceMedia(Array(4).fill(video)),/最多/);
  assert.equal(media.validateReferenceMedia([video,audio]).length,2);
});
test("H3 connects video frames and standalone audio to the correct indexed ports",()=>{
  const graph=comfy.buildComfyGraph("ri2v","Follow Video 1 and Audio 1","16:9",[],1,15,[{kind:"video",file:"pencil_refs/a.mp4"},{kind:"audio",file:"pencil_refs/b.wav"}]);
  assert.equal(graph["7"].inputs.prompt,"Follow <Video 1> and <Audio 1>");
  assert.deepEqual(graph["7"].inputs["ref_videos.ref_video_0"],["60",0]);
  assert.deepEqual(graph["7"].inputs["ref_audios.ref_audio_0"],["70",0]);
  assert.equal(graph["60"].class_type,"PencilLoadReferenceVideo");
  assert.equal(graph["70"].class_type,"LoadAudio");
});
test("archive preserves reference attachments without credentials",()=>{
  const result=archive.parseArchive({version:1,shots:[{...drama.newShot(0),referenceMedia:[video,audio]}],assets:[]});
  assert.equal(result.shots[0].referenceMedia?.[1].name,"sound.wav");
});
test("ZIP includes audio/video payloads and restores their MIME types",async()=>{
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => Response.json({});
  const v={...video,url:"https://example.com/motion.mp4"};
  const a={...audio,url:"https://example.com/sound.wav"};
  globalThis.fetch = async (url) => new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":String(url).endsWith("wav") ? "audio/wav" : "video/mp4"}});
  let urls:string[]=[];
  try {
    const zip=await archive.packArchive({version:1,shots:[{...drama.newShot(0),referenceMedia:[v,a]}],assets:[]});
    globalThis.fetch=original;
    const restored=await archive.unpackArchive(zip);urls=restored.urls;
    const refs=restored.doc.shots[0].referenceMedia!;
    assert.equal((await (await fetch(refs[0].url)).blob()).type,"video/mp4");
    assert.equal((await (await fetch(refs[1].url)).blob()).type,"audio/wav");
    assert.equal((await (await fetch(refs[1].url)).arrayBuffer()).byteLength,3);
  } finally {globalThis.fetch=original;urls.forEach(URL.revokeObjectURL);}
});
