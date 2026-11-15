async(page)=>{
  const ctx=await page.context().browser().newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce',timezoneId:'Europe/Berlin'});
  try{
    const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.goto('http://127.0.0.1:5173/');await p.locator('.console-environment[data-boot=home]').waitFor();
    await p.waitForFunction(()=>!document.querySelector('.trophy-toast, .console-toast'));
    const captures=[];
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
      await p.setViewportSize({width,height});
      for(let i=0;i<4;i++)await p.keyboard.press('ArrowLeft');
      await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');await p.keyboard.press('Home');
      for(const category of ['Game','Network']){
        await p.waitForFunction(()=>document.querySelector('.console-destinations').getAnimations({subtree:true}).every(a=>a.playState==='finished'));
        const path='output/playwright/ps3-'+category.toLowerCase()+'-'+width+'x'+height+'.png';
        await p.screenshot({path,animations:'disabled'});captures.push(path);
        if(category==='Game')await p.keyboard.press('ArrowRight');
      }
    }
    await p.goto('http://127.0.0.1:5173/protocols');await p.locator('.console-application').waitFor();
    const geometry=await p.evaluate(()=>{
      const status=document.querySelector('.console-status').getBoundingClientRect();
      const header=document.querySelector('.console-application-header').getBoundingClientRect();
      return {separated:header.top>=status.bottom,statusBottom:status.bottom,headerTop:header.top};
    });
    if(!geometry.separated)throw Error('App header overlaps status '+JSON.stringify(geometry));
    await p.waitForFunction(()=>!document.querySelector('.trophy-toast, .console-toast'));
    await p.screenshot({path:'output/playwright/ps3-app-mobile.png',animations:'disabled'});
    await p.goto('http://127.0.0.1:5173/');await p.locator('.console-environment[data-boot=home]').waitFor();
    await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('.console-menu').focus();await p.mouse.move(4,700);
    await p.waitForFunction(()=>getComputedStyle(document.querySelector('.console-status-track')).animationName==='consoleTicker');
    const before=await p.locator('.console-status-track').evaluate(el=>getComputedStyle(el).transform);
    await p.waitForTimeout(180);
    const after=await p.locator('.console-status-track').evaluate(el=>getComputedStyle(el).transform);
    if(before===after)throw Error('Ticker is not moving');
    await p.locator('.console-status').hover();
    if(await p.locator('.console-status-track').evaluate(el=>getComputedStyle(el).animationPlayState)!=='paused')throw Error('Ticker hover pause failed');
    const font=await p.evaluate(()=>({weight:getComputedStyle(document.querySelector('.console-item-label')).fontWeight,synthesis:getComputedStyle(document.querySelector('.console-item-label')).fontSynthesis,faces:[...document.fonts].filter(f=>f.family.includes('Rodin')).map(f=>({family:f.family,weight:f.weight,status:f.status}))}));
    if(errors.length)throw Error(errors.join('; '));
    return {captures,geometry,ticker:'scroll and pause pass',font,errors};
  }finally{await ctx.close()}
}
