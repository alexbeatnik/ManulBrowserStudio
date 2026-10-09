// The main process: one window, its menu, and the services the window asks
// things of.

import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { grouped } from '../core/catalogue';
import {
  CatalogueView,
  DebugAction,
  DemoOffer,
  MenuCommand,
  PageRect,
  RunEvent,
  RunRequest,
  Settings,
} from '../shared/api';
import { BuiltInBrowser } from './builtInBrowser';
import { hookTemplate, HOOK_BASENAMES } from '../core/hooks';
import { openDemo } from './demo';
import { EngineService } from './engineService';
import { builtInNode } from './hookRuntime';
import { LiveService } from './live';
import { PackageService } from './packages';
import { RunService } from './runs';
import { SettingsStore } from './settings';
import { runSmoke } from './smoke';
import { Workspace } from './workspace';

let window: BrowserWindow | undefined;

const send = (channel: string, payload: unknown): void => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
};
const menu = (command: MenuCommand) => (): void => send('studio:menu', command);

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: menu('open-folder') },
        { label: 'Open Demo Project', click: menu('open-demo') },
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: menu('new-file') },
        { label: 'New Folder…', accelerator: 'CmdOrCtrl+Shift+N', click: menu('new-folder') },
        { label: 'New Hook Script', click: menu('new-hooks') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: menu('save') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Format Hunt', accelerator: 'Shift+Alt+F', click: menu('format') },
      ],
    },
    {
      label: '&Run',
      submenu: [
        { label: 'Run File', accelerator: 'F5', click: menu('run') },
        { label: 'Debug File (stop at breakpoints)', accelerator: 'F6', click: menu('debug') },
        { label: 'Step Through File', accelerator: 'F7', click: menu('step-through') },
        { label: 'Stop', accelerator: 'Shift+F5', click: menu('stop') },
        { type: 'separator' },
        { label: 'Run Line in Live Session', accelerator: 'CmdOrCtrl+Enter', click: menu('run-line') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#15171c',
    title: 'Manul Browser Studio',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The window shows the app and nothing else: a link goes to the system
  // browser, and nothing navigates the window away from its own page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

function main(): void {
  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  if (smokeOut !== undefined) {
    // The same every time, whatever the last smoke run left in its profile.
    store.update({
      // A folder that was open last time and has been deleted since — the
      // demo project itself, as likely as not. It must not be opened.
      workspace: path.join(smokeOut, 'deleted since'),
      browser: 'chromium',
      headless: true,
      screenshots: 'always',
      enginePath: process.env.MANUL_BROWSER_STUDIO_ENGINE ?? '',
      demoOffer: '',
    });
  }
  const settings = (): Settings => store.get();
  const appRoot = app.getAppPath();
  // The installer asks whether the demo project is wanted, and with a yes
  // leaves a file beside the app that says when it was asked. Each yes is
  // acted on once — so installing again brings back a demo that was deleted,
  // and starting again does not. A run from source has no installer to ask,
  // and counts as one yes.
  const offer = installedDemoOffer();
  let demoOffer: DemoOffer = offer && settings().demoOffer !== offer ? (app.isPackaged ? 'installer' : 'source') : '';
  if (demoOffer) store.update({ demoOffer: offer });
  const engineRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : appRoot;
  const engines = new EngineService(settings, appRoot, engineRoot);
  const workspace = new Workspace(() => settings().workspace);
  const builtIn = new BuiltInBrowser(
    () => window,
    (state) => send('studio:pageState', state),
  );
  const runs = new RunService(
    engines,
    settings,
    (event: RunEvent) => send('studio:runEvent', event),
    // engineRoot is also where the binding is a real folder on disk, which is
    // what a Node outside the app needs to import it.
    () => builtInNode(hookRuntimeHomes(), process.execPath, engineRoot),
    builtIn,
  );
  const live = new LiveService(engines, settings, builtIn);
  // npm keeps its dependencies inside its own folder, which the packager
  // leaves behind; an installed app carries the folder whole, as a resource
  // beside the archive (scripts/after-pack.cjs puts it there).
  const npmDir = app.isPackaged
    ? path.join(process.resourcesPath, 'npm')
    : path.join(appRoot, 'node_modules', 'npm');
  const packages = new PackageService(settings, npmDir, (line) => send('studio:packageLog', line));

  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(`studio:${channel}`, (_event, ...args) => fn(...(args as A)));
  };

  handle('getSettings', () => settings());
  handle('setSettings', async (patch: Partial<Settings>) => {
    const before = settings();
    const after = store.update(patch);
    if (after.workspace !== before.workspace || after.enginePath !== before.enginePath) {
      engines.invalidate();
      // The session's browser belongs to the folder it was opened for.
      if (after.workspace !== before.workspace) await live.close();
    }
    // And to the browser it was opened in.
    if (after.browser !== before.browser) await live.close();
    return after;
  });
  handle('chooseFolder', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  });
  handle('chooseEngine', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose the Manul engine',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Manul engine', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  handle('listDir', (dir: string) => workspace.list(dir));
  handle('readFile', (file: string) => workspace.read(file));
  handle('writeFile', (file: string, text: string) => workspace.write(file, text));
  handle('createFile', (dir: string, name: string) => workspace.create(dir, name));
  handle('createFolder', (dir: string, name: string) => workspace.mkdir(dir, name));
  handle('createHookScript', async () => {
    const folder = settings().workspace;
    if (!folder) throw new Error('Open a folder first.');
    // One hook script per folder is what a run picks up; a second would only
    // shadow the first.
    const existing = HOOK_BASENAMES.map((name) => path.join(folder, name)).find((file) => fs.existsSync(file));
    if (existing) return existing;
    const file = await workspace.create(folder, 'manul_hooks.mjs');
    await workspace.write(file, hookTemplate('node').replace('the Manul Browser extension', 'Manul Browser Studio'));
    return file;
  });

  handle('demoOffer', () => {
    const pending = demoOffer;
    demoOffer = '';
    return pending;
  });
  handle('openDemo', () =>
    openDemo(
      path.join(appRoot, 'demo'),
      // A smoke run keeps to its own folder.
      smokeOut !== undefined ? [smokeOut] : [app.getPath('documents'), app.getPath('userData')],
    ),
  );

  handle('engine', () => engines.status());
  // Gathered at build time (scripts/type-libraries.mjs): a packaged app has no
  // declaration files in its node_modules to read them from.
  handle('typeLibraries', () => JSON.parse(fs.readFileSync(path.join(__dirname, 'type-libraries.json'), 'utf8')));
  handle('catalogue', async (): Promise<CatalogueView> => {
    const catalogue = await engines.catalogue();
    return { catalogue, groups: grouped(catalogue) };
  });

  handle('runtime', () => packages.runtime());
  handle('packages', () => packages.list());
  handle('installPackages', (text: string) => packages.install(text));
  handle('removePackage', (name: string) => packages.remove(name));

  handle('startRun', (request: RunRequest) => runs.start(request));
  handle('stopRun', () => runs.stop());
  handle('debug', (action: DebugAction) => runs.debug(action));

  handle('liveOpen', () => live.open());
  handle('liveClose', () => live.close());
  handle('liveRefresh', () => live.refresh());
  handle('liveStep', (step: string) => live.step(step));

  handle('pagePlace', (rect: PageRect | null) => {
    // The window says where in its own pixels, which a zoomed window has
    // fewer of.
    const zoom = window?.webContents.getZoomFactor() ?? 1;
    return builtIn.place(
      rect && { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom },
    );
  });
  handle('pageNavigate', (url: string) => builtIn.navigate(url));

  // Emptied here and not by the smoke run: the window may put the demo
  // project in it before the run has begun.
  if (smokeOut !== undefined) fs.rmSync(smokeOut, { recursive: true, force: true });
  Menu.setApplicationMenu(buildMenu());
  window = createWindow();

  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    // The engine closes the browser it launched on the way out; give both
    // the moment that takes, then leave whatever happened.
    closing = true;
    event.preventDefault();
    runs.stop();
    builtIn.dispose();
    void Promise.race([live.close(), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());

  if (smokeOut !== undefined) {
    void runSmoke(window, smokeOut, builtIn)
      .catch((err: unknown) => {
        console.error(err);
        return 1;
      })
      .then(async (code) => {
        runs.stop();
        await Promise.race([live.close(), new Promise((r) => setTimeout(r, 5000))]);
        // Not app.quit(): the window would ask about the file the run edited.
        app.exit(code);
      });
  }
}

/**
 * What stands for the latest yes to the demo project: what the installer
 * wrote beside the app, or a fixed word for a run that had no installer.
 * '' when the answer was no.
 */
function installedDemoOffer(): string {
  if (!app.isPackaged || smokeOut !== undefined) return 'source';
  try {
    // An installer from before the file said anything left it empty.
    return fs.readFileSync(path.join(process.resourcesPath, 'demo-project'), 'utf8').trim() || 'installed';
  } catch {
    return '';
  }
}

/**
 * Where the launcher for hook scripts may be written, best first. Not in the
 * per-user data folder alone: its path has the app's name in it, and Windows
 * cannot start a batch file from a path with a space (see hookRuntime.ts).
 * The others are there for an account whose own name has one.
 */
function hookRuntimeHomes(): string[] {
  // A smoke run keeps its launcher apart, so that one written for the app
  // being checked is never picked up by the app the person has open.
  const name = smokeOut !== undefined ? 'manul-browser-studio-smoke' : 'manul-browser-studio';
  const homes: string[] = [];
  if (process.env.LOCALAPPDATA) homes.push(path.join(process.env.LOCALAPPDATA, name, 'hook-runtime'));
  homes.push(path.join(app.getPath('temp'), `${name}-hook-runtime`));
  if (process.env.ProgramData) {
    const account = (process.env.USERNAME ?? 'user').replace(/[^A-Za-z0-9_-]/g, '_');
    homes.push(path.join(process.env.ProgramData, name, account, 'hook-runtime'));
  }
  homes.push(path.join(app.getPath('userData'), 'hook-runtime'));
  return homes;
}

/** The value after a flag, '' when the flag is last or followed by another. */
function argAfter(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  if (at < 0) return undefined;
  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : '';
}

const smokeDir = argAfter('--smoke');
/** Where a smoke run writes what it saw. */
const smokeOut =
  smokeDir === undefined ? undefined : smokeDir || path.join(app.getPath('temp'), 'manul-browser-studio-smoke');
// A smoke run must not read, or leave behind, a real user's settings — and
// must be free to start while the app itself is open.
if (smokeOut !== undefined) app.setPath('userData', path.join(app.getPath('temp'), 'manul-browser-studio-smoke-profile'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  void app.whenReady().then(main);
}
