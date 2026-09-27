// HTTP helpers for tests that talk to real listening servers.
import * as net from 'node:net';

/** A fetch with a one-cookie jar (Node's fetch has none; browsers use credentials: 'same-origin'). */
export function cookieFetch(): typeof fetch {
  let cookie = '';
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) { headers.set('cookie', cookie); }
    const res = await fetch(input, { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set) { cookie = set.split(';')[0]!; }
    return res;
  };
}

/** A fetch that sends an Origin header, as a browser page on `origin` would. */
export function withOrigin(origin: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('origin', origin);
    return fetch(input, { ...init, headers });
  };
}

/** A local port with nothing listening on it. */
export async function closedPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}
