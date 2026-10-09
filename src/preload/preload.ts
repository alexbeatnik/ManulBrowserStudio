// The one door between the window and the main process.
//
// The window is given `window.studio` and nothing else: no ipcRenderer, no
// Node. Each method is a named request the main process answers, so what the
// page can do is exactly the list in src/shared/api.ts.

import { contextBridge, ipcRenderer } from 'electron';
import type { MenuCommand, PageState, RunEvent, StudioApi } from '../shared/api';

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(`studio:${channel}`, ...args) as Promise<T>;

const api: StudioApi = {
  getSettings: call('getSettings'),
  setSettings: call('setSettings'),
  chooseFolder: call('chooseFolder'),
  chooseEngine: call('chooseEngine'),
  listDir: call('listDir'),
  readFile: call('readFile'),
  writeFile: call('writeFile'),
  createFile: call('createFile'),
  createFolder: call('createFolder'),
  createHookScript: call('createHookScript'),
  openDemo: call('openDemo'),
  demoOffer: call('demoOffer'),
  engine: call('engine'),
  catalogue: call('catalogue'),
  typeLibraries: call('typeLibraries'),
  runtime: call('runtime'),
  packages: call('packages'),
  installPackages: call('installPackages'),
  removePackage: call('removePackage'),
  onPackageLog: (listener) => {
    ipcRenderer.on('studio:packageLog', (_e, line: string) => listener(line));
  },
  startRun: call('startRun'),
  stopRun: call('stopRun'),
  debug: call('debug'),
  onRunEvent: (listener) => {
    ipcRenderer.on('studio:runEvent', (_e, event: RunEvent) => listener(event));
  },
  liveOpen: call('liveOpen'),
  liveClose: call('liveClose'),
  liveRefresh: call('liveRefresh'),
  liveStep: call('liveStep'),
  pagePlace: call('pagePlace'),
  pageNavigate: call('pageNavigate'),
  onPageState: (listener) => {
    ipcRenderer.on('studio:pageState', (_e, state: PageState) => listener(state));
  },
  onMenu: (listener) => {
    ipcRenderer.on('studio:menu', (_e, command: MenuCommand) => listener(command));
  },
};

contextBridge.exposeInMainWorld('studio', api);
