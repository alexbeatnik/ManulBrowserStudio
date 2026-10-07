// The one door between the window and the main process.
//
// The window is given `window.studio` and nothing else: no ipcRenderer, no
// Node. Each method is a named request the main process answers, so what the
// page can do is exactly the list in src/shared/api.ts.

import { contextBridge, ipcRenderer } from 'electron';
import type { MenuCommand, RunEvent, StudioApi } from '../shared/api';

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
  engine: call('engine'),
  catalogue: call('catalogue'),
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
  onMenu: (listener) => {
    ipcRenderer.on('studio:menu', (_e, command: MenuCommand) => listener(command));
  },
};

contextBridge.exposeInMainWorld('studio', api);
