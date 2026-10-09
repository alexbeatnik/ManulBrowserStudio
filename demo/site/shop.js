// The whole shop: a catalogue, a cart, a checkout form and a confirmation,
// one route each, drawn into <main>. Nothing is kept between page loads and
// nothing leaves the page, so every run of a hunt starts from an empty cart.

const PRODUCTS = [
  { name: 'Wool Blanket', price: 48, about: 'Heavy, undyed, and warmer than it looks.' },
  { name: 'Steel Thermos', price: 24, about: 'Keeps tea hot from dawn until the wind drops.' },
  { name: 'Trail Lantern', price: 32, about: 'A soft light that lasts the night on one charge.' },
  { name: 'Felt Slippers', price: 19, about: 'For the yurt, not for the rocks.' },
  { name: 'Tea Sampler', price: 12, about: 'Six small tins, one of them smoky.' },
  { name: 'Field Notebook', price: 9, about: 'Dotted pages that do not mind the rain.' },
];

const DELIVERY = { Standard: 0, Express: 8, Pickup: 0 };
const PROMO_CODES = { MANUL10: 10 };
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const state = { cart: new Map(), discount: 0, orders: 1041, order: null };

const view = document.getElementById('view');
const notice = document.getElementById('notice');
const cartButton = document.getElementById('cart-button');

