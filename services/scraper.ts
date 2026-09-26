import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';

const MAX_CONTENT_LENGTH = 10 * 1024 * 1024;
const REQUEST_TIMEOUT = 10_000;
const MAX_REDIRECTS = 5;
const lookup = promisify(dns.lookup);

type Requester = typeof http.request;
type Dependencies = {
  lookup: typeof lookup;
  httpRequest: Requester;
  httpsRequest: Requester;
  now: () => number;
  scheduleTimeout: typeof setTimeout;
};

let dependencies: Dependencies = {
  lookup,
  httpRequest: http.request,
  httpsRequest: https.request,
  now: () => Date.now(),
  scheduleTimeout: setTimeout,
};

/** Test-only seam; production callers should not need this. */
export function __setScraperDependencies(overrides: Partial<Dependencies>): () => void {
  const previous = dependencies;
  dependencies = { ...dependencies, ...overrides };
  return () => { dependencies = previous; };
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function ipv6ToBigInt(address: string): bigint | undefined {
  const zone = address.indexOf('%');
  const withoutZone = zone === -1 ? address : address.slice(0, zone);
  const parts = withoutZone.split('::');
  if (parts.length > 2) return undefined;
  const left = parts[0] ? parts[0].split(':') : [];
  let right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const embedded = right.length && right[right.length - 1].includes('.') ? right.pop() : undefined;
  if (embedded) {
    if (!net.isIPv4(embedded)) return undefined;
    const n = ipv4ToNumber(embedded);
    right.push((n >>> 16).toString(16), (n & 0xffff).toString(16));
  }
  const missing = 8 - left.length - right.length;
  if (missing < (parts.length === 2 ? 1 : 0) || left.concat(right).some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return undefined;
  }
  const all = [...left, ...(parts.length === 2 ? Array(missing).fill('0') : []), ...right];
  if (all.length !== 8) return undefined;
  return all.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function inIpv6Range(value: bigint, base: bigint, prefix: number): boolean {
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return (value & mask) === (base & mask);
}

function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const n = ipv4ToNumber(address);
    const ranges: Array<[number, number]> = [
      [0x00000000, 0xff000000], // current network
      [0x0a000000, 0xff000000], [0x64400000, 0xffc00000], // private/shared
      [0x7f000000, 0xff000000], [0xa9fe0000, 0xffff0000], // loopback/link-local
      [0xac100000, 0xfff00000], [0xc0a80000, 0xffff0000], // private
      [0xc0000000, 0xffffff00], [0xc0000200, 0xffffff00], // this network/documentation
      [0xc6336400, 0xffffff00], // documentation
      [0xc6120000, 0xffff0000], // benchmarking
      [0xcb007100, 0xffffff00], [0xe0000000, 0xf0000000], // documentation/multicast
      [0xf0000000, 0xf0000000], [0xa8c0c800, 0xffffffff], // reserved/metadata
      [0x6464c800, 0xffffffff], // Cloud metadata (100.100.200.200)
    ];
    return !ranges.some(([base, mask]) => (n & mask) === (base & mask));
  }
  if (!net.isIPv6(address)) return false;
  const value = ipv6ToBigInt(address);
  if (value === undefined) return false;
  if (inIpv6Range(value, 0n, 96) || inIpv6Range(value, 0xffffn << 32n, 96)) {
    return isPublicAddress(`${Number((value >> 24n) & 255n)}.${Number((value >> 16n) & 255n)}.${Number((value >> 8n) & 255n)}.${Number(value & 255n)}`);
  }
  return ![
    [0n, 128], [1n, 128], [0x100n, 120], [0xfc000000000000000000000000000000n, 7],
    [0xfe800000000000000000000000000000n, 10], [0xff000000000000000000000000000000n, 8],
    [0xfd000000000000000000000000000000n, 8], [0x20010db80000000000000000000000000n, 32],
    [0x20010002000000000000000000000000n, 48], // benchmarking
    [0xfd7a115cA1EC000000000000000000000n, 48],
  ].some(([base, prefix]) => inIpv6Range(value, BigInt(base), Number(prefix)));
}

function sameAddress(left: string, right: string): boolean {
  if (net.isIPv4(left) && net.isIPv4(right)) return ipv4ToNumber(left) === ipv4ToNumber(right);
  if (net.isIPv6(left) && net.isIPv6(right)) {
    const a = ipv6ToBigInt(left);
    const b = ipv6ToBigInt(right);
    return a !== undefined && a === b;
  }
  return left === right;
}

