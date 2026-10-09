# Manul Browser Studio

A desktop IDE for [Manul Browser](https://github.com/alexbeatnik/manul-browser):
write `.hunt` files in plain English, run them, step through them, and look at
the page they drive.

```
npm install
npm start
```

This is the Studio for the Go engine. The earlier Manul Studio, built for the
Python ManulEngine, is a different program and lives in
[ManulStudio](https://github.com/alexbeatnik/ManulStudio).

Node 22 or newer. The engine comes with the `manul-browser` npm package this
app depends on, so there is nothing else to install; a project that pins its
own engine (npm, pip, or a Go build) is run on that one instead.

## What it does

**Editor.** `.hunt` files with colouring, completion and hover text for every
verb, header and block the DSL contract lists, snippets with placeholders,
variable completion inside `{…}`, and a formatter (Shift+Alt+F). A step palette
in the sidebar inserts any step on a line of its own.

**Hook scripts.** A `manul_hooks.mjs` beside a hunt (File → New Hook Script
writes a starter one) is picked up by every run of that hunt: suite hooks,
`CALL HOST` handlers, custom controls. It runs on the Node that is built into
the app and imports the `manul-browser` that came with it, so a folder of hunts
needs neither Node nor `npm install` — unless it has its own copy of the
binding, which then wins. In the editor such a script completes against the
binding's types and Node's. A Python hook script (`manul_hooks.py`) is picked
up too, and needs a Python with `manul-browser` installed.

**Libraries.** The Libraries tab installs npm packages into the open folder
for its hook scripts to import, and lists and removes the ones that are there.
npm comes with the app and runs on the app's own Node — whose version is in
the status bar — so this needs no Node on the machine either.

**Other files.** Python, Go, JSON, HTML, CSS, Markdown and the rest are
coloured; JavaScript and TypeScript have completion as well. Every kind of
file has its icon in the tree and on its tab, and a hunt has Manul Browser's.

**Run with live results.** F5 runs the file. Each step is marked in the margin
as it finishes, with its duration or its error written after the line; the
Results panel lists the steps with their scores, and for a failed one the
elements on the page that came closest. The engine's own output is under
Output.

**Debugger.** Click left of a line number (or F9) for a breakpoint, F6 to run
to it, F7 to pause before every step. While paused: Continue (F5), Step (F10),
Explain — what the step would act on, without running it — and the hunt's
variables, live, under Variables.

**Page panel.** Start a live session and a browser opens that the panel shows:
a picture of the page and a list of what on it can be acted on. Click an
element and the step that acts on it is written into the file; "verify" writes
the assertion instead. Ctrl+Enter runs the line under the caret in that browser
and moves on, so a hunt can be written a step at a time against the real page.
During a run of a file, the panel shows the screenshots the run records.

**Browsers.** Three, from the toolbar. *Built-in* is a page of the app's own
Chromium, in the page panel itself: a run of a file happens there, in front of
the person, and so does the live session — the panel is the browser, not a
picture of one. The page is laid out at desktop width, 1280 pixels, and drawn
to fit the panel; it can be clicked and typed into, and the address above it
takes it anywhere. *Chromium* and *Firefox* are the ones installed on the
machine, which the engine starts in a window of their own, headed or headless.

## The demo project

The app comes with a project to try it on: a small shop that is opened from
disk, and four hunts written for it — plain steps, a hunt with a bug to find,
page objects with a loop and `CALL HOST`, and two widgets filled in through
custom controls. The source is `demo/`; its own `README.md` is the tour.

File → Open Demo Project copies it to `Documents\Manul Browser Demo` and
opens it. The copy is the person's: a file that is there is never replaced,
and one that has been deleted is put back. Two of the hunts have the shop's
address written into them as the copy is made, so that their lines can be run
one at a time in a live session; the others get it from the hook script.

The installer asks whether the demo is wanted. With a yes, the next start of
the app opens it instead of an empty window — or, for a person who has a
folder of their own open, puts it in place and says where. Each yes is acted
on once, so installing again brings back a demo that was deleted and starting
again does not. A first run from source counts as one yes.

## How it talks to the engine

The app contains no part of the engine: no scoring, no DSL parsing, no browser
protocol. It uses the two interfaces the engine publishes.

- **A run of a file** is one `manul run <file> --jsonl` process. Its stdout is
  a result per step and one for the hunt; with `--break-lines` or `--debug` it
  also carries the pause markers of the
  [debug contract](https://github.com/alexbeatnik/manul-browser/blob/main/spec/contracts/MANUL_DEBUG_CONTRACT.md),
  and stdin carries the answers.
- **The live session** is `manul serve --stdio`, held open through the
  engine's Node binding.

The two are separate engine processes. With Chromium or Firefox each has a
browser of its own, so running a file never disturbs the page being explored.

**The built-in browser** is not started by the engine but attached to, the way
the engine attaches to any browser that is already running: it is given an
address, asks there which pages there are, and speaks the DevTools protocol to
the one it is told of. `src/main/cdpBridge.ts` is that address — a server on
127.0.0.1, on a port of its own choosing, that lists exactly one page and
passes what it is sent to it. Electron's own debugging port is not opened: it
would list the app's window as well, with the person's files behind it. A run
is `manul run <file> --cdp <address>`; before it the page is given what a new
browser has — no cookies, nothing stored. With this browser a run and the live
session share the one page.

A run is started in the open folder, exactly as `manul run` would be from a
terminal there, so it leaves what the CLI leaves: `reports/` with the run
history and, when screenshots are on, `screenshots/`. Installing a library
leaves what `npm install` leaves: `package.json`, a lockfile and
`node_modules/`.

The verbs the editor knows come from `data/dsl.json`, a copy of the engine's
DSL contract (`npm run dsl` regenerates it from a `manul-browser` checkout
beside this one), widened at run time by whatever the installed engine's
`manul schema` reports.

### What needs a particular engine

Variables at a debug pause use the `vars` command of debug contract 0.2.1,
which the engine has from 0.1.3; the app comes with 0.1.4. A project that
pins an older engine is still run on its own engine and gets everything else;
the Variables panel just stays empty while it is paused.

## Layout

```
src/core/      Finding the engine, running a hunt, reading a .hunt file.
               Shared with ManulBrowserExtension — see below.
src/shared/    Types that cross the process boundary; step templates.
src/main/      The main process: files, settings, runs, the live session,
               the built-in browser and the address the engine reaches it
               at, the built-in Node for hook scripts.
src/preload/   The one door between the window and the main process.
src/renderer/  The window: editor, explorer, panels, page panel.
data/dsl.json  The DSL catalogue.
demo/          The demo project, as it is before it is copied.
build/         The icon, and the installer's extra page (installer.nsh).
test/          Unit tests for everything that needs no window.
```

`src/core` began as a copy of
[ManulBrowserExtension](https://github.com/alexbeatnik/ManulBrowserExtension)'s
`src/core`, which has no dependency on VS Code. `engine.ts`, `catalogue.ts`
and `hooks.ts` are unchanged; `runner.ts` has gained the `vars` marker, and
`huntDoc.ts` puts a step of a borrowed block on the `USE` line that brought it
in. Until the two share a package, a fix to one belongs in the other.

## Checking it

```
npm run typecheck   # types, all three processes
npm test            # unit tests; no browser, no window
npm run smoke       # the app checking itself, end to end
```

`npm run smoke` opens the window, a real engine and a real (headless) browser,
and does what a person would: starts with the demo project and runs each of
its hunts, then runs a hunt of its own against a local page, debugs it to a
breakpoint, steps, asks for an explanation, runs a line in a live session and
picks an element off the page, creates a folder, and installs a library (the
one step that needs the network; without it, it says so and moves on). It writes screenshots and `report.json` to a
temp folder (or `electron . --smoke <dir>`), and exits non-zero if any
expectation failed. `MANUL_BROWSER_STUDIO_ENGINE` points it at a particular engine
binary.

## Building the installer

```
npm run dist
```

builds `release/ManulBrowserStudio-Setup-<version>.exe`, a Windows x64 installer, and
`release/win-unpacked/`, the same app as a plain folder. The engine that came
with the `manul-browser` dependency is packed in, so an installed Studio runs a
bare folder of `.hunt` files with nothing else installed. The installer has a
page of its own (`build/installer.nsh`) that offers the demo project.

The installer is not code-signed: Windows SmartScreen will say so the first
time it is run. `release/win-unpacked/Manul Browser Studio.exe --smoke <dir>` runs the
end-to-end check against the packaged app.

## Not there yet

- Windows x64 only, and unsigned; no macOS or Linux package.
- One folder at a time. Files and folders can be created in the tree, not
  renamed or deleted.
- A library installed for hook scripts is not known to the editor's
  completion, and one that compiles native code may not build or load: the
  app's Node is Electron's.
- The page panel's picture of an installed browser is a full-page screenshot
  scaled to the panel, with no zoom; elements cannot be picked by clicking on
  it, nor on the built-in browser's page.
- The built-in browser is one page: a link that opens a new window is followed
  in it, and there are no downloads. It is drawn above the window, so it is
  taken out of sight while a dialog of the app is open or a splitter is
  dragged. In a narrow panel a page is small; the panel can be made wider.
- Breakpoints changed while a run is in progress take effect on the next run.
- A run paused inside a block borrowed with `USE` has no line marked: the
  engine's pause names the step, not the block it came from. The results of
  such steps are put on the `USE` line.
- Hook scripts are for runs of a file; the live session does not load them.
- No completion for Python or Go: that takes a language server each (Pyright,
  gopls), which the app does not carry.

## License

Apache-2.0.
