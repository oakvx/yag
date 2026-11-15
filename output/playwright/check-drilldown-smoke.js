async (page) => {
  await page.setViewportSize({width:1366,height:768});
  await page.goto('http://127.0.0.1:5174/?app=overview');
  await page.locator('.console-environment[data-boot="home"]').waitFor();
  await page.waitForTimeout(600);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.locator('.xmb-screen[data-view="text"]').waitFor();
  await page.screenshot({path:'output/playwright/about-text-desktop.png'});
  await page.keyboard.press('Escape');
  await page.locator('.xmb-screen[data-view="list"]').waitFor();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('.xmb-screen[data-view="preview"]').waitFor();
  await page.keyboard.press('ArrowDown');
  await page.screenshot({path:'output/playwright/signal-desktop.png'});
  await page.keyboard.press('Escape');
  await page.locator('.xmb-screen[data-level="$root"]').waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.screenshot({path:'output/playwright/about-text-mobile.png'});
  return await page.locator('.xmb-screen').ariaSnapshot();
}
