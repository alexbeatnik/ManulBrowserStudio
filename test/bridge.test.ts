// The DevTools endpoint the built-in page is reached through, as far as it
// can be tested without a page: a client that speaks WebSocket by hand.

import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as net from 'node:net';
import { test } from 'node:test';

import { toViewCoordinates } from '../src/main/builtInBrowser';
import { CdpBridge, Debuggee, encodeFrame, FrameReader } from '../src/main/cdpBridge';

/** A client's frame: masked, as a server requires. */
function clientFrame(text: string, fin = true, opcode = 0x1): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  const head =
    payload.length < 126
      ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length])
      : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

function fakePage(): Debuggee & { emit(method: string, params: unknown): void; asked: string[] } {
  const listeners = new Set<(method: string, params: unknown, sessionId: string | undefined) => void>();
  const asked: string[] = [];
  return {
    asked,
    send: async (method, params) => {
      asked.push(method);
      if (method === 'Page.navigate') return { frameId: 'F', url: (params as { url: string }).url };
      if (method === 'Nope.nothing') throw new Error("'Nope.nothing' wasn't found");
      return undefined;
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    describe: () => ({ url: 'https://example.com/', title: 'Example' }),
    emit: (method, params) => listeners.forEach((l) => l(method, params, undefined)),
  };
}

const get = (url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });

test('a point of the page is moved to where the page is drawn, and nothing else is touched', () => {
  // A page laid out 1280 wide in a panel 320 wide is drawn at a quarter.
  const press = { type: 'mousePressed', button: 'left', x: 640, y: 200, clickCount: 1 };
  assert.deepEqual(toViewCoordinates('Input.dispatchMouseEvent', press, 0.25), { ...press, x: 160, y: 50 });
  assert.deepEqual(
    toViewCoordinates('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 40 }] }, 0.5),
    { type: 'touchStart', touchPoints: [{ x: 50, y: 20 }] },
  );
  // A clip of a screenshot is in the page's own pixels, and stays there.
  const shot = { clip: { x: 640, y: 200, width: 10, height: 10, scale: 1 } };
  assert.equal(toViewCoordinates('Page.captureScreenshot', shot, 0.25), shot);
  // A page drawn at its own size has nothing to move.
  assert.equal(toViewCoordinates('Input.dispatchMouseEvent', press, 1), press);
  assert.equal(toViewCoordinates('Input.dispatchMouseEvent', undefined, 0.25), undefined);
});

test('frames are read however the bytes arrive', () => {
  const texts: string[] = [];
  const reader = new FrameReader((t) => texts.push(t), () => undefined);
  const long = 'x'.repeat(300);
  // Two frames at once, then one a byte at a time, then a message in two parts.
  reader.push(Buffer.concat([clientFrame('one'), clientFrame(long)]));
  for (const byte of clientFrame('drip')) reader.push(Buffer.from([byte]));
  reader.push(clientFrame('half ', false));
  reader.push(clientFrame('and half', true, 0x0));
  assert.deepEqual(texts, ['one', long, 'drip', 'half and half']);

  // What the server sends is what a reader takes back, at every size.
  for (const size of [0, 125, 126, 70_000]) {
    const back: string[] = [];
    new FrameReader((t) => back.push(t), () => undefined).push(encodeFrame('y'.repeat(size)));
    assert.equal(back[0].length, size);
  }
});

test('the endpoint lists one page, and a web page may not ask', async () => {
  const bridge = new CdpBridge(fakePage());
  const endpoint = await bridge.start();
  try {
    const list = JSON.parse((await get(`${endpoint}/json/list`)).body) as Array<Record<string, string>>;
    assert.equal(list.length, 1);
    assert.equal(list[0].type, 'page');
    assert.equal(list[0].url, 'https://example.com/');
    assert.match(list[0].webSocketDebuggerUrl, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/page\//);

    assert.equal((await get(`${endpoint}/json/list`, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await get(`${endpoint}/json/list`, { Host: 'evil.example' })).status, 403);
  } finally {
    bridge.stop();
  }
});

test('a command goes to the page and its answer comes back; what the page reports is passed on', async () => {
  const page = fakePage();
  const bridge = new CdpBridge(page);
  const endpoint = await bridge.start();
  const port = Number(new URL(endpoint).port);
  const socket = net.connect(port, '127.0.0.1');
  try {
    const messages: Array<Record<string, unknown>> = [];
    let waiting: (() => void) | undefined;
    const next = async (): Promise<Record<string, unknown>> => {
      while (!messages.length) await new Promise<void>((r) => (waiting = r));
      return messages.shift()!;
    };

    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(
      [
        'GET /devtools/page/manul-browser-studio-page HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'),
    );
    let shaken = false;
    let head = Buffer.alloc(0);
    const reader = new FrameReader((text) => {
      messages.push(JSON.parse(text));
      waiting?.();
    }, () => undefined);
    socket.on('data', (chunk: Buffer) => {
      if (shaken) return reader.push(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      shaken = true;
      assert.match(head.subarray(0, end).toString(), /^HTTP\/1\.1 101 /);
      // The key from the RFC, and the answer the RFC gives for it.
      assert.ok(head.toString().includes('s3pPLMBiTxaQ9kYGzzhZRbK+xOo='));
      waiting?.();
      if (head.length > end + 4) reader.push(head.subarray(end + 4));
    });
    while (!shaken) await new Promise<void>((r) => (waiting = r));

    socket.write(clientFrame(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'https://a.test/' } })));
    assert.deepEqual(await next(), { id: 1, result: { frameId: 'F', url: 'https://a.test/' } });

    // A command with nothing to say still gets an answer, and a refusal is one.
    socket.write(clientFrame(JSON.stringify({ id: 2, method: 'Page.enable' })));
    assert.deepEqual(await next(), { id: 2, result: {} });
    socket.write(clientFrame(JSON.stringify({ id: 3, method: 'Nope.nothing' })));
    assert.deepEqual(await next(), { id: 3, error: { code: -32000, message: "'Nope.nothing' wasn't found" } });

    page.emit('Page.loadEventFired', { timestamp: 1 });
    assert.deepEqual(await next(), { method: 'Page.loadEventFired', params: { timestamp: 1 } });
    assert.deepEqual(page.asked, ['Page.navigate', 'Page.enable', 'Nope.nothing']);
  } finally {
    socket.destroy();
    bridge.stop();
  }
});
