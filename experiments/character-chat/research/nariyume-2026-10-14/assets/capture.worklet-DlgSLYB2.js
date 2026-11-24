// Resample by integrating input sample intervals (48/44.1 kHz -> 16 kHz).
// Fixed-size 100 ms messages bound allocation and main-thread traffic.
class Capture extends AudioWorkletProcessor {
 constructor(){super();this.out=new Float32Array(1600);this.used=0;this.weight=0;this.sum=0;this.ratio=sampleRate/16000;this.live=true;
  this.port.onmessage=e=>{if(e.data==='stop'){this.live=false;if(this.used)this.port.postMessage(this.out.slice(0,this.used));this.port.postMessage('stopped');}};
 }
 process(inputs,outputs){
  for(const channel of outputs[0]||[])channel.fill(0); // Never loop mic into speakers.
  if(!this.live)return false;
  const input=inputs[0]?.[0];if(!input)return true;
  for(const value of input){
   let remaining=1;
   while(remaining>1e-7){
    const take=Math.min(remaining,this.ratio-this.weight);this.sum+=value*take;this.weight+=take;remaining-=take;
    if(this.weight>=this.ratio-1e-7){
     this.out[this.used++]=this.sum/this.ratio;this.sum=0;this.weight=0;
     if(this.used===1600){this.port.postMessage(this.out,[this.out.buffer]);this.out=new Float32Array(1600);this.used=0;}
    }
   }
  }
  return true;
 }
}
registerProcessor('ny-local-capture',Capture);
