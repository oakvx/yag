async (page) => {
 await page.context().addInitScript(()=>{sessionStorage.setItem('yag-xmb-boot-seen','1');localStorage.setItem('yag-xmb-theme-v1','0');});
 const results=[];
 for(const [width,height] of [[1920,1080],[1366,768],[390,844]]) {
  await page.setViewportSize({width,height});
  await page.goto('http://127.0.0.1:5174/source');
  await page.locator('.source-workspace').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({path:`output/playwright/atlas-${width}.png`});
  results.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,panelOverflow:document.querySelector('.xmb-text-panel').scrollWidth>document.querySelector('.xmb-text-panel').clientWidth,columns:getComputedStyle(document.querySelector('.source-workspace')).gridTemplateColumns})));
 }
 return results;
}
