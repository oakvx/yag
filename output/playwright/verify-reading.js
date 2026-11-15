async (page) => {
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const routes=['/?app=overview','/problem','/architecture','/lifecycle','/protocols','/routing','/source','/security','/status','/deploy','/project','/profile','/theme','/trophies','/?view=system','/deploy?view=configuration','/deploy?view=operations','/deploy?view=quickstart','/project?view=contributing','/source?file=config-routes'];
  const context=await page.context().browser().newContext({reducedMotion:'reduce'});
  await context.addInitScript(()=>{
    sessionStorage.setItem('yag-xmb-boot-seen','1');
    localStorage.setItem('yag-xmb-audio-v2',JSON.stringify({music:false,effects:false,master:0}));
    window.testPad={connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]};
    navigator.getGamepads=()=>[window.testPad];
  });
  const p=await context.newPage(), errors=[],counts={pages:0,choices:0};
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const visit=async route=>{await p.goto('http://127.0.0.1:5174'+route);await p.locator('.console-environment[data-boot="home"]').waitFor();await p.locator('.xmb-screen').waitFor();await p.evaluate(()=>new Promise(requestAnimationFrame));};
  try {
    await visit('/?app=overview');
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]) {
      await p.setViewportSize({width,height});
      for(const theme of [9,4,0]) {
        await p.evaluate(t=>localStorage.setItem('yag-xmb-theme-v1',String(t)),theme);
        for(const route of routes) {
          await visit(route);
          const state=await p.evaluate(()=>{
            const root=document.querySelector('.xmb-screen'),panel=root.querySelector('.xmb-text-panel');
            const box=el=>el.getBoundingClientRect(),hints=box(document.querySelector('.console-app-hints'));
            const intro=root.querySelector('.xmb-document-introduction');
            return {view:root.dataset.view,panels:root.querySelectorAll('.xmb-text-panel').length,
              horizontal:document.documentElement.scrollWidth>innerWidth||root.scrollWidth>root.clientWidth+1||!!panel&&panel.scrollWidth>panel.clientWidth+1,
              overlaps:box(root).bottom>hints.top+1,
              intro:!!intro&&intro.textContent.length>40,
              introVisible:!!intro&&box(intro).top>=box(panel).top&&box(intro).top<box(panel).bottom,
              forbidden:!!root.querySelector('[role=tablist],.xmb-screen-subtitle'),
              ticker:getComputedStyle(document.querySelector('.console-status-ticker')).display};
          });
          const label=`${width}/${theme}/${route}`;
          assert(!state.horizontal&&!state.overlaps&&!state.forbidden&&state.panels<=1,label+JSON.stringify(state));
          if(!['/theme','/trophies','/?view=system','/deploy?view=configuration','/deploy?view=operations'].includes(route)) {
            assert(state.view==='document'&&state.intro,label+' Missing reading content');
            if(!route.includes('view=')&&!route.includes('file=')) assert(state.introVisible,label+' Introduction not visible');
          }
          if(width===390)assert(state.ticker==='none','Mobile ticker');
          if(theme===9&&state.view==='document') {
            const panel=p.locator('.xmb-text-panel');await panel.focus();await p.keyboard.press('End');await p.keyboard.press('Home');
            const lists=await p.locator('.xmb-document-selection .xmb-list').all();
            for(const list of lists) {
              await list.locator('.xmb-list-link').first().focus();await p.keyboard.press('Home');
              const n=await list.locator('.xmb-list-row').count();
              for(let i=0;i<n;i++){
                if(i)await p.keyboard.press('ArrowDown');
                assert(await list.locator('.is-selected').evaluate((el,index)=>[...el.parentElement.children].indexOf(el)===index&&el.contains(document.activeElement),i),label+' Keyboard selection');
                counts.choices++;
              }
            }
          }
          counts.pages++;
          if(route==='/?app=overview') {await p.locator('.xmb-text-panel').focus();await p.keyboard.press('Home');await p.screenshot({path:`output/playwright/reading-${width}-${theme}.png`});}
        }
      }
    }
    await visit('/?app=overview');
    const pad=async i=>{await p.evaluate(i=>{window.testPad.buttons[i]={pressed:true,value:1};},i);await p.waitForTimeout(60);await p.evaluate(i=>{window.testPad.buttons[i]={pressed:false,value:0};},i);await p.waitForTimeout(60);};
    await p.locator('.xmb-text-panel').focus();await pad(13);
    assert(await p.locator('.xmb-text-panel').evaluate(el=>el.scrollTop>0),'Gamepad reading scroll');
    await pad(15);assert(await p.evaluate(()=>document.activeElement.matches('button,a')),'Gamepad action focus');
    await p.getByRole('link',{name:/Open Architecture/}).focus();await pad(0);await p.waitForURL('**/architecture');
    await pad(1);assert(await p.locator('.console-application').count()===0,'Gamepad back to XMB');
    assert(errors.length===0,errors.join('\n'));
    return {counts,gamepad:'passed',errors};
  } catch(e){await p.screenshot({path:'output/playwright/reading-failure.png'});throw e;} finally {await context.close();}
}
