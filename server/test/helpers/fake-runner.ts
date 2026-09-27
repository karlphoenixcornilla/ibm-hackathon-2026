// A minimal stand-in for the Reprise Runner's HTTP API, for bridge tests.
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_CODE = '123456';
export const FAKE_SESSION = 'fake-session';
export const FAKE_STATUS = {
  runner_version: 'fake', root_name: 'calc', remote: 'https://github.com/acme/calc.git',
  head: '1'.repeat(40), host_os: 'linux', platforms: [], busy: false,
};

export interface FakeRunner {
  port: number;
  /** Every request: method, url, authorization header, start/end times. */
  log: Array<{ method: string; url: string; auth: string | undefined; start: number; end: number }>;
  close(): Promise<void>;
}

export async function startFakeRunner(opts: { statusDelayMs?: number } = {}): Promise<FakeRunner> {
  const log: FakeRunner['log'] = [];
  const server = http.createServer((req, res) => {
    const entry = { method: req.method ?? '', url: req.url ?? '', auth: req.headers['authorization'], start: Date.now(), end: 0 };
    log.push(entry);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (code: number, body: unknown) => {
        entry.end = Date.now();
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      if (req.method === 'POST' && req.url === '/pair') {
        if (body['code'] === 'locked') { return send(403, { error: 'Pairing locked after too many wrong codes. Restart the runner to reset.' }); }
        if (body['code'] !== FAKE_CODE) { return send(403, { error: 'Wrong pairing code' }); }
        return send(200, { session: FAKE_SESSION, ...FAKE_STATUS });
      }
      if (req.headers['authorization'] !== `Bearer ${FAKE_SESSION}`) { return send(401, { error: 'Unauthorized' }); }
      if (req.method === 'GET' && req.url === '/status') {
        setTimeout(() => send(200, FAKE_STATUS), opts.statusDelayMs ?? 0);
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/file?')) {
        const path = new URL(req.url, 'http://x').searchParams.get('path');
        return send(200, { path, ref: FAKE_STATUS.head, sha256: 'x', content: `content of ${path}` });
      }
      if (req.method === 'POST' && req.url === '/runs') { return send(200, { run_id: 'abc123' }); }
      if (req.method === 'GET' && req.url === '/runs/abc123/events') {
        entry.end = Date.now();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ type: 'output', line: 'running…' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'result', result: { exit_code: 0, tests: [] } })}\n\n`);
        res.end(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        return;
      }
      return send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    log,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
