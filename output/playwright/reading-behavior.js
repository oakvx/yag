async (page) => {
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const context=await page.context().browser().newContext({viewport:{width:1366,height:768},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1');localStorage.setItem('yag-xmb-audio-v2',JSON.stringify({music:false,effects:false,master:0}));});
  const p=await context.newPage();
  const visit=async path=>{await p.goto('http://127.0.0.1:5174'+path);await p.locator('.xmb-screen').waitFor();await p.evaluate(()=>new Promise(requestAnimationFrame));};
  const row=async name=>{const item=p.locator('.xmb-list-link').filter({has:p.locator('.xmb-list-title',{hasText:name})});await item.first().click();};
  try {
    await visit('/routing');
    await row('TCP connect refused');await row('Fallback to default');
    assert((await p.locator('.xmb-text-panel').innerText()).includes('Fallthrough'),'Fallback');
    await row('Upstream HTTP 500');assert((await p.locator('.xmb-text-panel').innerText()).includes('NEVER retried'),'HTTP retry boundary');
    await row('Custom model ID');const input=p.getByLabel('Incoming request model');await input.fill('unknown-model');
    assert((await p.locator('.xmb-text-panel').innerText()).includes('no route matched'),'Custom model');
    await p.keyboard.press('Escape');assert(await p.evaluate(()=>!!document.activeElement.closest('.xmb-list')),'Input escape');
    await visit('/lifecycle');await row('Run signal trace');await p.waitForTimeout(1100);
    const stage=p.locator('.xmb-signal-stages [aria-current="step"]');assert((await stage.innerText()).startsWith('02'),'Trace advance');
    await row('Pause trace');const paused=await stage.innerText();await p.waitForTimeout(1100);assert(await stage.innerText()===paused,'Trace pause');
    await visit('/source?file=config-routes');await p.getByRole('button',{name:'Copy excerpt',exact:true}).click();
    assert(await p.getByRole('button',{name:'Copied',exact:true}).count()===1,'Copy');
    const link=p.locator('.xmb-text-panel a[target="_blank"]').first();await link.focus();await p.keyboard.press('Enter');await p.getByRole('alertdialog').waitFor();await p.keyboard.press('Escape');
    assert(await link.evaluate(el=>el===document.activeElement),'External cancel focus');
    await visit('/?app=overview');await p.getByRole('link',{name:/Open Architecture/}).click();await p.waitForURL('**/architecture');
    await visit('/theme');const theme=await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'));await p.keyboard.press('ArrowDown');
    assert(await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'))===theme,'Theme preview');await p.keyboard.press('Enter');
    assert(await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'))!==theme,'Theme apply');
    await visit('/profile');await p.keyboard.press('/');await p.locator('.console-quick-jump').waitFor();await p.keyboard.press('Escape');
    return {routing:'passed',lifecycle:'passed',copy:'passed',externalFocus:'passed',navigation:'passed',theme:'passed',quickJump:'passed'};
  } catch(e){throw Error(e.message+'\n'+await p.locator('main').ariaSnapshot());} finally {await context.close();}
}
