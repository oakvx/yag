async (page) => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const routes = ['/?app=overview','/problem','/architecture','/lifecycle','/protocols','/routing','/source','/security','/status','/deploy','/project','/profile','/theme','/trophies','/?view=system','/deploy?view=configuration','/deploy?view=operations','/deploy?view=quickstart','/project?view=contributing','/source?file=config-routes'];
  const context = await page.context().browser().newContext({reducedMotion:'reduce',timezoneId:'Europe/Berlin'});
  await context.addInitScript(() => {
    sessionStorage.setItem('yag-xmb-boot-seen','1');
    localStorage.setItem('yag-xmb-audio-v2',JSON.stringify({music:false,effects:false,master:0}));
    // Exercise the actual polling loop, not a parallel keyboard-only adapter.
    window.testPad = {connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]};
    navigator.getGamepads = () => [window.testPad];
  });
  const p = await context.newPage();
  p.setDefaultTimeout(6000);
  const errors = []; p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  const counts={pages:0,screens:0,rows:0,externalConfirmations:0,panelActions:0};
  const pad = async index => {await p.evaluate(i=>{window.testPad.buttons[i]={pressed:true,value:1};},index);await p.waitForTimeout(35);await p.evaluate(i=>{window.testPad.buttons[i]={pressed:false,value:0};},index);await p.waitForTimeout(35);};
  const geometry = async label => {
    const result = await p.evaluate(() => {
      const app=document.querySelector('.console-application'),root=app.querySelector('.xmb-screen');
      const box=el=>el.getBoundingClientRect();
      const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
      const status=box(document.querySelector('.console-status')),header=box(app.querySelector('header')),hints=box(app.querySelector('.console-app-hints'));
      const list=root.querySelector('.xmb-list'),panel=root.querySelector('.xmb-text-panel');
      const surfaces=[root,list,panel].filter(Boolean);
      const shortGap=list?.dataset.long==='false' ? box(list.firstElementChild).top-header.bottom : null;
      return {horizontal:surfaces.some(el=>el.scrollWidth>el.clientWidth+1)||document.documentElement.scrollWidth>innerWidth,
        statusHeader:[...app.querySelector('header').children].some(el=>overlap(status,box(el))),
        hints:surfaces.some(el=>overlap(hints,box(el))), shortGap,
        panels:root.querySelectorAll('.xmb-text-panel').length,
        forbidden:!!root.querySelector('[role=tablist],.xmb-section-navigation,.xmb-screen-subtitle'),
        view:root.dataset.view, ticker:getComputedStyle(document.querySelector('.console-status-ticker')).display,
        title:app.querySelector('h1').textContent};
    });
    assert(!result.horizontal&&!result.statusHeader&&!result.hints&&!result.forbidden&&result.panels<=1,JSON.stringify({label,...result}));
    assert(result.shortGap===null||result.shortGap>=-1&&result.shortGap<35,'Gap '+JSON.stringify({label,...result}));
    if((await p.viewportSize()).width===390) assert(result.ticker==='none','Mobile ticker visible');
    counts.screens++;
  };
  const inspectText = async label => {
    await geometry(label);
    const panel=p.locator('.xmb-text-panel');
    const controls=await panel.locator('button:not(:disabled),a[href],input').count();
    // Focused region scrolls; Right reaches actions, then Up/Down traverses them.
    await p.keyboard.press('End');await p.keyboard.press('Home');
    for(let i=0;i<controls;i++) {
      await p.keyboard.press('ArrowRight');
      const state=await p.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent,inside:!!document.activeElement.closest('.xmb-text-panel')}));
      assert(state.inside,'Lost detail focus '+label);
      counts.panelActions++;
    }
  };
  const walk = async (label,depth=0) => {
    assert(depth<4,'Unexpected navigation cycle '+label);
    await geometry(label);
    const preview=await p.locator('.xmb-screen').getAttribute('data-view')==='preview';
    const rowCount=await p.locator('main .xmb-list-row').count();
    await p.keyboard.press('Home');
    for(let i=0;i<rowCount;i++) {
      if(i) await p.keyboard.press('ArrowDown');
      const row=p.locator('main .xmb-list-row.is-selected');
      const state=await row.evaluate(el=>({index:[...el.parentElement.children].indexOf(el),kind:el.dataset.kind,title:el.textContent,height:el.getBoundingClientRect().height,focus:el.contains(document.activeElement)}));
      assert(state.index===i&&state.height>=44&&state.focus,JSON.stringify({label,i,...state}));counts.rows++;
      if(preview){await geometry(label+' / '+state.title);continue;}
      if(state.kind==='screen') {
        await p.keyboard.press('Enter');
        const view=await p.locator('.xmb-screen').getAttribute('data-view');
        if(view==='text') await inspectText(label+' / '+state.title);
        else await walk(label+' / '+state.title,depth+1);
        await p.keyboard.press('Escape');
        assert(await p.locator('main .xmb-list-row.is-selected').evaluate(el=>[...el.parentElement.children].indexOf(el))===i,'Back lost cursor '+label);
      } else if(state.kind==='external') {
        await p.keyboard.press('Enter');await p.getByRole('alertdialog').waitFor().catch(()=>{throw Error('External dialog absent '+label+' / '+state.title);});
        await p.keyboard.press('Escape');counts.externalConfirmations++;
      } else if(state.kind==='action') {
        await p.keyboard.press('Enter');
        assert(await p.locator('.xmb-screen').count()===1,'Action lost screen '+label);
      }
    }
  };
  try {
    // Set a requested theme on the same local origin, then reload each route.
    await p.goto('http://127.0.0.1:5174/');
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]) {
      await p.setViewportSize({width,height});
      for(const theme of [9,4,0]) {
        for(const route of routes) {
          await p.evaluate(t=>localStorage.setItem('yag-xmb-theme-v1',String(t)),theme);
          await p.goto('http://127.0.0.1:5174'+route);
          await p.locator('.console-environment[data-boot="home"]').waitFor();
          await p.locator('.xmb-screen').waitFor();
          await p.keyboard.press('Home');
          await walk(`${width}/${theme}/${route}`);counts.pages++;
          if(route==='/?app=overview') await p.screenshot({path:`output/playwright/drilldown-${width}-${theme}.png`});
        }
      }
    }
    // Gamepad D-pad, Cross, Circle and shoulder mapping through the real poller.
    await p.goto('http://127.0.0.1:5174/?app=overview');await p.locator('.xmb-screen').waitFor();
    await pad(13);await pad(13);await pad(0);
    assert(await p.locator('.xmb-screen').getAttribute('data-view')==='preview','Pad could not open signal paths');
    await pad(13);assert(await p.locator('main .xmb-list-row.is-selected').evaluate(el=>[...el.parentElement.children].indexOf(el))===1,'Pad Down failed');
    await pad(15);assert(await p.locator('.xmb-text-panel').evaluate(el=>el===document.activeElement),'Pad Right failed');
    await pad(14);await pad(5);assert(await p.locator('.xmb-screen').getAttribute('data-level')==='system','R1 failed');
    await pad(4);await pad(1);assert(await p.locator('.xmb-screen').getAttribute('data-level')==='$root','Circle failed');
    assert(errors.length===0,'Console errors '+errors.join('\n'));
    return {counts,gamepad:'passed',errors};
  } finally {await context.close();}
}
