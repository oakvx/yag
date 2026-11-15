async (page) => {
  await page.context().addInitScript(() => sessionStorage.setItem('yag-xmb-boot-seen', '1'));
  await page.setViewportSize({width:1366,height:768});
  await page.goto('http://127.0.0.1:5174/?app=overview');
  await page.locator('.console-environment[data-boot="home"]').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({path:'output/playwright/pages-home-desktop.png'});
  console.log(await page.locator('.xmb-screen').ariaSnapshot());
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/pages-home-mobile.png'});
}
