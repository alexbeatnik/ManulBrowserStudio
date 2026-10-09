// Suite hooks: what happens around the hunts rather than in them.

import { afterAll, beforeAll, beforeGroup } from 'manul-browser';

beforeAll((ctx) => {
  // Runs once, before any hunt and before any browser exists.
  // Whatever is set here is a {placeholder} in every hunt: the shop is the
  // site/ folder of this project, wherever the project has been put.
  ctx.variables.shop = new URL('../site', import.meta.url).href;
  // console.log is safe here: the binding sends it to stderr, because stdout
  // is the line to the engine.
  console.log(`[hooks] the shop is at ${ctx.variables.shop}`);
});

// Runs before each hunt that carries the tag: `@tags: checkout`.
let customers = 0;
beforeGroup('checkout', (ctx) => {
  customers += 1;
  ctx.variables.customer = 'Grace Hopper';
  ctx.variables.email = `grace+${customers}@example.com`;
});

afterAll(() => {
  console.log('[hooks] the suite is over');
});
