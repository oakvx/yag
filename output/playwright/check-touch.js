async(page)=>{
  const browser=page.context().browser();
  const errors=[];
  const context=()=>browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const start=async(ctx)=>{
    const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.goto('http://127.0.0.1:5173/');
    await p.locator('.console-environment[data-boot=home]').waitFor();
    const previous=p.getByRole('button',{name:'Previous category',exact:true});
    while(await previous.isEnabled())await previous.tap();
    return p;
  };
  const swipe=async(ctx,p,x,y,dx,dy)=>{
    const cdp=await ctx.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=6;i++){
      await p.waitForTimeout(30);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y:y+dy*i/6}]});
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
  };
  const taps=await context();
  try{
    const p=await start(taps);
    await p.getByRole('button',{name:'Next destination',exact:true}).tap();
    await p.locator('[data-console-item=trophies][aria-current=true]').waitFor();
    await p.getByRole('button',{name:'Open selected destination',exact:true}).tap();
    await p.locator('[data-testid=trophies]').waitFor();
    await swipe(taps,p,220,600,0,-240);
    await p.waitForFunction(()=>document.querySelector('.console-application-content').scrollTop>0,null,{timeout:3000});
  }finally{await taps.close()}
  const menu=await context();
  try{
    const p=await start(menu);
    await swipe(menu,p,220,500,0,-100);
    await p.locator('[data-console-item=trophies][aria-current=true]').waitFor();
    if(!p.url().endsWith('/'))throw Error('Menu swipe activated a destination');
    await p.screenshot({path:'output/playwright/input-mobile.png'});
  }finally{await menu.close()}
  const notices=await context();
  try{
    const p=await start(notices);
    await p.locator('.console-notice-toggle').tap();
    await p.locator('.console-notice-list').waitFor();
    const before=await p.locator('.console-notice-list [aria-selected=true]').getAttribute('id');
    await swipe(notices,p,220,500,0,-120);
    await p.waitForFunction(id=>document.querySelector('.console-notice-list [aria-selected=true]')?.id!==id,before);
    if(await p.locator('.console-commit').count())throw Error('Notification swipe opened commit');
  }finally{await notices.close()}
  if(errors.length)throw Error(errors.join('; '));
  return {touchTaps:'pass',menuSwipe:'one step without activation',nativePageScroll:'pass',notificationSwipe:'pass',errors};
}
