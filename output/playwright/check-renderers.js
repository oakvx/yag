async(page)=>{
  const browser=page.context().browser();
  const results=[];
  for(const fallback of [false,true]){
    const ctx=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce',timezoneId:'Europe/Berlin'});
    try{
      const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
      if(fallback)await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl'||type==='experimental-webgl')return null;return original.call(this,type,...args)};});
      await p.goto('http://127.0.0.1:5173/');
      await p.locator('.console-environment[data-boot=home]').waitFor();
      const renderer=await p.locator('.console-wallpaper').getAttribute('data-renderer');
      if(renderer!==(fallback?'2d':'webgl'))throw Error('Wrong renderer: '+renderer);
      await p.getByRole('button',{name:'Game',exact:true}).click();await p.mouse.move(3,740);
      await p.waitForFunction(()=>document.querySelector('.console-destinations').getAnimations({subtree:true}).every(a=>a.playState==='finished'));
      await p.screenshot({path:'output/playwright/faithful-'+renderer+'.png',animations:'disabled'});
      await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='true',null,{timeout:8000});
      // Any standard mapped gamepad input wakes the hints, even at a boundary.
      await p.evaluate(()=>{window.__testPad={connected:true,buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__testPad]});window.__testPad.buttons[12]={pressed:true,value:1};});
      await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='false');
      await p.evaluate(()=>{window.__testPad.buttons[12]={pressed:false,value:0};});
      if(!fallback){
        const supported=await p.evaluate(()=>{const gl=document.querySelector('.console-wallpaper canvas').getContext('webgl');const ext=gl.getExtension('WEBGL_lose_context');if(!ext)return false;window.__restoreWave=()=>ext.restoreContext();ext.loseContext();return true;});
        if(!supported)throw Error('Context-loss test extension unavailable');
        await p.locator('.console-wallpaper[data-renderer="2d"]').waitFor();
        await p.waitForTimeout(1100);
        await p.evaluate(()=>window.__restoreWave());
        await p.locator('.console-wallpaper[data-renderer="webgl"]').waitFor();
      }
      if(errors.length)throw Error(errors.join('; '));
      results.push({renderer,reducedMotion:'static',gamepadWake:'pass',contextRestore:fallback?'not applicable':'pass',errors});
    }finally{await ctx.close()}
  }
  // Touch wake must reveal controls without activating one under the finger.
  const touch=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',hasTouch:true,isMobile:true});
  try{
    const p=await touch.newPage();await p.goto('http://127.0.0.1:5173/');await p.locator('.console-environment[data-boot=home]').waitFor();
    await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='true',null,{timeout:8000});
    await p.touchscreen.tap(370,700);
    await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='false');
    if(!p.url().endsWith('/'))throw Error('Wake-up touch activated a destination');
    await p.getByRole('button',{name:'Next category',exact:true}).tap();
    await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='true',null,{timeout:8000});
    await p.waitForTimeout(450);
    if(await p.locator('.console-mobile-nav').evaluate(el=>getComputedStyle(el).opacity)!=='0')throw Error('Touch focus prevents idle hiding');
    await p.keyboard.press('Tab');await p.locator('.console-help button').first().focus();
    await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='true',null,{timeout:8000});
    await p.waitForTimeout(450);
    if(await p.locator('.console-help').evaluate(el=>getComputedStyle(el).opacity)!=='1')throw Error('Idle hides keyboard focus');
    results.push({touchWake:'pass',touchIdle:'pass',keyboardFocus:'pass'});
  }finally{await touch.close()}
  return results;
}
