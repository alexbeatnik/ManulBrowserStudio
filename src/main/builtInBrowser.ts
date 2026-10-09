// The built-in browser: a page of the app's own Chromium, shown in the page
// panel, that the engine drives like any other browser.
//
// The engine can attach to a browser it did not start, given a DevTools
// address. The page here is given one of its own (cdpBridge.ts), so a run of a
// file, or the live session, happens where the person is looking instead of
// in a window beside the app.
//
// The panel is narrow and a site under test was made for a desktop. So the
// page is laid out 1280 pixels wide and drawn smaller, which is what a
// browser's own device toolbar does.

import { BrowserWindow, WebContentsView } from 'electron';
import type { PageRect, PageState } from '../shared/api';
import { CdpBridge } from './cdpBridge';

/** The width a page is laid out at, however narrow the panel. */
const LAYOUT_WIDTH = 1280;

const START_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><title>Built-in browser</title>' +
    '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#15171c;color:#8b93a1;font:28px system-ui">' +
    '<p>Run a hunt, or type an address above.</p>',
)}`;

/**
 * A point of the page, as the page counts, is somewhere else in the view
 * once the page is drawn smaller — and a mouse event sent over DevTools is
 * taken to be in the view, like a real one. Moves the points of such a
 * command; every other command is passed as it is.
 */
export function toViewCoordinates(method: string, params: unknown, scale: number): unknown {
  if (scale === 1 || !params || typeof params !== 'object') return params;
  const point = <T extends { x?: number; y?: number }>(p: T): T => ({
    ...p,
    ...(typeof p.x === 'number' ? { x: p.x * scale } : {}),
    ...(typeof p.y === 'number' ? { y: p.y * scale } : {}),
  });
  if (method === 'Input.dispatchMouseEvent' || method === 'Input.dispatchDragEvent') return point(params);
  if (method === 'Input.dispatchTouchEvent') {
    const touch = params as { touchPoints?: Array<{ x?: number; y?: number }> };
    return { ...touch, touchPoints: touch.touchPoints?.map(point) };
  }
  return params;
}

export class BuiltInBrowser {
  private view?: WebContentsView;
  private bridge?: CdpBridge;
  private rect?: PageRect;
  private scale = 1;
  private readonly listeners = new Set<(method: string, params: unknown, sessionId: string | undefined) => void>();

  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly onState: (state: PageState) => void,
  ) {}

  /** The page, made the first time it is asked for. */
  private page(): WebContentsView {
    if (this.view) return this.view;
    const win = this.window();
    if (!win) throw new Error('There is no window for the built-in browser.');
    const view = new WebContentsView({
      webPreferences: {
        // Its own cookies and storage, kept in memory: nothing a site under
        // test stores outlives the app, or is seen by the app's own window.
        partition: 'built-in-browser',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setVisible(false);
    win.contentView.addChildView(view);
    const wc = view.webContents;
    // One page: a link that asks for a new window is followed in this one.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^(https?|file):/i.test(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    const report = (): void => this.onState(this.state());
    wc.on('did-navigate', report);
    wc.on('did-navigate-in-page', report);
    wc.on('page-title-updated', report);
    wc.debugger.on('message', (_event, method, params, sessionId) => {
      for (const listener of this.listeners) listener(method, params, sessionId || undefined);
    });
    void wc.loadURL(START_PAGE);
    this.view = view;
    return view;
  }

  /** One DevTools command for the page. */
  private async send(method: string, params: unknown, sessionId?: string): Promise<unknown> {
    const wc = this.page().webContents;
    // Opening DevTools on the page, or a crash of it, lets go of the page.
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      await this.fit();
    }
    return wc.debugger.sendCommand(method, toViewCoordinates(method, params, this.scale) ?? {}, sessionId);
  }

  /** The address to give the engine. */
  async endpoint(): Promise<string> {
    this.page();
    this.bridge ??= new CdpBridge({
      send: (method, params, sessionId) => this.send(method, params, sessionId),
      onEvent: (listener) => {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
      },
      describe: () => this.state(),
    });
    return this.bridge.start();
  }

  state(): PageState {
    const wc = this.view?.webContents;
    const url = wc?.getURL() ?? '';
    return { url: url === START_PAGE ? '' : url, title: wc?.getTitle() ?? '' };
  }

  /** Puts the page over a rectangle of the window, or out of sight. */
  async place(rect: PageRect | null): Promise<void> {
    if (!rect || rect.width < 1 || rect.height < 1) {
      this.view?.setVisible(false);
      return;
    }
    const view = this.page();
    this.rect = rect;
    view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    view.setVisible(true);
    await this.fit().catch(() => undefined);
  }

  /** Lays the page out at desktop width and draws it to fit the rectangle. */
  private async fit(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || !this.rect) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    this.scale = Math.min(1, this.rect.width / LAYOUT_WIDTH);
    if (this.scale === 1) {
      await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    } else {
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: LAYOUT_WIDTH,
        height: Math.round(this.rect.height / this.scale),
        deviceScaleFactor: 0,
        mobile: false,
        scale: this.scale,
      });
    }
  }

  async navigate(url: string): Promise<void> {
    await this.page().webContents.loadURL(url);
  }

  /**
   * What a browser started for a run has: no cookies, nothing stored, no
   * page. A run of a file begins from this.
   */
  async reset(): Promise<void> {
    const wc = this.page().webContents;
    await wc.session.clearStorageData();
    await wc.loadURL(START_PAGE);
  }

  /** Where the page is in the window and what it is showing; for scripted checks. */
  async look(): Promise<{ visible: boolean; bounds: PageRect; png: Buffer }> {
    const view = this.page();
    return {
      visible: view.getVisible(),
      bounds: view.getBounds(),
      png: (await view.webContents.capturePage()).toPNG(),
    };
  }

  dispose(): void {
    this.bridge?.stop();
    this.bridge = undefined;
  }
}
