async(page)=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const browser=page.context().browser();const results=[];
  for(const fallback of [false,true])for(const reduced of [false,true]){
    const ctx=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:reduced?'reduce':'no-preference',timezoneId:'Europe/Berlin'});
    try{
      await ctx.addInitScript(({fallback})=>{
        window.__wave={frames:0,layers:[],uniforms:{},palette:[],samples:[]};
        const names=new WeakMap();const proto=WebGLRenderingContext.prototype;
        const get=proto.getUniformLocation;proto.getUniformLocation=function(program,name){const location=get.call(this,program,name);if(location)names.set(location,name);return location};
        for(const name of ['uniform1f','uniform1i']){const original=proto[name];proto[name]=function(location,value){const key=location&&names.get(location);if(key)window.__wave.uniforms[key]=value;return original.call(this,location,value)}}
        const palette=proto.uniform3fv;proto.uniform3fv=function(location,value){if(names.get(location)==='uPalette[0]')window.__wave.palette=Array.from(value);return palette.call(this,location,value)};
        const draw=proto.drawArrays;proto.drawArrays=function(...args){const state=window.__wave;const result=draw.apply(this,args);if(state.uniforms.uPass===1){if(state.uniforms.uLayer===0)state.layers=[];state.layers.push(state.uniforms.uLayer)}if(state.uniforms.uPass===2){state.frames++;state.samples.push({...state.uniforms});if(state.samples.length>400)state.samples.shift()}return result};
        const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.closest('.console-wallpaper'))window.__wave.frames++;return clear.apply(this,args)};
        if(fallback){const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl'||type==='experimental-webgl')return null;return context.call(this,type,...args)}}
      },{fallback});
      const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
      const date=new Date('2026-11-15T12:00:00Z');await p.clock.install({time:date});await p.clock.pauseAt(date);
      await p.goto('http://127.0.0.1:5173/');
      const renderer=fallback?'2d':'webgl';await p.locator('.console-wallpaper[data-renderer="'+renderer+'"]').waitFor();
      let elapsed=0;const frames=[];
      const checkpoints=reduced?[100,1000,1650,1900,2180,2220]:[100,2000,3000,4800,5500,6180,6220];
      for(const at of checkpoints){
        await p.clock.runFor(at-elapsed);elapsed=at;
        const sample=await p.evaluate(()=>({stage:document.querySelector('.console-environment').dataset.boot,frames:window.__wave.frames,layers:window.__wave.layers,uniforms:{...window.__wave.uniforms},palette:window.__wave.palette,background:document.querySelector('.console-wallpaper-background').style.cssText}));
        if(!fallback){assert(sample.layers.join(',')==='0,1,2','A ribbon layer disappeared during boot');assert(sample.palette.length===12,'Missing theme palette')}
        frames.push({at,...sample});
        await p.evaluate(elapsed=>{for(const animation of document.getAnimations()){const target=animation.effect?.target;if(target instanceof Element&&target.closest('.boot-screen')){animation.pause();animation.currentTime=elapsed}}},at);
        await p.screenshot({path:'output/playwright/boot-'+renderer+'-'+(reduced?'reduced-':'')+at+'.png'});
      }
      assert(frames.at(-1).stage==='home','Boot did not finish');
      if(!fallback){
        assert(frames[0].palette.join(',')===frames.at(-1).palette.join(','),'Boot palette changed at handoff');
        assert(frames[0].uniforms.uBoot===1&&frames.at(-1).uniforms.uBoot===0,'Gathered parameter did not unfold');
        assert(reduced?frames[0].uniforms.uTime===frames.at(-1).uniforms.uTime:frames[0].uniforms.uTime<frames.at(-1).uniforms.uTime,'Wrong material clock');
      }
      const geometry=await p.evaluate(async({reduced})=>{
        const {waveBand}=await import('/src/xmb/waveProfile.ts');const {getBootFrame,BOOT_DURATION}=await import('/src/xmb/bootState.ts');
        let maximumJump=0;let motion=0;
        for(let layer=0;layer<3;layer++)for(let x=0;x<=1;x+=0.05){
          const before=getBootFrame({stage:'handoff',elapsed:BOOT_DURATION-0.001,reduced:false});
          const a=waveBand(x,14.2,layer,before.boot),b=waveBand(x,14.201,layer,0);
          maximumJump=Math.max(maximumJump,Math.abs(a.centre-b.centre)*innerHeight,Math.abs(a.half-b.half)*innerHeight);
          motion=Math.max(motion,Math.abs(waveBand(x,8,layer,0).centre-waveBand(x,11,layer,0).centre)*innerHeight);
        }
        return {maximumJump,motion,reduced};
      },{reduced});
      assert(geometry.maximumJump<0.2&&geometry.motion>10,'Discontinuous or imperceptible field '+JSON.stringify(geometry));
      await p.clock.runFor(200);
      const count=await p.evaluate(()=>window.__wave.frames);await p.clock.runFor(600);
      const later=await p.evaluate(()=>window.__wave.frames);assert(reduced?count===later:later>count,'Reduced-motion scheduler failed '+JSON.stringify({fallback,reduced,count,later,last:frames.at(-1)}));
      if(!reduced){
        await p.goto('http://127.0.0.1:5173/profile');await p.clock.runFor(100);
        const first=await p.evaluate(()=>window.__wave.frames);await p.clock.runFor(600);const second=await p.evaluate(()=>window.__wave.frames);assert(second>first,'Wave is held behind application');
        await p.evaluate(()=>{window.__hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});document.dispatchEvent(new Event('visibilitychange'))});
        const hidden=await p.evaluate(()=>window.__wave.frames);await p.clock.runFor(600);assert(await p.evaluate(()=>window.__wave.frames)===hidden,'Hidden tab still renders');
        await p.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))});await p.clock.runFor(100);assert(await p.evaluate(()=>window.__wave.frames)>hidden,'Visible tab did not resume');
        await p.evaluate(()=>sessionStorage.removeItem('yag-xmb-boot-seen'));await p.goto('http://127.0.0.1:5173/');await p.clock.runFor(1100);await p.keyboard.press('Space');await p.clock.runFor(160);
        if(!fallback){const compact=await p.evaluate(()=>window.__wave.uniforms.uBoot);assert(compact>0&&compact<1,'Skip swapped the ribbons')}
        await p.clock.runFor(240);assert(await p.locator('.console-environment').getAttribute('data-boot')==='home','Skip did not complete');
      }
      assert(!errors.length,errors.join('; '));results.push({renderer,reduced,geometry,frames:frames.map(({at,stage,uniforms})=>({at,stage,boot:uniforms.uBoot,time:uniforms.uTime})),errors});
    }finally{await ctx.close()}
  }
  return results;
}
