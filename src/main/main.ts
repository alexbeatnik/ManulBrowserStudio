// The main process: one window, its menu, and the services the window asks
// things of.

import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron';
import * as path from 'path';
import { grouped } from '../core/catalogue';
import { CatalogueView, DebugAction, MenuCommand, RunEvent, RunRequest, Settings } from '../shared/api';
import { EngineService } from './engineService';
import { LiveService } from './live';
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
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: menu('new-file') },
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
    title: 'Manul Studio',
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
  if (smokeDir !== undefined) {
    // The same every time, whatever the last smoke run left in its profile.
    store.update({
      workspace: '',
      browser: 'chromium',
      headless: true,
      screenshots: 'always',
      enginePath: process.env.MANUL_STUDIO_ENGINE ?? '',
    });
  }
  const settings = (): Settings => store.get();
  const appRoot = app.getAppPath();
  const engineRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : appRoot;
  const engines = new EngineService(settings, appRoot, engineRoot);
  const workspace = new Workspace(() => settings().workspace);
  const runs = new RunService(engines, settings, (event: RunEvent) => send('studio:runEvent', event));
  const live = new LiveService(engines, settings);

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

  handle('engine', () => engines.status());
  handle('catalogue', async (): Promise<CatalogueView> => {
    const catalogue = await engines.catalogue();
    return { catalogue, groups: grouped(catalogue) };
  });

  handle('startRun', (request: RunRequest) => runs.start(request));
  handle('stopRun', () => runs.stop());
  handle('debug', (action: DebugAction) => runs.debug(action));

  handle('liveOpen', () => live.open());
  handle('liveClose', () => live.close());
  handle('liveRefresh', () => live.refresh());
  handle('liveStep', (step: string) => live.step(step));

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
    void Promise.race([live.close(), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());

  if (smokeDir !== undefined) {
    void runSmoke(window, smokeDir || path.join(app.getPath('temp'), 'manul-studio-smoke'))
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

/** The value after a flag, '' when the flag is last or followed by another. */
function argAfter(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  if (at < 0) return undefined;
  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : '';
}

const smokeDir = argAfter('--smoke');
// A smoke run must not read, or leave behind, a real user's settings — and
// must be free to start while the app itself is open.
if (smokeDir !== undefined) app.setPath('userData', path.join(app.getPath('temp'), 'manul-studio-smoke-profile'));

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
