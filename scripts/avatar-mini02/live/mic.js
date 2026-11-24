class Capture extends AudioWorkletProcessor {
  constructor(){super();this.chunk=new Float32Array(16000);this.n=0;this.phase=0;this.sum=0;this.count=0;this.muted=false;this.port.onmessage=e=>{this.muted=!!e.data.muted;};}
  process(inputs){const input=inputs[0]?.[0];if(!input)return true;let energy=0;
    for(const value of input){const x=this.muted?0:value;energy+=x*x;this.sum+=x;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;this.chunk[this.n++]=this.sum/this.count;this.sum=0;this.count=0;
        if(this.n===16000){this.port.postMessage({audio:this.chunk},[this.chunk.buffer]);this.chunk=new Float32Array(16000);this.n=0;}}
    }this.port.postMessage({rms:Math.sqrt(energy/input.length)});return true;
  }
}registerProcessor('capture',Capture);
