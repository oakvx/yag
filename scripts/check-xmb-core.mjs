import assert from 'node:assert/strict';
import { cleanCommitTitle } from '../src/xmb/commitTitle.ts';
import { waveBand, WAVE_MOTION } from '../src/xmb/waveProfile.ts';

const titles = [
  ['fix(console): restore the item column', undefined, 'restore the item column'],
  ['feat!: new routing', undefined, 'new routing'],
  ['Merge pull request #74 from oakvx/arena/branch', '\nfix(console): Restore the footer\n\nMore detail', 'Restore the footer'],
  ['Merge pull request #74 from owner/branch: Human title', undefined, 'Human title'],
  ['Merge branch \'feature\' into main', undefined, 'No news'],
  ['', '', 'No news'],
  ['Human subject\nDo not show this', undefined, 'Human subject'],
];
for (const [subject, body, expected] of titles) assert.equal(cleanCommitTitle(subject, body), expected);
assert.deepEqual(WAVE_MOTION, {
  speed: .32, horizontalAmplitude: .07, verticalAmplitude: .024,
  driftAmplitude: .034, rippleAmplitude: .012, layerSpeed: .13,
  layerPhase: 2.15, shimmerSpeed: .8, shimmerAmplitude: .12,
});
for (const time of [0, 3.1, 6.2, 60, 600]) for (const x of [0, .2, .5, .8, 1]) for (const layer of [0, 1, 2]) {
  const band = waveBand(x, time, layer, 0);
  const baseHalf = (.035 + .09 * (.5 + .5 * Math.sin(band.twist)) ** 2) * (1 - layer * .1);
  assert.ok(Math.abs(band.half / baseHalf - 1.3) < 1e-10, 'Home width increases exactly 30%');
  assert.ok(Math.abs(waveBand(x, time, layer, 1).half / baseHalf - .62) < 1e-10, 'Gathered boot width stays unchanged');
}
console.log('7 commit-title cases and 75 ribbon samples passed; motion constants and gathered width unchanged.');