const money = (amount) => `$${amount.toFixed(2)}`;
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const two = (n) => String(n).padStart(2, '0');
const iso = (date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

function subtotal() {
  let sum = 0;
  for (const [name, quantity] of state.cart) sum += PRODUCTS.find((p) => p.name === name).price * quantity;
  return sum;
}

function total(delivery = 'Standard') {
  return subtotal() * (1 - state.discount / 100) + DELIVERY[delivery];
}

function say(text) {
  notice.textContent = text;
}

function refreshCartButton() {
  let count = 0;
  for (const quantity of state.cart.values()) count += quantity;
  cartButton.textContent = `Cart (${count})`;
}

// ── routes ───────────────────────────────────────────────────────────────────

const ROUTES = {
  '': { title: 'Shop', draw: showCatalogue },
  '#/cart': { title: 'Cart', draw: showCart },
  '#/checkout': { title: 'Checkout', draw: showCheckout },
  '#/thanks': { title: 'Order placed', draw: showConfirmation },
};

function go(hash) {
  if (location.hash === hash || (!hash && !location.hash)) route();
  else location.hash = hash;
}

function route() {
  let hash = location.hash === '#/' ? '' : location.hash;
  if (!ROUTES[hash]) hash = '';
  // Pages that need something to show send the visitor to where it is made.
  if (hash === '#/checkout' && state.cart.size === 0) hash = '#/cart';
  if (hash === '#/thanks' && !state.order) hash = '';
  document.title = `Steppe Goods - ${ROUTES[hash].title}`;
  say('');
  ROUTES[hash].draw();
}

// ── catalogue ────────────────────────────────────────────────────────────────

function showCatalogue() {
  view.innerHTML = `
    <h1>Shop</h1>
    <div class="search">
      <label for="search">Search</label>
      <input type="search" id="search" placeholder="Search products">
    </div>
    <div class="products" id="products"></div>`;
  const search = document.getElementById('search');
  search.addEventListener('input', () => drawProducts(search.value));
  drawProducts('');
}

function drawProducts(wanted) {
  const host = document.getElementById('products');
  const found = PRODUCTS.filter((p) => p.name.toLowerCase().includes(wanted.trim().toLowerCase()));
  host.innerHTML = found.length
    ? found
        .map(
          (p) => `
      <article class="product" aria-label="${escape(p.name)}">
        <div class="name">${escape(p.name)}</div>
        <div class="buy">
          <span class="price">${money(p.price)}</span>
          <button type="button" data-add="${escape(p.name)}">Add to cart</button>
        </div>
        <p>${escape(p.about)}</p>
      </article>`,
        )
        .join('')
    : '<p>Nothing in the shop is called that.</p>';
  for (const button of host.querySelectorAll('[data-add]')) {
    button.addEventListener('click', () => {
      const name = button.dataset.add;
      state.cart.set(name, (state.cart.get(name) ?? 0) + 1);
      refreshCartButton();
      say(`${name} added to cart`);
    });
  }
}

// ── cart ─────────────────────────────────────────────────────────────────────

function showCart() {
  if (state.cart.size === 0) {
    view.innerHTML = `
      <h1>Your cart</h1>
      <p>Your cart is empty.</p>
      <div class="actions"><button type="button" class="plain" id="back">Continue shopping</button></div>`;
    document.getElementById('back').addEventListener('click', () => go(''));
    return;
  }
  const rows = [...state.cart]
    .map(([name, quantity]) => {
      const price = PRODUCTS.find((p) => p.name === name).price;
      return `
        <tr>
          <td>${escape(name)}</td>
          <td>${quantity}</td>
          <td>${money(price * quantity)}</td>
          <td><button type="button" class="plain" data-remove="${escape(name)}">Remove</button></td>
        </tr>`;
    })
    .join('');
  view.innerHTML = `
    <h1>Your cart</h1>
    <table class="cart" aria-label="Cart">
      <thead><tr><th>Product</th><th>Quantity</th><th>Price</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="summary">
      <tr><th scope="row">Total</th><td>${money(total())}</td></tr>
    </table>
    <div class="promo">
      <label for="promo">Promo code</label>
      <input type="text" id="promo" autocomplete="off">
      <button type="button" class="plain" id="apply">Apply</button>
      <span id="promo-note">${state.discount ? `Promo code applied: ${state.discount}% off` : ''}</span>
    </div>
    <div class="actions">
      <button type="button" id="checkout">Checkout</button>
      <button type="button" class="plain" id="back">Continue shopping</button>
    </div>`;
  for (const button of view.querySelectorAll('[data-remove]')) {
    button.addEventListener('click', () => {
      state.cart.delete(button.dataset.remove);
      refreshCartButton();
      showCart();
      say(`${button.dataset.remove} removed`);
    });
  }
  document.getElementById('apply').addEventListener('click', () => {
    const code = document.getElementById('promo').value.trim().toUpperCase();
    const percent = PROMO_CODES[code];
    if (!percent) {
      document.getElementById('promo-note').textContent = 'That code is not one of ours';
      return;
    }
    state.discount = percent;
    showCart();
  });
  document.getElementById('checkout').addEventListener('click', () => go('#/checkout'));
  document.getElementById('back').addEventListener('click', () => go(''));
}

// ── the date picker ──────────────────────────────────────────────────────────
//
// A calendar that opens from a button, the way component libraries build
// them: there is no <input> to type a date into. A person clicks through the
// months; a hunt needs a custom control to do the same (support/controls.mjs).

function datePicker(host) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let shown = new Date(today.getFullYear(), today.getMonth(), 1);

  const draw = (open) => {
    const year = shown.getFullYear();
    const month = shown.getMonth();
    const blanks = (new Date(year, month, 1).getDay() + 6) % 7; // weeks start on Monday
    const days = new Date(year, month + 1, 0).getDate();
    let cells = '<i></i>'.repeat(blanks);
    for (let day = 1; day <= days; day++) {
      const date = new Date(year, month, day);
      const value = iso(date);
      const chosen = value === host.dataset.value ? ' chosen' : '';
      // Nothing is delivered the day it is ordered.
      cells += `<button type="button" class="day${chosen}" data-date="${value}"${date <= today ? ' disabled' : ''}>${day}</button>`;
    }
    host.innerHTML = `
      <button type="button" class="date-display plain">${host.dataset.value || 'Choose a date'}</button>
      <div class="calendar"${open ? '' : ' hidden'}>
        <div class="calendar-head">
          <button type="button" class="plain prev" aria-label="Previous month">&lsaquo;</button>
          <span class="month" data-month="${year}-${two(month + 1)}">${MONTHS[month]} ${year}</span>
          <button type="button" class="plain next" aria-label="Next month">&rsaquo;</button>
        </div>
        <div class="calendar-grid">${cells}</div>
      </div>`;
    host.querySelector('.date-display').addEventListener('click', () => draw(!open));
    host.querySelector('.prev').addEventListener('click', () => {
      shown = new Date(year, month - 1, 1);
      draw(true);
    });
    host.querySelector('.next').addEventListener('click', () => {
      shown = new Date(year, month + 1, 1);
      draw(true);
    });
    for (const day of host.querySelectorAll('.day')) {
      day.addEventListener('click', () => {
        host.dataset.value = day.dataset.date;
        draw(false);
      });
    }
  };
  draw(false);
}

// ── checkout ─────────────────────────────────────────────────────────────────

