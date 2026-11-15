async(page)=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const ctx=await page.context().browser().newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await ctx.addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1')});
  try{
    const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
    const go=async route=>{await p.goto('http://127.0.0.1:5173'+route);await p.locator('.console-application').waitFor()};
    const selected=()=>p.locator('main .xmb-list-row.is-selected');
    await go('/profile');await p.keyboard.press('Home');
    await p.locator('main .xmb-list').evaluate(el=>el.scrollTop+=80);await p.keyboard.press('Home');
    assert(await selected().evaluate(el=>Math.abs(el.getBoundingClientRect().top+el.clientHeight/2-innerHeight/2)<2),'Home did not recover a manually scrolled selection');
    const scroll=await p.locator('main .xmb-list').evaluate(el=>el.scrollTop);
    await p.locator('main .xmb-list-row').nth(1).hover();
    assert(await selected().locator('.xmb-list-title').innerText()==='Role','Hover highlight failed');
    assert(await p.locator('main .xmb-list').evaluate(el=>el.scrollTop)===scroll,'Hover scrolled rows');
    await p.mouse.move(2,2);await p.keyboard.press('PageDown');
    assert(await p.locator('main .xmb-section-navigation [aria-pressed=true]').innerText()==='Project identity','PageDown failed');
    assert(await p.locator('.console-app-hints button').filter({hasText:'Select'}).count()===0,'Read-only section exposes Select');
    await p.goto('http://127.0.0.1:5173/');await p.locator('.console-environment[data-boot=home]').waitFor();for(let i=0;i<4;i++)await p.keyboard.press('ArrowLeft');await p.keyboard.press('Home');for(let i=0;i<3;i++)await p.keyboard.press('ArrowDown');
    assert(await p.locator('.console-destination-position.is-selected [data-console-item]').getAttribute('data-console-item')==='github','Test did not select GitHub');await p.keyboard.press('Enter');
    await p.getByRole('alertdialog').waitFor();await p.keyboard.press('Escape');await p.getByRole('alertdialog').waitFor({state:'hidden'});
    assert(p.url().endsWith('/'),'External link bypassed confirmation');
    await go('/deploy');await p.keyboard.press('Home');const target=await selected().innerText();await p.keyboard.press('Enter');
    assert(await selected().innerText()!==target,'Deployment target not changed');
    await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');assert((await selected().innerText()).endsWith('Off'),'Console toggle not changed');
    await p.keyboard.press('PageDown');await p.keyboard.press('PageDown');await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');
    assert(!(await p.locator('main .xmb-text-panel').innerText()).includes('npm ci'),'Commands ignore settings');
    await go('/theme');const saved=await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'));
    await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');
    assert(await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'))===saved,'Preview persisted theme');
    await p.keyboard.press('Enter');assert(await p.evaluate(()=>localStorage.getItem('yag-xmb-theme-v1'))==='0','Theme not applied');
    await p.keyboard.press('Escape');await p.locator('.console-menu[data-hidden=false]').waitFor();
    await go('/profile');await p.keyboard.press('Home');
    await p.evaluate(()=>{window.__pad={connected:true,buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad]})});
    const press=async index=>{await p.evaluate(i=>window.__pad.buttons[i]={pressed:true,value:1},index);await p.waitForTimeout(65);await p.evaluate(i=>window.__pad.buttons[i]={pressed:false,value:0},index);await p.waitForTimeout(40)};
    await press(13);assert(await selected().locator('.xmb-list-title').innerText()==='Role','Gamepad D-pad failed');
    await press(5);assert(await p.locator('main .xmb-section-navigation [aria-pressed=true]').innerText()==='Project identity','Gamepad R1 failed');
    await press(4);assert(await p.locator('main .xmb-section-navigation [aria-pressed=true]').innerText()==='Author & maintainer','Gamepad L1 failed');
    await press(1);await p.locator('.console-menu[data-hidden=false]').waitFor();
    const simulators=[];
    for(const route of ['/problem','/architecture','/lifecycle','/protocols','/source']){
      await go(route);
      const inactive=p.locator('main button[aria-pressed=false], main button[aria-selected=false], main [role=button][aria-pressed=false]').first();
      const node=await inactive.elementHandle();
      await inactive.focus();await p.evaluate(async()=>{const {sendApplicationInput}=await import('/src/xmb/ApplicationControls.tsx');sendApplicationInput(document.querySelector('main'),'Enter')});
      assert(await p.locator('main [aria-pressed=true], main [aria-selected=true]').count()>0,'Simulator activation failed '+route);
      if(route==='/architecture')assert(await node.getAttribute('aria-pressed')==='true','SVG activation failed');
      simulators.push(route);
    }
    await go('/routing');const model=p.locator('main input').first();await model.focus();await model.fill('test-model');assert(await model.inputValue()==='test-model','Routing input not editable');
    await model.press('Backspace');assert(p.url().includes('/routing'),'Backspace left focused input');
    await p.keyboard.press('Escape');await p.locator('.console-menu[data-hidden=false]').waitFor();
    await go('/profile');await p.locator('main').focus();await p.keyboard.press('Backspace');await p.locator('.console-menu[data-hidden=false]').waitFor();
    await go('/profile');await p.mouse.move(2,2);await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='true',null,{timeout:8000});
    assert(await p.locator('.console-app-hints').evaluate(el=>getComputedStyle(el).opacity)==='0','Page hints did not hide');
    await p.mouse.move(4,4);await p.waitForFunction(()=>document.querySelector('.console-environment').dataset.hintsIdle==='false');
    assert(!errors.length,errors.join('; '));
    return {hover:'stable',sections:'keyboard and L1/R1',confirmation:'pass',deploy:'settings update commands',themes:'preview and persistence pass',gamepad:'D-pad and back pass',simulators,backspace:'editing and navigation pass',idle:'hide and wake pass',errors};
  }finally{await ctx.close()}
}
