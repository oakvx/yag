async (page) => {
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const context=await page.context().browser().newContext({viewport:{width:1366,height:768},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1');localStorage.setItem('yag-xmb-audio-v2',JSON.stringify({music:false,effects:false,master:0}));});
  const p=await context.newPage();
  const row=async name=>{
    const rows=await p.locator('main .xmb-list-row').allTextContents();
    const index=rows.findIndex(text=>text.startsWith(name));assert(index>=0,'Missing row '+name);
    await p.keyboard.press('Home');for(let i=0;i<index;i++)await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
  };
  const visit=async path=>{await p.goto('http://127.0.0.1:5174'+path);await p.locator('.console-environment[data-boot="home"]').waitFor();await p.locator('.xmb-screen').waitFor();await p.keyboard.press('Home');};
  try{
    await visit('/routing');await row('Backend condition');await row('TCP connect refused');await row('Fallback to default');await row('View details');
    assert((await p.locator('.xmb-text-panel').innerText()).includes('Fallthrough'),'Fallback simulation failed');
    await p.keyboard.press('Escape');await row('Upstream HTTP 500');await row('View details');
    assert((await p.locator('.xmb-text-panel').innerText()).includes('NEVER retried'),'HTTP replay boundary failed');
    await p.keyboard.press('Escape');await p.keyboard.press('Escape');await row('Model');await row('Custom model ID');await p.keyboard.press('ArrowRight');await p.keyboard.type('unknown-model');
    assert((await p.locator('.xmb-text-panel').innerText()).includes('no route matched'),'Custom input failed');
    await p.keyboard.press('Escape');assert(await p.locator('.xmb-screen').getAttribute('data-view')==='list','Input Escape failed');

    await visit('/lifecycle');await row('Playback');await row('Run signal trace');await row('View details');
    await p.waitForTimeout(1100);assert((await p.locator('.xmb-section-label').first().innerText()).includes('02'),'Playback did not advance');
    await p.keyboard.press('Escape');await row('Pause trace');const stopped=await p.locator('main .xmb-list-row.is-selected').innerText();await p.waitForTimeout(1100);
    assert(await p.locator('main .xmb-list-row.is-selected').innerText()===stopped,'Pause failed');

    await visit('/source?file=config-routes');await p.keyboard.press('Enter');await p.locator('.xmb-text-panel').waitFor();
    const copy=p.getByRole('button',{name:'Copy excerpt',exact:true});
    await copy.focus();await p.keyboard.press('Enter');assert(await p.getByRole('button',{name:'Copied',exact:true}).count()===1,'Copy failed');
    const source=p.locator('.xmb-text-panel a[target="_blank"]').first();await source.focus();await p.keyboard.press('Enter');await p.getByRole('alertdialog').waitFor();
    await p.keyboard.press('Escape');assert(await source.evaluate(el=>el===document.activeElement),'External cancel lost focus');

    await visit('/?app=overview');await row('Open Architecture');await p.waitForURL('**/architecture');assert(await p.locator('.xmb-screen').count()===1,'Internal navigation failed');
    await visit('/theme');const before=await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'));await p.keyboard.press('ArrowDown');
    assert(await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'))===before,'Theme preview persisted too early');await p.keyboard.press('Enter');
    assert(await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'))!==before,'Theme commit failed');

    await visit('/profile');await p.keyboard.press('/');await p.locator('.console-quick-jump').waitFor();await p.keyboard.press('Escape');
    return {routing:'passed',lifecycle:'passed',copy:'passed',externalFocus:'passed',internalNavigation:'passed',themePreview:'passed',quickJump:'passed'};
  } catch(error) {await p.screenshot({path:'output/playwright/behavior-failure.png'});throw Error(error.message+'\n'+await p.locator('main').ariaSnapshot());} finally {await context.close();}
}
