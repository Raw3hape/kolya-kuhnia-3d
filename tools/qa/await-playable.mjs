// Shared native-UI entry barrier, compatible with the older first-view release.
export async function awaitPlayable(page) {
  await page.waitForFunction(() => document.querySelector('#loading.failed') || window.__kitchen &&
    (__kitchen.startup ? __kitchen.startup.status !== 'loading' : document.body.classList.contains('ready')),
  null, { timeout: 210000 });
  const error = await page.evaluate(() => window.__kitchen?.startup?.error?.message ||
    (document.querySelector('#loading.failed') ? document.querySelector('.ld-error p')?.textContent || 'Не удалось подготовить квартиру' : null));
  if (error) throw new Error(error);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 3000 });
}
