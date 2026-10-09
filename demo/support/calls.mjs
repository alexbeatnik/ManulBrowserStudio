// CALL HOST handlers: things a hunt asks this script to work out.
//
//     CALL HOST shop.promo_code with args: "autumn" into {code}
//
// A handler gets the arguments as strings and answers with the value the
// variable after `into` will hold.

import { call } from 'manul-browser';

const PROMO_CODES = { autumn: 'MANUL10' };

/** The promo code of a season; a real suite would ask a database or an API. */
call('shop.promo_code', (ctx) => {
  const code = PROMO_CODES[String(ctx.args[0]).toLowerCase()];
  if (!code) throw new Error(`there is no promo code for "${ctx.args[0]}"`);
  return code;
});

/** A price with a percentage taken off: ("$45.00", "10") is "$40.50". */
call('shop.discounted', (ctx) => {
  const [price, percent] = ctx.args;
  const amount = Number(String(price).replace(/[^0-9.]/g, ''));
  return `$${(amount * (1 - Number(percent) / 100)).toFixed(2)}`;
});

/** The date a number of days from today, as the shop writes dates: 2026-11-14. */
call('shop.delivery_day', (ctx) => {
  const day = new Date();
  day.setDate(day.getDate() + Number(ctx.args[0] ?? 1));
  const two = (n) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
});
