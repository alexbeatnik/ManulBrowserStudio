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

import { BrowserWindow, Session, session, WebContentsView } from 'electron';
import type { PageRect, PageState } from '../shared/api';
import { CdpBridge } from './cdpBridge';

/** The width a page is laid out at, however narrow the panel. */
const LAYOUT_WIDTH = 1280;

/** The name of the browser's own cookies, storage and cache, apart from the app's. */
const PARTITION = 'built-in-browser';

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
  /** The page's first load: its blank start page. */
  private ready: Promise<void> = Promise.resolve();
  private bridge?: CdpBridge;
  private rect?: PageRect;
  /** Whether the window has asked for the page to be in sight. */
  private shown = false;
  private scale = 1;
  private store?: Session;
  private readonly listeners = new Set<(method: string, params: unknown, sessionId: string | undefined) => void>();

  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly onState: (state: PageState) => void,
  ) {}

  /**
   * Where the browser keeps what sites give it. In memory: nothing a site
   * under test stores outlives the app, or is seen by the app's own window.
   */
  private storage(): Session {
    if (this.store) return this.store;
    const store = session.fromPartition(PARTITION);
    // A site under test is not the person: it is not given the camera, the
    // microphone or where the machine is because it asked, which is what
    // Electron does with nobody to ask. What a page needs to be a page stays.
    const harmless = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
    store.setPermissionRequestHandler((_contents, permission, grant) => grant(harmless.has(permission)));
    // And nothing it offers is saved: there is nowhere here to say where to.
    store.on('will-download', (event) => event.preventDefault());
    this.store = store;
    return store;
  }

  /** The page, made the first time it is asked for, and again after each reset. */
  private page(): WebContentsView {
    if (this.view) return this.view;
    const win = this.window();
    if (!win) throw new Error('There is no window for the built-in browser.');
    this.storage();
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    view.setVisible(false);
    win.contentView.addChildView(view);
    const wc = view.webContents;
    // One page: a link that asks for a new window is followed in this one.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^(https?|file):/i.test(url)) void this.load(url).catch(() => undefined);
      return { action: 'deny' };
    });
    // A page that has been replaced has nothing more to say.
    const report = (): void => {
      if (this.view === view) this.onState(this.state());
    };
    wc.on('did-navigate', report);
    wc.on('did-navigate-in-page', report);
    wc.on('page-title-updated', report);
    wc.debugger.on('message', (_event, method, params, sessionId) => {
      if (this.view !== view) return;
      for (const listener of this.listeners) listener(method, params, sessionId || undefined);
    });
    this.view = view;
    this.ready = this.load(START_PAGE).catch(() => undefined);
    return view;
  }

  /**
   * Sends the page to an address. A load that was overtaken — by a redirect,
   * or by the next address before this one had arrived — is not a failure,
   * though Electron reports it as one.
   */
  private async load(url: string): Promise<void> {
    try {
      await this.page().webContents.loadURL(url);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ERR_ABORTED') throw err;
    }
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
    await this.ready;
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
      this.shown = false;
      this.view?.setVisible(false);
      return;
    }
    this.rect = rect;
    this.shown = true;
    await this.arrange();
  }

  /** Puts the page where the window last said, as large as it said. */
  private async arrange(): Promise<void> {
    if (!this.rect || !this.shown) return;
    const view = this.page();
    view.setBounds({
      x: Math.round(this.rect.x),
      y: Math.round(this.rect.y),
      width: Math.round(this.rect.width),
      height: Math.round(this.rect.height),
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

  navigate(url: string): Promise<void> {
    return this.load(url);
  }

  /**
   * A picture of the page as it is, as a data: URL — for when the page
   * itself is about to go. '' when it has been nowhere, or cannot be drawn.
   */
  async picture(): Promise<string> {
    if (!this.view || !this.state().url) return '';
    try {
      const shot = (await this.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      return shot.data ? `data:image/png;base64,${shot.data}` : '';
    } catch {
      return '';
    }
  }

  /**
   * Makes the browser what one started this moment is: no cookies, nothing
   * stored, nothing cached, nobody signed in, and a page that has been
   * nowhere. A run of a file begins from this and ends in it.
   *
   * The page is not emptied but replaced. What a tab holds of its own — its
   * history, its sessionStorage, the scripts still running in it — is not in
   * the store that can be cleared, and goes only with the tab.
   */
  async reset(): Promise<void> {
    const old = this.view;
    this.view = undefined;
    if (old) {
      // Whoever was driving the old page is told it is gone, not handed
      // another in the middle of what they were doing.
      this.bridge?.disconnect();
      this.window()?.contentView.removeChildView(old);
      old.webContents.close({ waitForBeforeUnload: false });
    }
    const store = this.storage();
    await Promise.all([
      store.clearStorageData(),
      store.clearCache(),
      store.clearAuthCache(),
      store.clearHostResolverCache(),
      store.clearCodeCaches({}),
    ]);
    this.page();
    await this.ready;
    await this.arrange();
    this.onState(this.state());
  }

  /** Which page this is: another after every reset. For scripted checks. */
  get pageId(): number {
    return this.view?.webContents.id ?? 0;
  }

  /** Runs a line of script in the page and resolves to what it comes to; for scripted checks. */
  probe<T>(script: string): Promise<T> {
    return this.page().webContents.executeJavaScript(script, true) as Promise<T>;
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
