// Use actual door transitions to draw an encounter. Bounds the shuffle-bag
// search without changing the random seed or the room authority.
export async function drawDoorEncounter(page, mode, doorId = 'entry_door') {
  await page.waitForFunction(() => !!window.__kitchen?.serviceLevel?.doorJourney);
  for (let attempt = 0; attempt < 8; attempt++) {
    const route = await page.evaluate(() => __kitchen.serviceLevel.doorJourney);
    if (route.mode === mode) return route;
    for (const open of [true, false]) {
      await page.evaluate(({ doorId, open }) => __kitchen.doors.setOpen(doorId, open), { doorId, open });
      await page.waitForFunction(({ doorId, open }) => __kitchen.doors.list.find(door => door.id === doorId)?.open === open, { doorId, open });
    }
    await page.waitForFunction(revision => __kitchen.serviceLevel.doorJourney.revision > revision, route.revision);
    await page.waitForTimeout(650);
  }
  throw Error('Door draw did not reach ' + mode);
}
