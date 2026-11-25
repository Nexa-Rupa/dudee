import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

/**
 * Fetching pages an employee chose. A page or email can talk a model into fetching an address, so requests
 * only go to public internet addresses: never this computer, the local network or a cloud metadata service.
 * The address is checked when the connection is made (not before), so a name that changes its answer can't slip by,
 * and again on every redirect. Set DUDE_ALLOW_PRIVATE_FETCH=1 to let employees read local or intranet pages.
 */
const blockedV4 = new net.BlockList();
for (const [addr, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(addr, bits, "ipv4");
}

const publicV6 = new net.BlockList();
publicV6.addSubnet("2000::", 3, "ipv6");
// inside 2000::/3 but able to carry a private IPv4 address, or not for public use
const blockedV6 = new net.BlockList();
for (const [addr, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  blockedV6.addSubnet(addr, bits, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const kind = net.isIP(ip);
  if (kind === 4) return !blockedV4.check(ip, "ipv4");
  if (kind === 6) return publicV6.check(ip, "ipv6") && !blockedV6.check(ip, "ipv6");
  return false;
}

const privateAllowed = () => process.env.DUDE_ALLOW_PRIVATE_FETCH === "1";
const refusal = (host: string) => new Error(`${host} is on this computer or a private network, which web_fetch can't read`);

/** dns.lookup that only ever hands back public addresses. */
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return callback(err, "", 0);
    const ok = list.filter((a) => isPublicAddress(a.address));
    if (!ok.length) return callback(refusal(hostname), "", 0);
    if (options.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
};

export interface PublicResponse {
  status: number;
  url: string;
  contentType: string;
  body: string;
}

const MAX_REDIRECTS = 5;

/** GET a public page. Follows up to 5 redirects and keeps at most `maxBytes` of the body. */
export async function fetchPublic(
  target: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {}
): Promise<PublicResponse> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let url = new URL(target);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses can be fetched");
    if (url.username || url.password) throw new Error("Addresses with a username or password in them can't be fetched");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // an address written as numbers is connected to directly, without the lookup above
    if (!privateAllowed() && net.isIP(host) && !isPublicAddress(host)) throw refusal(host);
    const res = await get(url, opts.headers ?? {}, signal, opts.maxBytes ?? 5 * 1024 * 1024);
    if (res.location && res.status >= 300 && res.status < 400) {
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = new URL(res.location, url);
      continue;
    }
    return { status: res.status, url: url.href, contentType: res.contentType, body: res.body };
  }
}

function get(url: URL, headers: Record<string, string>, signal: AbortSignal, maxBytes: number) {
  return new Promise<{ status: number; location?: string; contentType: string; body: string }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        agent: false, // a fresh connection each time: a kept-alive one would skip the address check
        headers: { accept: "*/*", "accept-encoding": "gzip, deflate, br", ...headers },
        lookup: privateAllowed() ? undefined : publicLookup,
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        const location = res.headers.location;
        if (location && status >= 300 && status < 400) {
          res.destroy();
          return resolve({ status, location, contentType, body: "" });
        }
        const unzip = decoder(String(res.headers["content-encoding"] ?? "").toLowerCase());
        const stream = unzip ? res.pipe(unzip) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
        res.on("error", reject);
        if (unzip) unzip.on("error", reject);
        stream.on("end", done);
        stream.on("data", (chunk: Buffer) => {
          if (size >= maxBytes) return;
          chunks.push(chunk.subarray(0, maxBytes - size));
          size += chunk.length;
          if (size >= maxBytes) {
            done();
            res.destroy();
            unzip?.destroy();
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function decoder(encoding: string) {
  if (encoding === "gzip" || encoding === "x-gzip") return zlib.createGunzip();
  if (encoding === "br") return zlib.createBrotliDecompress();
  if (encoding === "deflate") return zlib.createInflate();
  return null;
}
