// Custom controls: widgets the engine cannot work out for itself.
//
// A step aimed at one of these is still an ordinary line of a hunt:
//
//     FILL 'Delivery date' field with '2026-11-14'
//
// but before the engine looks for a field of that name, it finds a handler
// registered for it here and hands the step over. The handler does the work
// in the page, with ctx.eval.

import { customControl } from 'manul-browser';

// The calendar on the checkout page has no <input>: a date is chosen by
// opening it, paging to the month and clicking the day. Only on that page,
// which the engine knows by its title.
customControl({ page: 'Steppe Goods - Checkout', target: 'Delivery date' }, async (ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.value)) {
    throw new Error(`Delivery date takes a date like 2026-11-14, not "${ctx.value}"`);
  }
  const chosen = await ctx.eval(`(() => {
    const wanted = ${JSON.stringify(ctx.value)};
    const picker = document.querySelector('#delivery-date');
    if (!picker) return 'there is no date picker on this page';
    if (picker.querySelector('.calendar').hidden) picker.querySelector('.date-display').click();
    const shown = () => picker.querySelector('.month').dataset.month;
    // A year either way is as far as anybody orders a blanket for.
    for (let i = 0; i < 12 && shown() !== wanted.slice(0, 7); i++) {
      picker.querySelector(shown() < wanted.slice(0, 7) ? '.next' : '.prev').click();
    }
    const day = picker.querySelector('[data-date="' + wanted + '"]');
    if (!day) return 'the calendar does not go to ' + wanted;
    if (day.disabled) return wanted + ' cannot be chosen';
    day.click();
    return picker.dataset.value;
  })()`);
  if (chosen !== ctx.value) throw new Error(`Delivery date: ${chosen}`);
});

// The stars under an order are drawn, with nothing to tell a browser they
// can be clicked. On any page that has them.
customControl({ page: '*', target: 'Rating' }, async (ctx) => {
  const stars = Number(ctx.value);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error(`Rating takes a number of stars from 1 to 5, not "${ctx.value}"`);
  }
  const given = await ctx.eval(`(() => {
    const star = document.querySelector('#rating [data-star="${stars}"]');
    if (!star) return 'there are no stars on this page';
    star.click();
    return Number(document.querySelector('#rating').dataset.value);
  })()`);
  if (given !== stars) throw new Error(`Rating: ${given}`);
});
