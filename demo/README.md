# Manul Browser Demo

A small project to try Manul Browser Studio on: a shop, and four hunts
written for it. Nothing here needs the network or anything installed. It is
your copy — change whatever you like; File → Open Demo Project puts back any
file that has been deleted and leaves the rest alone.

## Start here

Open `hunts/01-first-order.hunt` and press **F5**. The hunt orders a blanket
in the page panel on the right, and each line is marked as it finishes. The
Results panel lists the steps; Output has the engine's own log. (That is with
*Built-in* chosen under Browser in the toolbar. With Chromium or Firefox the
run opens a window of that browser instead.)

Then, in the same file, put the caret on a step and press **Ctrl+Enter**: the
line is run on its own, in the same page. A list of what is on the page
appears under it; click an element there and the step that acts on it is
written into the file.

## The hunts

| File | What it shows |
| --- | --- |
| `01-first-order.hunt` | Plain steps, start to finish: `NAVIGATE`, `FILL`, `SELECT`, `CHECK`, `VERIFY`, `EXTRACT`, and `NEAR` to say which of six identical buttons is meant. |
| `02-find-the-bug.hunt` | A hunt that fails on purpose. The failed line says why, and the Results panel lists what on the page came closest. Fix it. |
| `03-full-cart.hunt` | Page objects, a `FOR EACH` loop, an `IF`, and `CALL HOST` asking the hook script for a promo code and for what the total should be. |
| `04-delivery-date.hunt` | Two widgets no browser automation can fill in on its own — a calendar and a row of drawn stars — as ordinary `FILL` lines, through custom controls. |

To debug any of them, click left of a line number (or **F9**) and press
**F6**. While paused: **F10** runs one step, Explain says what the next step
would act on, and Variables shows what the hunt knows so far.

## How the project is laid out

```
hunts/              The hunts.
pages/              Page objects: the steps that belong to a page, as blocks
                    a hunt borrows by name (@import … then USE …), and
                    steppe-goods.json, which gives the shop's pages the names
                    the engine's log calls them by.
manul_hooks.mjs     The hook script. Every run of a hunt here picks it up.
support/            What the hook script registers, one kind per file:
  suite.mjs           what runs before and after the hunts, and sets {shop}
  calls.mjs           the CALL HOST handlers
  controls.mjs        the custom controls
manul.config.json   Engine settings for this folder.
site/               The shop: three files, opened straight from disk.
```

A run also leaves `reports/` here, and `screenshots/` when screenshots are on.

### Page objects

`pages/shop.hunt`, `cart.hunt` and `checkout.hunt` are hunt files whose STEP
blocks are meant to be borrowed:

```
@import: Open the shop, Add the product from '../pages/shop.hunt'

STEP 1: Fill the cart
    USE Open the shop
    SET {product} = Tea Sampler
    USE Add the product
```

A block has no parameters; it is run with the variables of the hunt that uses
it. When the shop's `Add to cart` button is renamed, one line in
`pages/shop.hunt` changes and every hunt follows.

### Hooks

`manul_hooks.mjs` is JavaScript, run on the Node built into the Studio. It
sets `{shop}` — the address of `site/`, wherever this folder is — before any
hunt starts, gives every hunt tagged `checkout` a customer, and answers
`CALL HOST`. The first two hunts do not depend on it: they have the address
written out, which is what lets their lines be run one at a time.

### Custom controls

The delivery date on the checkout page is a calendar that opens from a
button, and the rating under an order is five drawn stars. Neither is a field.
`support/controls.mjs` registers a handler for each by name, and the engine
hands it any step aimed at that name:

```
FILL 'Delivery date' field with '{day}'
FILL 'Rating' field with '5'
```

## If the folder is moved

`03` and `04` keep working: the hook script works out where the shop is. `01`
and `02` have the old address in their `NAVIGATE` line; change it there, or
delete the two files and choose File → Open Demo Project to have them written
again.
