async(page)=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const ctx=await page.context().browser().newContext({reducedMotion:'reduce',timezoneId:'Europe/Berlin'});
  const routes=['/profile','/trophies','/project','/project?view=contributing','/theme','/deploy','/deploy?view=configuration','/deploy?view=operations','/deploy?view=quickstart','/?view=system','/protocols','/routing','/lifecycle','/?app=overview','/problem','/architecture','/source','/security','/status'];
  const results=[];const errors=[];
  await ctx.addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1')});
  try{
    const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
    p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('net::'))errors.push(m.text())});
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
      await p.setViewportSize({width,height});
      for(const route of routes){
        await p.goto('http://127.0.0.1:5173'+route);await p.locator('.console-application').waitFor();
        await p.evaluate(()=>document.fonts.ready);
        const geometry=await p.evaluate(()=>{
          const app=document.querySelector('.console-application');const main=app.querySelector('main');
          const rect=el=>el.getBoundingClientRect();const status=rect(document.querySelector('.console-status'));const header=rect(app.querySelector('header'));const body=rect(main);const hints=rect(app.querySelector('.console-app-hints'));
          const overlaps=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
          return {horizontal:main.scrollWidth>main.clientWidth+1||document.documentElement.scrollWidth>innerWidth,statusHeader:[...app.querySelector('header').children].some(el=>overlaps(status,rect(el))),statusBody:overlaps(status,body),bodyHints:overlaps(body,hints),scrollbar:getComputedStyle(main).scrollbarWidth,headerWeight:getComputedStyle(app.querySelector('h1')).fontWeight,legacyBack:!!app.querySelector('.console-back,.console-app-back-hint'),blur:getComputedStyle(document.querySelector('.console-wallpaper')).filter};
        });
        assert(!geometry.horizontal&&!geometry.statusHeader&&!geometry.statusBody&&!geometry.bodyHints&&!geometry.legacyBack&&geometry.scrollbar==='none'&&geometry.headerWeight==='400',JSON.stringify({route,width,...geometry}));
        const screen=p.locator('main .xmb-screen');
        if(await screen.count()){
          const sections=await p.locator('main .xmb-section-navigation button').count();
          for(let section=0;section<sections;section++){
            await p.locator('main .xmb-section-navigation button').nth(section).click();
            const rows=await p.locator('main .xmb-list-row').count();assert(rows>0,'Empty section '+route+' '+section);
            await p.keyboard.press('Home');
            for(let row=0;row<rows;row++){
              if(row)await p.keyboard.press('ArrowDown');
              await p.waitForFunction(index=>{
                const el=document.querySelector('main .xmb-list--screen'),row=el?.querySelector('.is-selected');if(!row||[...el.children].indexOf(row)!==index)return false;
                const a=el.getBoundingClientRect(),b=row.getBoundingClientRect();const target=Math.max(a.top+40,Math.min(a.bottom-40,innerHeight/2));
                return Math.abs(target-(b.top+b.bottom)/2)<2;
              },row,{timeout:5000}).catch(async()=>{throw Error(JSON.stringify({route,width,section,row,actual:await p.locator('main .xmb-list--screen').evaluate(el=>({index:[...el.children].indexOf(el.querySelector('.is-selected')),box:el.getBoundingClientRect().toJSON(),row:el.querySelector('.is-selected').getBoundingClientRect().toJSON(),scroll:el.scrollTop,css:el.style.cssText,focus:document.activeElement?.outerHTML.slice(0,180)}))}))});
              const state=await p.locator('main .xmb-list--screen').evaluate((el,index)=>{
                const row=el.querySelector('.is-selected');const a=el.getBoundingClientRect(),b=row.getBoundingClientRect();
                const target=Math.max(a.top+40,Math.min(a.bottom-40,innerHeight/2));
                return {index:[...el.children].indexOf(row),centered:Math.abs(target-(b.top+b.bottom)/2)<2,visible:b.top>=a.top-1&&b.bottom<=a.bottom+1,weight:getComputedStyle(row.querySelector('.xmb-list-link')).fontWeight,expected:index};
              },row);
              assert(state.index===row&&state.centered&&state.visible&&state.weight==='400',JSON.stringify({route,width,section,...state}));
            }
            await p.keyboard.press('Home');await p.keyboard.press('End');
            assert(await p.locator('main .xmb-list-row.is-selected').evaluate(el=>!el.nextElementSibling),'End does not reach last row');
            const panel=p.locator('main .xmb-text-panel');
            if(await panel.count())await panel.evaluate(el=>{el.scrollTop=el.scrollHeight;if(el.scrollTop+el.clientHeight<el.scrollHeight-2)throw Error('Panel cannot reach bottom')});
          }
        }else{
          const scroll=p.locator('main');
          await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);
          assert(await scroll.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-2),'Page cannot reach bottom '+route);
          const actions=p.locator('main button:visible, main a:visible, main input:visible');
          assert(await actions.count()>0,'Simulator controls missing '+route);
          await actions.first().focus();assert(await actions.first().evaluate(el=>document.activeElement===el),'Control not focusable '+route);
        }
        if(['/profile','/protocols','/deploy'].includes(route)){
          await p.keyboard.press('Home');await p.mouse.move(2,2);
          await p.screenshot({path:'output/playwright/system-'+route.slice(1)+'-'+width+'x'+height+'.png',animations:'disabled'});
        }
        results.push({route,width,height,pass:true});
      }
    }
    assert(!errors.length,errors.join('; '));
    return {pages:results.length,results,errors};
  }finally{await ctx.close()}
}
