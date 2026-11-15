async(page)=>{
  const assert=(ok,message)=>{if(!ok)throw new Error(message)};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('.console-environment[data-boot=home]').waitFor();
  const results=[];
  for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
    await page.setViewportSize({width,height});
    for(let i=0;i<4;i++)await page.keyboard.press('ArrowLeft');
    for(const category of ['Users','Settings','Game','Network']){
      const count=await page.locator('.console-destination-position').count();
      await page.keyboard.press('Home');
      for(let i=0;i<count;i++){
        await page.waitForFunction(index=>[...document.querySelectorAll('.console-destination-position')].indexOf(document.querySelector('.console-destination-position.is-selected'))===index,i);
        await page.waitForFunction(()=>document.querySelector('.console-destinations').getAnimations({subtree:true}).every(animation=>animation.playState==='finished'));
        const metrics=await page.evaluate(()=>{
          const status=document.querySelector('.console-status').getBoundingClientRect();
          const selected=document.querySelector('.console-destination-position.is-selected').getBoundingClientRect();
          const anchor=document.querySelector('.console-destinations').getBoundingClientRect().top;
          const identity=document.querySelector('.console-identity').getBoundingClientRect();
          const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
          const activeRows=[...document.querySelectorAll('.console-destination')].filter(el=>getComputedStyle(el).visibility!=='hidden');
          return {
            centered:Math.abs((selected.top+selected.bottom)/2-anchor)<1,
            statusOverlap:activeRows.some(row=>intersects(row.getBoundingClientRect(),status)),
            footerOverlap:intersects(selected,identity),
            inViewport:selected.top>=0&&selected.bottom<innerHeight,
            subtitles:document.querySelectorAll('.console-item-subtitle').length===document.querySelectorAll('.console-destination').length,
            flat:!document.querySelector('.console-category svg linearGradient, .console-destination svg linearGradient'),
            weight:getComputedStyle(document.querySelector('.console-destination-position.is-selected .console-item-label')).fontWeight,
            statusInside:status.left>=0&&status.right<=innerWidth&&status.top>=0,
            tickerStatic:getComputedStyle(document.querySelector('.console-status-track')).animationName==='none',
          };
        });
        assert(metrics.centered&&!metrics.statusOverlap&&!metrics.footerOverlap&&metrics.inViewport&&metrics.subtitles&&metrics.flat&&metrics.weight==='400'&&metrics.statusInside&&metrics.tickerStatic,JSON.stringify({width,height,category,index:i,...metrics}));
        if(i<count-1)await page.keyboard.press('ArrowDown');
      }
      if(category!=='Network')await page.keyboard.press('ArrowRight');
    }
    results.push({width,height,allCategories:'pass'});
  }
  await page.locator('.console-notice-toggle').click();
  await page.locator('.console-notice-panel[data-open=true]').waitFor();
  const unread=await page.locator('.console-status-user').getAttribute('aria-label');
  assert(unread==='0 unread notifications','Unread counter did not follow the board: '+unread);
  await page.keyboard.press('Escape');
  await page.locator('.console-notice-panel[data-open=false]').waitFor({state:'attached'});
  await page.mouse.move(4,700);
  await page.locator('.console-search-toggle').focus();
  await page.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='true',null,{timeout:8000});
  assert(await page.locator('.console-help').evaluate(el=>getComputedStyle(el).opacity==='0'),'Hints did not fade');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='false');
  // A fine-pointer hover must not move the selected row away from the axis.
  await page.keyboard.press('Home');
  const selectedId=await page.locator('.console-destination-position.is-selected a').getAttribute('data-console-item');
  await page.locator('.console-destination').nth(1).hover();
  assert(await page.locator('.console-destination-position.is-selected a').getAttribute('data-console-item')===selectedId,'Hover moved the cursor');
  if(errors.length)throw new Error(errors.join('; '));
  return {results,unread,hints:'fade and keyboard wake pass',hover:'anchored',errors};
}
