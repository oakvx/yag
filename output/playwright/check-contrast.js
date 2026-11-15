async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await context.addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1');localStorage.setItem('yag-xmb-audio-v2',JSON.stringify({music:false,effects:false,master:0}));});
  const p=await context.newPage();
  const pixel=async(buffer,points)=>p.evaluate(async({image,points})=>{
    const img=new Image();img.src='data:image/png;base64,'+image;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    return points.map(([x,y])=>[...ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data].slice(0,3));
  },{image:buffer.toString('base64'),points});
  const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const contrast=(rgb,alpha)=>{const text=rgb.map(v=>255*alpha+v*(1-alpha));return (luminance(text)+.05)/(luminance(rgb)+.05);};
  const samples=[];
  try {
    await p.goto('http://127.0.0.1:5174/?app=overview');await p.locator('.xmb-screen').waitFor();
    // Hide only foreground objects for measurement; preserve the actual wallpaper,
    // renderer, uniform scrim and filters. Sample its top, middle and bottom.
    const hide=await p.addStyleTag({content:'.console-application,.console-status,.trophy-toast,.console-toast-region{visibility:hidden!important}'});
    for(let theme=0;theme<12;theme++) {
      await p.evaluate(async theme=>{const palette=await import('/src/xmb/palette.ts');palette.setSelectedTheme(theme);palette.announceThemeChange();},theme);
      await p.waitForTimeout(650);
      const rgb=await pixel(await p.screenshot(),[[500,150],[500,384],[500,650]]);
      samples.push({theme,rgb,rows:rgb.map(c=>contrast(c,.85)),secondary:rgb.map(c=>contrast(c,.75))});
    }
    await hide.evaluate(el=>el.remove());
    // A white frame is an upper bound on any additive ribbon or theme color.
    const white=await p.addStyleTag({content:'.console-wallpaper {visibility:hidden!important}.console-wallpaper-background{background:white!important;filter:none!important;opacity:1!important}'});
    const hideRows=await p.addStyleTag({content:'.console-application{visibility:hidden!important}'});
    const rowRgb=(await pixel(await p.screenshot({path:'output/playwright/contrast-white-frame.png'}),[[500,600]]))[0];
    await hideRows.evaluate(el=>el.remove());
    await p.locator('.xmb-text-panel').focus();await p.keyboard.press('Home');
    const point=await p.locator('.xmb-text-panel').evaluate(el=>{const b=el.getBoundingClientRect();return [b.left+8,b.top+8];});
    const panelRgb=(await pixel(await p.screenshot({path:'output/playwright/contrast-white-text.png'}),[point]))[0];
    const result={themes:samples,worstWhiteFrame:{rowRgb,rows:contrast(rowRgb,.85),secondary:contrast(rowRgb,.75),panelRgb,body:contrast(panelRgb,242/255)}};
    if(samples.some(s=>[...s.rows,...s.secondary].some(r=>r<4.5))||result.worstWhiteFrame.rows<4.5||result.worstWhiteFrame.secondary<4.5||result.worstWhiteFrame.body<4.5) throw Error(JSON.stringify(result));
    await white.evaluate(el=>el.remove());
    return result;
  } finally {await context.close();}
}
