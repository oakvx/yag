async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  const routes = ['/protocols','/problem','/architecture','/lifecycle','/routing','/source','/security','/status','/deploy','/project','/profile','/theme','/trophies','/?app=overview','/?view=system','/deploy?view=configuration','/deploy?view=operations','/project?view=contributing'];
  let checked = 0;
  for (const [width,height] of [[1280,720],[1167,782],[390,844]]) {
    await page.setViewportSize({width,height});
    for (const route of routes) {
      await page.goto('http://127.0.0.1:5173' + route);
      await page.locator('.console-environment[data-boot=home]').waitFor();
      const app = page.locator('.console-application');
      const main = page.locator('.console-application-content');
      if (route === '/protocols') await page.getByRole('tab',{name:'Chat Completions · Transparent Proxy',exact:true}).click();
      await main.evaluate(el => { el.scrollTop = 120; });
      const scroll = await main.evaluate(el => el.scrollTop);
      const url = page.url();
      await page.locator('.console-notice-toggle').click();
      await app.waitFor({state:'hidden'});
      if (await app.isVisible()) throw new Error('Background visible on ' + route);
      if (await app.getAttribute('aria-hidden') !== 'true' || !await app.evaluate(el=>el.inert)) throw new Error('Background accessible on ' + route);
      const first = page.locator('.console-notice-list [aria-selected=true] button');
      await first.press('Enter');
      await page.locator('.console-commit').waitFor();
      if (await app.isVisible()) throw new Error('Background visible under commit');
      await page.keyboard.press('Escape');
      await first.waitFor();
      await page.keyboard.press('Escape');
      await app.waitFor({state:'visible'});
      if (!await app.isVisible() || await app.evaluate(el=>el.inert)) throw new Error('Page not restored');
      if (page.url() !== url || await main.evaluate(el=>el.scrollTop) !== scroll) throw new Error('Route or scroll lost');
      await page.waitForFunction(()=>document.activeElement===document.querySelector('.console-notice-toggle'));
      if (route === '/protocols' && await page.getByRole('tab',{name:'Chat Completions · Transparent Proxy',exact:true}).getAttribute('aria-selected') !== 'true') throw new Error('Page state lost');
      await page.locator('.console-notice-toggle').click();
      await page.locator('.console-notice-toggle[data-open=true]').waitFor();
      await page.locator('.console-notice-toggle').click();
      await app.waitFor({state:'visible'});
      if (!await app.isVisible()) throw new Error('Icon close failed');
      checked++;
    }
  }
  if(errors.length) throw new Error(errors.join('; '));
  return {checked, errors, verified:'Exclusive board and commit detail, Escape and icon close, route, scroll, page state and focus restoration'};
}