async function resolvePublic(hostname: string, deadline: number): Promise<{ address: string; family: 4 | 6 }> {
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Blocked non-public address');
    return { address: hostname, family: net.isIPv4(hostname) ? 4 : 6 };
  }
  const remaining = deadline - dependencies.now();
  if (remaining <= 0) throw new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`);
  let timer: NodeJS.Timeout | undefined;
  try {
    const records = await Promise.race([
      dependencies.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`)), remaining);
      }),
    ]);
    const publicRecord = records.find((record) => isPublicAddress(record.address));
    if (!publicRecord || records.some((record) => !isPublicAddress(record.address))) {
      throw new Error('Host resolves to a non-public address');
    }
    return { address: publicRecord.address, family: publicRecord.family as 4 | 6 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeUrl(input: string): URL {
  let parsed: URL;
  try { parsed = new URL(input.trim()); } catch { throw new Error('Invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('URLs with credentials are not allowed');
  parsed.hash = '';
  return parsed;
}

function requestOnce(url: URL, address: { address: string; family: 4 | 6 }, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - dependencies.now();
    if (remaining <= 0) return reject(new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`));
    const controller = new AbortController();
    const timer = dependencies.scheduleTimeout(() => controller.abort(), remaining);
    let responseStream: http.IncomingMessage | undefined;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const transport = url.protocol === 'https:' ? dependencies.httpsRequest : dependencies.httpRequest;
    const requestHostname = url.hostname.replace(/^\[|\]$/g, '');
    const req = (transport as any)({
      protocol: url.protocol, hostname: requestHostname, port: url.port || undefined,
      path: `${url.pathname}${url.search}`, method: 'GET', timeout: remaining, signal: controller.signal,
      agent: false, lookup: ((_host: string, _opts: object, callback: (error: NodeJS.ErrnoException | null, address?: string, family?: number) => void) => callback(null, address.address, address.family)) as net.LookupFunction,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'gzip, deflate, br' },
    }, (response: http.IncomingMessage) => {
      responseStream = response;
      if (!response.socket?.remoteAddress || !sameAddress(response.socket.remoteAddress, address.address)) {
        fail(new Error('DNS rebinding detected'));
        req.destroy(new Error('DNS rebinding detected'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_CONTENT_LENGTH) {
          const error = new Error('Response exceeds raw size limit');
          fail(error);
          response.destroy(error);
          req.destroy(error);
        }
        else chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
      });
      response.on('error', fail);
    });
    controller.signal.addEventListener('abort', () => {
      const error = new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`);
      if (responseStream && !responseStream.destroyed) responseStream.destroy(error);
      req.destroy(error);
      fail(error);
    }, { once: true });
    req.on('timeout', () => req.destroy(new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`)));
    req.on('error', fail);
    req.end();
  });
}

function decodeBody(body: Buffer, encoding: string | string[] | undefined): Buffer {
  const value = Array.isArray(encoding) ? encoding.join(',') : (encoding ?? 'identity');
  const normalized = value.toLowerCase().split(',').map((item) => item.trim()).filter(Boolean);
  if (normalized.length !== 1) throw new Error('Multiple content encodings are not supported');
  const [singleEncoding] = normalized;
  if (singleEncoding === 'identity') return body;
  if (!['gzip', 'deflate', 'br'].includes(singleEncoding)) throw new Error(`Unsupported content encoding: ${singleEncoding}`);
  try {
    const decoded = singleEncoding === 'gzip'
      ? zlib.gunzipSync(body, { maxOutputLength: MAX_CONTENT_LENGTH })
      : singleEncoding === 'deflate'
        ? zlib.inflateSync(body, { maxOutputLength: MAX_CONTENT_LENGTH })
        : zlib.brotliDecompressSync(body, { maxOutputLength: MAX_CONTENT_LENGTH });
    if (decoded.length > MAX_CONTENT_LENGTH) throw new Error('Response exceeds decompressed size limit');
    return decoded;
  } catch (error) {
    if (error instanceof Error && error.message.includes('exceeds decompressed')) throw error;
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error('Response exceeds decompressed size limit');
    }
    throw new Error('Invalid compressed response');
  }
}

export const documentLoader = async (input: string): Promise<string> => {
  const deadline = dependencies.now() + REQUEST_TIMEOUT;
  let url = normalizeUrl(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const address = await resolvePublic(url.hostname, deadline);
    const result = await requestOnce(url, address, deadline);
    if (result.status >= 300 && result.status < 400 && result.headers.location) {
      if (redirects === MAX_REDIRECTS) throw new Error('Too many redirects');
      url = normalizeUrl(new URL(result.headers.location, url).toString());
      continue;
    }
    if (result.status === 404) throw new Error(`URL not found (404): ${url.href}`);
    if (result.status >= 400) throw new Error(`HTTP ${result.status}: ${url.href}`);
    if (dependencies.now() >= deadline) throw new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`);
    const text = decodeBody(result.body, result.headers['content-encoding'] as string | undefined).toString('utf8');
    const $ = cheerio.load(text);
    $('script, style, nav, footer, header').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  }
  throw new Error('Too many redirects');
};
