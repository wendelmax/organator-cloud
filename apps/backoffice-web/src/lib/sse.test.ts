import test, { describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseData, streamSse } from './sse';

afterEach(() => mock.restoreAll());

describe('parseSseData', () => {
  test('joins the data lines of an event and ignores other fields', () => {
    assert.equal(parseSseData('id: 1\ndata: {"a":1}'), '{"a":1}');
    assert.equal(parseSseData('data: one\ndata: two'), 'one\ntwo');
    assert.equal(parseSseData(': keep-alive'), null);
  });
});

describe('streamSse', () => {
  test('sends the bearer token and delivers events split across chunks', async () => {
    const chunks = ['data: {"logLine":"a"}\n\ndata: {"lo', 'gLine":"b"}\n\n'];
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    const received: string[] = [];
    await new Promise<void>((resolve) => {
      streamSse('http://api/stream', 'jwt-1', (data) => {
        received.push(data);
        if (received.length === 2) resolve();
      });
    });

    assert.deepEqual(received, ['{"logLine":"a"}', '{"logLine":"b"}']);
    const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, 'http://api/stream');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer jwt-1');
  });

  test('stops quietly when the API refuses the stream', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
    const received: string[] = [];
    streamSse('http://api/stream', 'jwt-1', (d) => received.push(d));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(received, []);
  });
});
