async (page) => {
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const context=await page.context().browser().newContext({reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1');localStorage.setItem('yag-xmb-audio-v2',JSON.stringify({music:false,effects:false,master:0}));});
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const visit=async path=>{await p.goto('http://127.0.0.1:5174'+path);await p.locator('.xmb-document').waitFor();await p.evaluate(()=>new Promise(requestAnimationFrame));};
  let excerpts=0;
  try {
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]) {
      await p.setViewportSize({width,height});await visit('/source');
      const files=p.getByRole('navigation',{name:'Source files'}).getByRole('button');
      await files.first().focus();
      for(let i=0;i<13;i++) {
        if(i)await p.keyboard.press('ArrowDown');
        const selected=files.filter({has:p.locator('.source-file-name')}).nth(i);
        assert(await selected.getAttribute('aria-pressed')==='true','File selection '+i);
        assert(await selected.evaluate(el=>el===document.activeElement),'File focus '+i);
        assert(await p.locator('#source-detail pre').innerText(),'Empty code');
        const href=await p.getByRole('link',{name:/View original source/}).getAttribute('href');
        assert(href.includes('/0d97615')&&/#L\d+-L\d+$/.test(href),'Unpinned source link');
        assert(await p.locator('.xmb-text-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Code horizontal overflow '+width+'/'+i);
        excerpts++;
      }
      await p.getByLabel('Subsystem',{exact:true}).selectOption('Control Plane');assert(await files.count()===3,'Subsystem filter');
      await p.getByRole('searchbox',{name:'Find a file'}).fill('zz-unmatched');assert(await p.getByText('No matching files',{exact:true}).isVisible(),'Empty search');
      await p.getByRole('button',{name:'Show all excerpts'}).click();assert(await files.count()===13,'Filter reset');
      await p.getByRole('searchbox',{name:'Find a file'}).fill('scheduler');assert(await files.count()===1,'Search');
      await p.keyboard.press('Escape');assert(await files.count()===13,'Escape clears search');
      if(width===390) {await p.getByRole('button',{name:/Read Host Entrypoint/}).click();assert(await p.locator('#source-detail').evaluate(el=>el===document.activeElement),'Mobile read shortcut');}
      await p.getByRole('button',{name:'Copy excerpt',exact:true}).click();await p.getByRole('button',{name:'Copied',exact:true}).waitFor();
      assert((await p.evaluate(()=>navigator.clipboard.readText())).includes('#include "yag.h"'),'Clipboard source');
    }
    await visit('/source?file=adaptive-scheduler');assert(await p.locator('#source-detail h3').innerText()==='Adaptive GPU Admission','Deep link');
    await visit('/security');await p.getByRole('navigation',{name:'On this page'}).getByRole('button',{name:'Absent controls'}).click();
    assert(await p.locator('#section-absent').evaluate(el=>el===document.activeElement),'Section index focus');
    await p.keyboard.press('ArrowDown');assert(await p.locator('.xmb-text-panel').evaluate(el=>el.scrollTop>0),'Section scrolling');
    await visit('/status');await p.getByLabel('Qualification filter').selectOption('1');
    assert((await p.locator('.xmb-text-panel').innerText()).includes('Adaptive admission'),'Updated knowledge');
    assert(!(await p.locator('.xmb-text-panel').innerText()).includes('Native TLS, CORS & Encrypted'),'Status filter');
    assert(errors.length===0,errors.join('\n'));return {excerpts,filters:'passed',clipboard:'passed',mobileShortcut:'passed',sectionIndex:'passed',knowledge:'passed',errors};
  } finally {await context.close();}
}
