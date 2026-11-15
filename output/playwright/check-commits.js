async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  if (await page.locator('.console-commit').count()) await page.keyboard.press('Escape');
  if (!await page.getByRole('listbox', {name:'Commit notifications'}).isVisible()) await page.locator('.console-notice-toggle').click();
  await page.mouse.move(4, 4);
  const sizes = [[1280,720], [1167,782], [390,844]];
  let checked = 0;
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    const list = page.getByRole('listbox', {name:'Commit notifications'});
    const count = await list.getByRole('option').count() - 1;
    await page.keyboard.press('Home');
    for (let index = 0; index < count; index++) {
      const selected = list.locator('[aria-selected=true] button');
      const label = await selected.getAttribute('aria-label');
      await page.keyboard.press('Enter');
      await page.locator('.console-commit').waitFor();
      assert(await page.locator('.console-commit h2').isVisible(), 'Commit title missing');
      const bounds = await page.locator('.console-commit').boundingBox();
      const footer = await page.locator('.console-identity').boundingBox();
      assert(bounds.y + bounds.height < footer.y, 'Detail overlaps footer');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
      const files = page.locator('.console-commit summary');
      if (await files.count()) {
        await files.first().click();
        assert(await page.locator('.console-commit details[open]').count() === 1, 'File did not expand');
      }
      await page.mouse.move(4, 4);
      await page.keyboard.press('Escape');
      await list.waitFor();
      assert(await list.locator('[aria-selected=true] button').getAttribute('aria-label') === label?.replace(' Unread.',''), 'Cursor not restored');
      assert(await list.locator('[aria-selected=true] button').evaluate(el => el === document.activeElement), 'Focus not restored');
      await page.keyboard.press('ArrowDown');
      checked++;
    }
  }
  assert(page.context().pages().length === 1, 'Commit opened another tab');
  assert(errors.length === 0, errors.join('; '));
  console.log('PASS: ' + checked + ' commit detail views, file expansion, focus restoration and footer clearance; no popup or runtime errors.');
}
