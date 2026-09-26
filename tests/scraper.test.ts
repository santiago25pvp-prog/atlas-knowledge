import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import zlib from 'node:zlib';
import { __setScraperDependencies, documentLoader } from '../services/scraper';

type Reply = { body: string | Buffer | Buffer[]; statusCode?: number; headers?: Record<string, string | string[]>; delay?: number };

function fakeRequest(reply: Reply | ((options: any) => Reply), remoteAddress = '93.184.216.34') {
  return (options: any, callback: (response: any) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
    request.end = () => {
      const value = typeof reply === 'function' ? reply(options) : reply;
      const response = Readable.from(Array.isArray(value.body) ? value.body : [Buffer.isBuffer(value.body) ? value.body : Buffer.from(value.body)]);
      Object.assign(response, { statusCode: value.statusCode ?? 200, headers: value.headers ?? {}, socket: { remoteAddress } });
      setTimeout(() => callback(response), value.delay ?? 0);
    };
    request.destroy = (error: Error) => process.nextTick(() => request.emit('error', error));
    return request;
  };
}

function publicLookup(address = '93.184.216.34') {
  return (async () => [{ address, family: address.includes(':') ? 6 : 4 }]) as any;
}

test('rejects each IPv4 private, local, link-local, reserved and metadata range', async () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '192.0.0.1', '100.64.0.1', '169.254.169.254']) {
    await assert.rejects(documentLoader(`http://${address}/`), /non-public/);
  }
});

test('rejects IPv6 loopback, unspecified, private, link-local, multicast and mapped private addresses', async () => {
  for (const address of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1']) {
    await assert.rejects(documentLoader(`http://[${address}]/`), /non-public/);
  }
});

test('rejects credentials and every non-http protocol', async () => {
  await assert.rejects(documentLoader('http://user:pass@example.com/'), /credentials/);
  await assert.rejects(documentLoader('https://user@example.com/'), /credentials/);
  await assert.rejects(documentLoader('ftp://example.com/'), /Only HTTP/);
});

test('rejects hostnames with any private address in a multi-IP DNS answer', async () => {
  const restore = __setScraperDependencies({
    lookup: (async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]) as any,
  });
  try {
    await assert.rejects(documentLoader('http://multi.example/'), /non-public/);
  } finally {
    restore();
  }
});

test('pins lookup, disables transport redirects and extracts HTML', async () => {
  let options: any;
  const restore = __setScraperDependencies({
    lookup: publicLookup(),
    httpRequest: ((requestOptions: any, callback: any) => {
      options = requestOptions;
      return fakeRequest({ body: '<html><body>Hello <script>bad</script> world</body></html>' })(requestOptions, callback);
    }) as any,
  });
  try {
    assert.equal(await documentLoader('http://example.com/page#fragment'), 'Hello world');
    assert.equal(options.maxRedirects, undefined);
    assert.equal(options.agent, false);
    assert.equal(options.hostname, 'example.com');
    assert.equal(options.headers['Accept-Encoding'], 'gzip, deflate, br');
    await new Promise<void>((resolve, reject) => options.lookup('', {}, (error: Error | null, address: string) => error ? reject(error) : (assert.equal(address, '93.184.216.34'), resolve())));
  } finally {
    restore();
  }
});

test('follows redirects manually and rejects more than five', async () => {
  let calls = 0;
  const restore = __setScraperDependencies({
    lookup: publicLookup(),
    httpRequest: fakeRequest(() => {
      calls += 1;
      return calls === 2
        ? { body: '<body>done</body>' }
        : { body: '', statusCode: 302, headers: { location: `/next-${calls}` } };
    }) as any,
  });
  try {
    assert.equal(await documentLoader('http://example.com/start'), 'done');
  } finally {
    restore();
  }

  calls = 0;
  const tooMany = __setScraperDependencies({
    lookup: publicLookup(),
    httpRequest: fakeRequest(() => {
      calls += 1;
      return { body: '', statusCode: 302, headers: { location: `/loop-${calls}` } };
    }) as any,
  });
  try {
    await assert.rejects(documentLoader('http://example.com/loop'), /Too many redirects/);
    assert.equal(calls, 6);
  } finally {
    tooMany();
  }
});

test('enforces a global timeout while DNS or response is stalled', async () => {
  let clockReads = 0;
  const restore = __setScraperDependencies({
    now: () => (clockReads++ === 0 ? 0 : 10_001),
    lookup: (async () => new Promise<any>(() => undefined)) as any,
  });
  try {
    await assert.rejects(documentLoader('http://slow.example/'), /Request timeout/);
  } finally {
    restore();
  }
});

test('enforces the deadline while a response keeps the connection active', async () => {
  const restore = __setScraperDependencies({
    lookup: publicLookup(),
    scheduleTimeout: ((callback: () => void) => {
      process.nextTick(callback);
      return {} as NodeJS.Timeout;
    }) as any,
    httpRequest: ((_: any, callback: (response: any) => void) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      request.end = () => {
        const response = new Readable({ read() { /* intentionally never produces an end */ } });
        Object.assign(response, { statusCode: 200, headers: {}, socket: { remoteAddress: '93.184.216.34' } });
        callback(response);
      };
      request.destroy = (error: Error) => process.nextTick(() => request.emit('error', error));
      return request;
    }) as any,
  });
  try {
    await assert.rejects(documentLoader('http://example.com/'), /Request timeout/);
  } finally {
    restore();
  }
});

