async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('.console-environment[data-boot=home]').waitFor();
  await page.mouse.move(4,4);
  const sizes = [[1920,1080],[1366,768],[1280,720],[1167,782],[390,844]];
  const categories = ['Users','Settings','Game','Network'];
  let checked = 0;
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    for (let i=0;i<categories.length;i++) await page.keyboard.press('ArrowLeft');
    for (const category of categories) {
      if (await page.getByRole('button', {name:category, exact:true}).getAttribute('aria-pressed') !== 'true') throw new Error('Wrong category');
      await page.mouse.move(4,4);
      const count = await page.locator('.console-destination-position').count();
      for (let i=0;i<count;i++) await page.keyboard.press('ArrowUp');
      for (let i=0;i<count;i++) {
        await page.waitForFunction(index => [...document.querySelectorAll('.console-destination-position')].indexOf(document.querySelector('.console-destination-position.is-selected')) === index, i);
        const handle = await page.waitForFunction(() => {
          const bar = document.querySelector('.console-category.is-selected .console-category-art').getBoundingClientRect();
          const selected = document.querySelector('.console-destination-position.is-selected').getBoundingClientRect();
          const footer = Math.min(...['.console-identity','.console-help'].map(selector => document.querySelector(selector).getBoundingClientRect().top));
          const result = {
            overlaps: [...document.querySelectorAll('.console-destination-position.is-above')].some(row => row.getBoundingClientRect().bottom > bar.top),
            visible: selected.top >= 0 && selected.bottom < footer,
            anchored: Math.abs((selected.top+selected.bottom)/2 - document.querySelector('.console-destinations').getBoundingClientRect().top) < 1,
          };
          return !result.overlaps && result.visible && result.anchored ? result : false;
        }, null, {timeout:2000});
        const result = await handle.jsonValue();
        if (result.overlaps || !result.visible || !result.anchored) throw new Error(JSON.stringify({width,height,category,index:i,...result}));
        checked++;
        if (i<count-1) await page.keyboard.press('ArrowDown');
      }
      if (category !== categories.at(-1)) await page.keyboard.press('ArrowRight');
    }
  }
  await page.keyboard.press('t');
  if (await page.locator('.console-options[data-open=true]').count() !== 1) throw new Error('Options did not open');
  await page.keyboard.press('Escape');
  if (await page.locator('.console-options[data-open=true]').count() !== 0) throw new Error('Options did not close');
  if (errors.length) throw new Error(errors.join('; '));
  await page.emulateMedia({reducedMotion: 'no-preference'});
  return {checked, viewports:sizes, options:'pass', errors};
}
