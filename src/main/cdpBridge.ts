// A DevTools endpoint for one page.
//
// The engine drives a browser it did not start by being given an address:
// `GET /json/list` there says which pages there are, and each page has a
// WebSocket that speaks the Chrome DevTools Protocol. This is such an address
// for the page that is built into the app — and for nothing else. Electron can
// open a debugging port of its own, but that port lists every page of the
// app, the window with the person's files in it included.
//
// Nothing here knows the protocol: a message that arrives is handed to the
// page, and what the page says is sent back. No Electron either, so that it
// can be tested without a window.

import * as crypto from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { Duplex } from 'stream';

/** The page behind the endpoint. */
export interface Debuggee {
  /** One command for the page; resolves to its result. */
  send(method: string, params: unknown, sessionId: string | undefined): Promise<unknown>;
  /** Subscribes to what the page reports; returns what ends the subscription. */
  onEvent(listener: (method: string, params: unknown, sessionId: string | undefined) => void): () => void;
  /** What `/json/list` says of the page. */
  describe(): { url: string; title: string };
}

const TARGET = 'manul-browser-studio-page';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** One WebSocket text frame, as a server sends it: unmasked. */
export function encodeFrame(text: string, opcode = 0x1): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let head: Buffer;
  if (length < 126) {
    head = Buffer.from([0x80 | opcode, length]);
  } else if (length < 0x10000) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * Takes a client's frames out of a stream of bytes: a frame may arrive in
 * pieces, several may arrive at once, and a message may be spread over more
 * than one.
 */
export class FrameReader {
  private pending: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];

  constructor(
    private readonly onText: (text: string) => void,
    private readonly onControl: (opcode: number, payload: Buffer) => void,
  ) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    for (;;) {
      if (this.pending.length < 2) return;
      const fin = (this.pending[0] & 0x80) !== 0;
      const opcode = this.pending[0] & 0x0f;
      const masked = (this.pending[1] & 0x80) !== 0;
      let length = this.pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.pending.length < 4) return;
        length = this.pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.pending.length < 10) return;
        length = Number(this.pending.readBigUInt64BE(2));
        offset = 10;
      }
      const maskAt = offset;
      if (masked) offset += 4;
      if (this.pending.length < offset + length) return;

      const payload = Buffer.from(this.pending.subarray(offset, offset + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= this.pending[maskAt + (i % 4)];
      this.pending = this.pending.subarray(offset + length);

      if (opcode >= 0x8) {
        this.onControl(opcode, payload);
      } else {
        this.parts.push(payload);
        if (fin) {
          const whole = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
          this.parts = [];
          this.onText(whole.toString('utf8'));
        }
      }
    }
  }
}

export class CdpBridge {
  private server?: http.Server;
  private port = 0;
  private readonly sockets = new Set<Duplex>();
  private unsubscribe?: () => void;

  constructor(private readonly page: Debuggee) {}

  /** Starts listening, on this machine only; resolves to the address to hand the engine. */
  async start(): Promise<string> {
    if (this.server) return this.endpoint;
    const server = http.createServer((req, res) => this.answer(req, res));
    server.on('upgrade', (req, socket) => this.upgrade(req, socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    this.unsubscribe = this.page.onEvent((method, params, sessionId) => {
      const frame = encodeFrame(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }));
      for (const socket of this.sockets) socket.write(frame);
    });
    return this.endpoint;
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  stop(): void {
    this.unsubscribe?.();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = undefined;
  }

  /**
   * A request is from this machine's own tools or it is refused: a web page,
   * which a browser lets ask anything of 127.0.0.1, says where it comes from
   * (Origin), and one that reached here by a name of its own does not know
   * the address it is at (Host).
   */
  private trusted(req: http.IncomingMessage): boolean {
    const host = req.headers.host ?? '';
    return !req.headers.origin && (host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`);
  }

  private answer(req: http.IncomingMessage, res: http.ServerResponse): void {
    const json = (body: unknown): void => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? '').split('?')[0].replace(/\/$/, '');
    if (!this.trusted(req)) {
      res.writeHead(403).end();
    } else if (path === '/json' || path === '/json/list') {
      json([
        {
          description: '',
          id: TARGET,
          type: 'page',
          ...this.page.describe(),
          webSocketDebuggerUrl: `ws://127.0.0.1:${this.port}/devtools/page/${TARGET}`,
        },
      ]);
    } else if (path === '/json/version') {
      // No webSocketDebuggerUrl: there is a page here and no browser to ask
      // for another.
      json({ Browser: 'Manul Browser Studio', 'Protocol-Version': '1.3' });
    } else {
      res.writeHead(404).end();
    }
  }

  private upgrade(req: http.IncomingMessage, socket: Duplex): void {
    const key = req.headers['sec-websocket-key'];
    if (!this.trusted(req) || !key || req.url !== `/devtools/page/${TARGET}`) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write(
      ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join(
        '\r\n',
      ),
    );
    this.sockets.add(socket);
    const send = (message: unknown): void => {
      if (this.sockets.has(socket)) socket.write(encodeFrame(JSON.stringify(message)));
    };
    const reader = new FrameReader(
      (text) => this.command(text, send),
      (opcode, payload) => {
        if (opcode === 0x9) socket.write(encodeFrame(payload.toString('utf8'), 0xa));
        if (opcode === 0x8) socket.end(encodeFrame('', 0x8));
      },
    );
    socket.on('data', (chunk: Buffer) => reader.push(chunk));
    const gone = (): void => void this.sockets.delete(socket);
    socket.on('close', gone);
    socket.on('error', gone);
  }

  private command(text: string, send: (message: unknown) => void): void {
    let message: { id?: number; method?: string; params?: unknown; sessionId?: string };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const { id, method, params, sessionId } = message;
    if (typeof id !== 'number' || typeof method !== 'string') return;
    const session = sessionId ? { sessionId } : {};
    this.page.send(method, params, sessionId).then(
      (result) => send({ id, result: result ?? {}, ...session }),
      (err: unknown) => send({ id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) }, ...session }),
    );
  }
}
