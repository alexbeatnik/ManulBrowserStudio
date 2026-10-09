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

Chromium or Firefox, headed or headless, from the toolbar.

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

The two are separate engine processes with separate browsers, so running a
file never disturbs the page being explored.

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
               the built-in Node for hook scripts.
src/preload/   The one door between the window and the main process.
src/renderer/  The window: editor, explorer, panels, page panel.
data/dsl.json  The DSL catalogue.
test/          Unit tests for everything that needs no window.
```

`src/core` began as a copy of
[ManulBrowserExtension](https://github.com/alexbeatnik/ManulBrowserExtension)'s
`src/core`, which has no dependency on VS Code. `engine.ts`, `huntDoc.ts`,
`catalogue.ts` and `hooks.ts` are unchanged; `runner.ts` has gained the `vars` marker. Until
the two share a package, a fix to one belongs in the other.

## Checking it

```
npm run typecheck   # types, all three processes
npm test            # unit tests; no browser, no window
npm run smoke       # the app checking itself, end to end
```

`npm run smoke` opens the window, a real engine and a real (headless) browser,
and does what a person would: runs a hunt against a local page, debugs it to a
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
bare folder of `.hunt` files with nothing else installed.

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
- The page panel's picture is a full-page screenshot scaled to the panel, with
  no zoom, and elements cannot be picked by clicking on the picture.
- Breakpoints changed while a run is in progress take effect on the next run.
- Hook scripts are for runs of a file; the live session does not load them.
- No completion for Python or Go: that takes a language server each (Pyright,
  gopls), which the app does not carry.

## License

Apache-2.0.
