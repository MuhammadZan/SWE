## Why this matters

A customer in Singapore reports that "the invoice list takes four seconds." Your API logs say the handler finished in 80 ms. Both are true. The other 3.9 seconds went to a DNS lookup, a TCP handshake, a TLS handshake, a few round trips across the Pacific, a cold connection to your load balancer, and a waterfall of 14 sequential fetches the frontend makes after the first response. None of that is in your application logs.

Most web developers treat the network as a black box between `fetch()` and the route handler. That works until you need to explain a latency spike, pick timeouts, configure a CDN, debug a "connection reset by peer", or answer the classic interview question "what happens when you type a URL and press Enter?" This lesson opens the box just far enough to be useful at work.

## The life of a request

Here is what happens when the browser loads `https://app.acme-erp.com/invoices` on a cold start:

```
Browser                DNS resolver        CDN / LB edge            Origin (Node)
   |  1. DNS query  ------->|                    |                        |
   |<------- A/AAAA record -|                    |                        |
   |  2. TCP SYN  -------------------------------->|                        |
   |<---------------------------------- SYN-ACK ---|                        |
   |  ACK + 3. TLS ClientHello ------------------->|                        |
   |<------------------- ServerHello, cert, Finished|                        |
   |  4. HTTP GET /invoices ---------------------->|  5. (pooled conn) ---->|
   |                                              |<------- 200 + body ----|
   |<------------------------------- 200 + body ---|                        |
```

Count the round trips (RTT) before the first byte of the response arrives:

| Step | Round trips | Notes |
|---|---|---|
| DNS | 0–1+ | Cached at OS/browser level usually; a cold recursive lookup can take several hops |
| TCP handshake | 1 | SYN, SYN-ACK, then ACK can carry data |
| TLS 1.3 handshake | 1 | TLS 1.2 needed 2; TLS 1.3 resumption with 0-RTT can send data immediately (replay risk, so only for idempotent requests) |
| HTTP request/response | 1 | Plus server think time |

With a 150 ms RTT (Singapore to us-east-1 is roughly 200+ ms), a cold HTTPS request costs at least 3 RTT = 450 ms before your server even matters. This is why reusing connections and moving TLS termination closer to users (a CDN edge) is often a bigger win than optimizing a handler.

### DNS

DNS maps a name to an address. Records you will meet: `A` (IPv4), `AAAA` (IPv6), `CNAME` (alias to another name), `TXT` (verification, SPF), `MX` (mail). Every answer has a TTL; resolvers cache it for that long. Practical consequences:

- Lower the TTL (for example to 60 s) a day **before** a migration, so the switchover propagates fast. Lowering it during the incident does not help, because resolvers still hold the old long TTL.
- A `CNAME` cannot sit at the zone apex (`acme-erp.com`); providers offer ALIAS/ANAME flattening instead.
- Custom domains for tenants (`billing.customer.com` CNAME to `tenants.acme-erp.com`) are DNS plus TLS certificate issuance problems, not app problems.

### TCP and TLS

TCP gives you an ordered, reliable byte stream on top of IP. It also has **slow start**: a new connection begins with a small congestion window (commonly 10 segments, about 14 KB) and grows it as ACKs return. So a fresh connection cannot use your full bandwidth immediately, which is another reason warm, reused connections are fast.

TLS 1.3 authenticates the server (certificate chain up to a trusted CA, hostname match) and encrypts the stream. During the handshake the client sends the hostname via **SNI**, which lets one IP serve many certificates, and negotiates the application protocol via **ALPN** (`h2` or `http/1.1`).

## HTTP/1.1 vs HTTP/2 vs HTTP/3

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC over UDP |
| Requests per connection | One at a time (pipelining is effectively unused) | Many concurrent streams, multiplexed | Many concurrent streams |
| Headers | Plain text, repeated | Binary, compressed with HPACK | Compressed with QPACK |
| Head-of-line blocking | At HTTP level | Fixed at HTTP level, still at TCP level (one lost packet stalls all streams) | Eliminated: loss affects only its stream |
| Handshake | TCP + TLS | TCP + TLS | QUIC combines transport and TLS 1.3 into 1 RTT |
| Connection migration | No | No | Yes, survives a Wi-Fi to 4G switch via connection IDs |

Browsers open up to about six HTTP/1.1 connections per origin, which is why old advice said "bundle and sprite everything" and "shard across domains." With HTTP/2 those tricks are unnecessary or harmful. HTTP/3 helps most on lossy mobile networks. You usually get HTTP/2 and HTTP/3 for free from your CDN or load balancer; the hop from the load balancer to your Node process is commonly HTTP/1.1 and that is fine.