test('supports gzip, deflate and brotli, rejects unknown and multiple encodings', async () => {
  for (const [encoding, body] of [
    ['gzip', zlib.gzipSync('<body>compressed</body>')],
    ['deflate', zlib.deflateSync('<body>compressed</body>')],
    ['br', zlib.brotliCompressSync('<body>compressed</body>')],
  ] as const) {
    const restore = __setScraperDependencies({ lookup: publicLookup(), httpRequest: fakeRequest({ body, headers: { 'content-encoding': encoding } }) as any });
    try {
      assert.equal(await documentLoader('http://example.com/'), 'compressed');
    } finally {
      restore();
    }
  }

  for (const headers of [{ 'content-encoding': 'compress' }, { 'content-encoding': 'gzip, br' }, { 'content-encoding': ['gzip', 'br'] }]) {
    const restore = __setScraperDependencies({ lookup: publicLookup(), httpRequest: fakeRequest({ body: 'data', headers }) as any });
    try {
      await assert.rejects(documentLoader('http://example.com/'), /Unsupported content encoding|Multiple content encodings/);
    } finally {
      restore();
    }
  }
});

test('rejects responses over the raw byte limit', async () => {
  const restore = __setScraperDependencies({
    lookup: publicLookup(),
    httpRequest: fakeRequest({ body: Buffer.alloc(10 * 1024 * 1024 + 1) }) as any,
  });
  try {
    await assert.rejects(documentLoader('http://example.com/'), /raw size limit/);
  } finally {
    restore();
  }
});

test('rejects redirects to private IPv4 and metadata addresses before requesting them', async () => {
  for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/']) {
    const restore = __setScraperDependencies({ lookup: publicLookup(), httpRequest: fakeRequest({ statusCode: 302, body: '', headers: { location: target } }) as any });
    try { await assert.rejects(documentLoader('http://example.com/'), /non-public/); } finally { restore(); }
  }
});

test('rejects redirects to a hostname resolving to a private address', async () => {
  const restore = __setScraperDependencies({
    lookup: (async (hostname: string) => hostname === 'private.example' ? [{ address: '10.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]) as any,
    httpRequest: fakeRequest({ statusCode: 302, body: '', headers: { location: 'http://private.example/' } }) as any,
  });
  try { await assert.rejects(documentLoader('http://example.com/'), /non-public/); } finally { restore(); }
});

test('fails closed when the connected remote address is absent or divergent', async () => {
  for (const remoteAddress of [null, '93.184.216.35']) {
    const restore = __setScraperDependencies({ lookup: publicLookup(), httpRequest: fakeRequest({ body: 'data' }, remoteAddress as any) as any });
    try { await assert.rejects(documentLoader('http://example.com/'), /DNS rebinding detected/); } finally { restore(); }
  }
});

test('rejects an effective DNS rebinding between requests', async () => {
  let lookups = 0;
  const restore = __setScraperDependencies({
    lookup: (async () => [{ address: ++lookups === 1 ? '93.184.216.34' : '93.184.216.35', family: 4 }]) as any,
    httpRequest: fakeRequest({ statusCode: 302, body: '', headers: { location: '/again' } }) as any,
  });
  try { await assert.rejects(documentLoader('http://example.com/'), /DNS rebinding|non-public/); } finally { restore(); }
});

test('rejects missing special IPv4 and IPv6 ranges', async () => {
  await assert.rejects(documentLoader('http://198.18.0.1/'), /non-public/);
  await assert.rejects(documentLoader('http://[2001:2::1]/'), /non-public/);
});

test('rejects compressed output over the decoded limit and truncated compressed payloads', async () => {
  const bodies = [zlib.gzipSync(Buffer.alloc(10 * 1024 * 1024 + 1, 65)), zlib.gzipSync('complete').subarray(0, 5)];
  for (const body of bodies) {
    const restore = __setScraperDependencies({ lookup: publicLookup(), httpRequest: fakeRequest({ body, headers: { 'content-encoding': 'gzip' } }) as any });
    try { await assert.rejects(documentLoader('http://example.com/'), /decompressed size limit|Invalid compressed response/); } finally { restore(); }
  }
});

test('counts multiple response chunks toward the raw limit', async () => {
  const restore = __setScraperDependencies({ lookup: publicLookup(), httpRequest: fakeRequest({ body: [Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(4 * 1024 * 1024 + 1)] }) as any });
  try { await assert.rejects(documentLoader('http://example.com/'), /raw size limit/); } finally { restore(); }
});

test('enforces the deadline while continuous response chunks keep arriving', async () => {
  let timeoutCallback: (() => void) | undefined;
  let chunksEmitted = 0;
  const restore = __setScraperDependencies({
    lookup: publicLookup(),
    scheduleTimeout: ((callback: () => void) => {
      timeoutCallback = callback;
      return {} as NodeJS.Timeout;
    }) as any,
    httpRequest: ((_: any, callback: (response: any) => void) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      request.end = () => {
        const response = new Readable({
          read() {
            if (chunksEmitted < 3) {
              chunksEmitted += 1;
              this.push(Buffer.from(`chunk-${chunksEmitted}`));
              if (chunksEmitted === 3) timeoutCallback?.();
            }
          },
        });
        Object.assign(response, { statusCode: 200, headers: {}, socket: { remoteAddress: '93.184.216.34' } });
        callback(response);
      };
      request.destroy = (error: Error) => process.nextTick(() => request.emit('error', error));
      return request;
    }) as any,
  });
  try {
    await assert.rejects(documentLoader('http://example.com/'), /Request timeout/);
    assert.equal(chunksEmitted, 3);
  } finally {
    restore();
  }
});