function showCheckout() {
  view.innerHTML = `
    <h1>Checkout</h1>
    <form class="checkout" id="checkout-form" novalidate>
      <label class="field">Full name <input type="text" id="name" autocomplete="off"></label>
      <label class="field">Email <input type="email" id="email" autocomplete="off"></label>
      <label class="field">Delivery
        <select id="delivery">
          ${Object.keys(DELIVERY).map((d) => `<option>${d}</option>`).join('')}
        </select>
      </label>
      <div class="field">
        <span>Delivery date</span>
        <div class="datepicker" id="delivery-date" data-value=""></div>
      </div>
      <fieldset>
        <legend>Payment</legend>
        <label><input type="radio" name="payment" value="Card" checked> Card</label>
        <label><input type="radio" name="payment" value="Cash on delivery"> Cash on delivery</label>
      </fieldset>
      <label><input type="checkbox" id="terms"> I accept the terms</label>
      <table class="summary">
        <tr><th scope="row">To pay</th><td id="to-pay">${money(total())}</td></tr>
      </table>
      <p class="error" id="error" role="alert"></p>
      <div class="actions">
        <button type="submit">Place order</button>
        <button type="button" class="plain" id="back">Back to cart</button>
      </div>
    </form>`;
  const delivery = document.getElementById('delivery');
  const date = document.getElementById('delivery-date');
  datePicker(date);
  delivery.addEventListener('change', () => {
    document.getElementById('to-pay').textContent = money(total(delivery.value));
  });
  document.getElementById('back').addEventListener('click', () => go('#/cart'));
  document.getElementById('checkout-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const complain = (text) => {
      document.getElementById('error').textContent = text;
    };
    if (!name) return complain('Please enter your full name');
    if (!/^\S+@\S+\.\S+$/.test(email)) return complain('Please enter an email address');
    if (!document.getElementById('terms').checked) return complain('Please accept the terms');
    state.orders += 1;
    state.order = {
      number: `MB-${state.orders}`,
      name,
      email,
      delivery: delivery.value,
      date: date.dataset.value || 'As soon as possible',
      payment: view.querySelector('[name="payment"]:checked').value,
      paid: total(delivery.value),
    };
    state.cart.clear();
    state.discount = 0;
    refreshCartButton();
    go('#/thanks');
  });
}

// ── confirmation ─────────────────────────────────────────────────────────────

function showConfirmation() {
  const order = state.order;
  // The stars are drawn, not form controls: nothing here says "radio" or
  // "button" to a browser. Another widget a hunt reaches through a custom
  // control.
  view.innerHTML = `
    <h1>Thank you, ${escape(order.name)}!</h1>
    <p>Your order is on its way. A note went to ${escape(order.email)}.</p>
    <table class="summary">
      <tr><th scope="row">Order number</th><td>${order.number}</td></tr>
      <tr><th scope="row">Delivery</th><td>${escape(order.delivery)}</td></tr>
      <tr><th scope="row">Delivery date</th><td>${escape(order.date)}</td></tr>
      <tr><th scope="row">Payment</th><td>${escape(order.payment)}</td></tr>
      <tr><th scope="row">Paid</th><td>${money(order.paid)}</td></tr>
    </table>
    <div class="rating" id="rating" data-value="0">
      <span>How was it?</span>
      <span class="stars">${[1, 2, 3, 4, 5].map((n) => `<i data-star="${n}">&#9733;</i>`).join('')}</span>
      <span id="rating-note"></span>
    </div>
    <div class="actions"><button type="button" id="back">Back to the shop</button></div>`;
  const rating = document.getElementById('rating');
  for (const star of rating.querySelectorAll('[data-star]')) {
    star.addEventListener('click', () => {
      const value = Number(star.dataset.star);
      rating.dataset.value = String(value);
      for (const other of rating.querySelectorAll('[data-star]')) {
        other.classList.toggle('lit', Number(other.dataset.star) <= value);
      }
      document.getElementById('rating-note').textContent = `Thanks for the ${value} ${value === 1 ? 'star' : 'stars'}!`;
    });
  }
  document.getElementById('back').addEventListener('click', () => go(''));
}

cartButton.addEventListener('click', () => go('#/cart'));
document.getElementById('home').addEventListener('click', (event) => {
  event.preventDefault();
  go('');
});
window.addEventListener('hashchange', route);

route();