### Keep-alive and connection pooling

HTTP/1.1 connections are persistent by default. The win only happens if clients actually reuse them. In server-to-server code this is where people lose latency:

```ts
// Bad: in older Node or with some clients, each call may open a fresh
// TCP+TLS connection to the payment provider.
import https from "node:https";

export function chargeCard(body: string) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "api.payments.example", path: "/charges", method: "POST", agent: false },
      resolve,
    );
    req.on("error", reject);
    req.end(body);
  });
}
```

```ts
// Better: Node 20+ global fetch (undici) pools and keeps connections alive
// per origin. Reuse one client, and set explicit limits.
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({
    connections: 50,            // max sockets per origin
    keepAliveTimeout: 10_000,   // keep idle sockets 10 s
    connectTimeout: 2_000,
  }),
);

export async function chargeCard(payload: unknown) {
  const res = await fetch("https://api.payments.example/charges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  return res.json();
}
```

One subtle production bug: your Node server's `keepAliveTimeout` (default 5 s) is shorter than the load balancer's idle timeout (AWS ALB defaults to 60 s). The LB reuses a socket that Node just closed, and you get sporadic 502s. Fix: set `server.keepAliveTimeout` higher than the LB idle timeout, and `server.headersTimeout` slightly higher still.

```ts
const server = app.listen(3000);
server.keepAliveTimeout = 65_000; // > ALB idle timeout of 60 s
server.headersTimeout = 66_000;
```

## Latency vs bandwidth

**Latency** is how long one round trip takes. **Bandwidth** is how many bytes per second fit through the pipe. They fail differently:

- Latency dominates small, chatty requests. An invoice page that makes 10 sequential API calls at 100 ms RTT costs at least 1 second no matter how fast your server is.
- Bandwidth dominates large payloads, such as a 40 MB CSV export.

Light in fiber travels about 200,000 km/s, so a round trip across the Atlantic has a hard floor near 60 ms. You cannot optimize past physics; you can only reduce round trips (batching, parallelism, connection reuse, edge caching) or move closer.

```ts
// Bad: a request waterfall, each await waits a full RTT
const invoice = await api.get(`/invoices/${id}`);
const customer = await api.get(`/customers/${invoice.customerId}`);
const lines = await api.get(`/invoices/${id}/lines`);

// Better: parallelize independent calls, or have the API return what the
// screen needs in one response (expand=customer,lines)
const [inv, lines2] = await Promise.all([
  api.get(`/invoices/${id}?expand=customer`),
  api.get(`/invoices/${id}/lines`),
]);
```

## Proxies, load balancers and CDNs

```
           +---------+      +-------------------+      +-----------+
client --> |  CDN    | ---> |  Load balancer    | ---> |  Node x3  | --> Postgres
           | (edge)  |      |  (L7, TLS term.)  |      |  (app)    |
           +---------+      +-------------------+      +-----------+
     caches static/      routes by host/path,        your code
     cacheable GETs,     health checks, spreads
     terminates TLS      load, idle timeouts
     near the user
```

- A **forward proxy** sits in front of clients (corporate egress). A **reverse proxy** sits in front of servers (nginx, Envoy, your cloud LB).
- **L4** load balancers route TCP/UDP connections without reading HTTP. **L7** load balancers read HTTP, so they can route `/api` vs `/`, terminate TLS, add headers and retry.
- A **CDN** is a geographically distributed reverse proxy cache. It speeds up static assets and cacheable GETs, and it terminates TLS close to the user even for uncacheable requests.

Because there are proxies in between, the TCP peer your Node process sees is the load balancer, not the user. The real client IP is in `X-Forwarded-For` (or the standard `Forwarded` header). Only trust it when you know how many proxies sit in front of you; otherwise anyone can spoof it, which breaks IP-based rate limiting.

```ts
// Express: trust exactly one proxy hop (your LB), not "true"
app.set("trust proxy", 1);
```

Caching is controlled by headers. Tenant data must never land in a shared cache:

```ts
// Static, fingerprinted asset: cache forever
res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
// Per-user invoice data: only the browser may cache, and must revalidate
res.setHeader("Cache-Control", "private, no-cache");
```

## Timeouts

Every network call can hang forever unless you stop it. A missing timeout on one dependency is how a slow PDF service takes down your whole API: requests pile up, connection pools fill, and memory climbs.

There are several distinct timeouts:

| Timeout | Guards against |
|---|---|
| DNS / connect | Host unreachable, packets dropped |
| TLS handshake | Stuck handshake |
| Time to first byte / headers | Server accepted but is slow to respond |
| Idle / body read | Stalled stream mid-response |
| Total deadline | Everything above combined, plus retries |

Rules of thumb: timeouts should get shorter as you go deeper (the edge allows 30 s, your API 10 s, a downstream call 2–5 s), so an inner call fails before the outer caller gives up. Retry only idempotent operations, with exponential backoff and jitter, and keep the total within the caller's deadline.

```ts
// Bad: no timeout, blind retries on a non-idempotent POST
for (let i = 0; i < 3; i++) {
  try { return await fetch(url, { method: "POST", body }); } catch {}
}

// Better: per-attempt timeout, bounded retries, only for safe calls
async function getWithRetry(url: string, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status < 500) return res;
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
    const backoff = 100 * 2 ** i + Math.random() * 100;
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw new Error("upstream unavailable");
}
```

## Debugging the network

### curl -v

```bash
curl -v https://app.acme-erp.com/api/health
# *   Trying 203.0.113.10:443...
# * Connected to app.acme-erp.com (203.0.113.10) port 443
# * ALPN: server accepted h2
# * SSL connection using TLSv1.3 / TLS_AES_128_GCM_SHA256
# * Server certificate: subject: CN=app.acme-erp.com ... expire date: ...
# > GET /api/health HTTP/2
# < HTTP/2 200
# < cache-control: no-store
```

To see where the time goes:

```bash
curl -o /dev/null -s -w \
  'dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  https://app.acme-erp.com/api/invoices
```

Each value is cumulative from the start. If `ttfb` minus `tls` is large, your server (or something behind it) is slow. If `tls` minus `connect` is large, look at distance or certificate chain size. `--resolve host:443:IP` lets you hit a specific server bypassing DNS, which is useful during migrations.

### dig

```bash
dig app.acme-erp.com +short        # what does it resolve to?
dig app.acme-erp.com A +noall +answer  # shows the remaining TTL
dig @1.1.1.1 app.acme-erp.com      # ask a specific resolver
```

### Browser devtools waterfall

In the Network tab, hover a request's timing bar. Phases: Queueing/Stalled (waiting for a free connection, a sign of HTTP/1.1 limits), DNS Lookup, Initial connection, SSL, Request sent, **Waiting for server response (TTFB)**, Content Download. Long staircase patterns mean request waterfalls; a fat TTFB means server time; a long download means payload size. The Protocol column shows `h2` or `h3`.

## Common mistakes

- **Blaming the server for client-side latency.** Measure TTFB separately from DNS/TCP/TLS before optimizing code.
- **No timeouts on outbound calls**, so one slow dependency exhausts the pool and cascades.
- **Retrying non-idempotent POSTs**, creating duplicate charges or invoices.
- **Trusting `X-Forwarded-For` blindly** with `trust proxy: true`, letting attackers spoof IPs to bypass rate limits.
- **Node keep-alive shorter than the load balancer idle timeout**, causing intermittent 502s.
- **Caching tenant-specific responses as `public`** on a CDN, leaking one tenant's data to another.
- **Changing DNS TTL during the migration** instead of a day before.

## In the real world

In production you rarely configure TCP directly; you configure a CDN (Cloudflare, CloudFront, Fastly), a load balancer (ALB, nginx, Envoy) and HTTP clients. The decisions that matter are the ones above: cache headers, timeouts and retries, keep-alive alignment, trusted proxy hops, and HTTP/2 or HTTP/3 at the edge. Incident postmortems frequently trace back to a missing timeout or a retry storm.

In interviews, "what happens when you type a URL" is a test of depth. A strong answer walks DNS, TCP, TLS 1.3, HTTP/2 negotiation via ALPN, CDN and load balancer, the app, and back, then talks about where latency comes from and how you would measure it. Mentioning round-trip counts, slow start and head-of-line blocking signals you actually understand it.

## Try it

1. Run the `curl -w` timing command against your own production app and against a CDN-hosted static file. Compare `connect`, `tls` and `ttfb`.
2. Run `dig` on your domain and note the TTL. Decide what it should be the day before a migration.
3. Open devtools on your heaviest ERP screen, export the waterfall, and find one sequential chain of requests you could parallelize or merge.
4. In a Node service, add `AbortSignal.timeout()` to every outbound `fetch` and check `server.keepAliveTimeout` against your load balancer's idle timeout.
