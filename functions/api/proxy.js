/**
 * FreeRead Edge Proxy Function (Cloudflare Pages Functions)
 * 
 * Provides secure, allowlisted, high-performance edge proxying and caching
 * for open-access libraries, catalogs, and archival repositories.
 * 
 * Complies with strict security policies:
 * - Method restrictions (GET, HEAD, OPTIONS)
 * - Strict hostname allowlisting
 * - SSRF protection (rejects private/local IPs, custom ports, non-HTTPS)
 * - Header sanitization (strips upstream cookies, hides internal infrastructure)
 * - Global edge caching via Cloudflare Cache API
 */

const ALLOWED_HOSTS = [
  "archive.org",
  "openlibrary.org",
  "covers.openlibrary.org",
  "gutendex.com",
  "gutenberg.org",
  "www.gutenberg.org",
  "standardebooks.org",
  "wikisource.org",
  "wikimedia.org",
  "upload.wikimedia.org",
  "arxiv.org",
  "export.arxiv.org",
  "ebi.ac.uk",
  "www.ebi.ac.uk",
  "openalex.org",
  "api.openalex.org",
  "api.mangadex.org",
  "uploads.mangadex.org",
  "cmd.mangadex.org",
  "mangadex.network",
  "thuprai.com",
  "wikipedia.org"
];

function isPrivateOrLocalIp(host) {
  // Check IPv4 literal
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Pattern);
  if (match) {
    const [_, a, b] = match.map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // Loopback
    if (a === 169 && b === 254) return true; // Link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true;
    return true; // Disallow raw IPv4 hosts in general for safety
  }

  // Check IPv6 literal or localhost
  if (host === "localhost" || host.includes(":") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  return false;
}

function isAllowedHost(hostname) {
  const h = hostname.toLowerCase();
  if (isPrivateOrLocalIp(h)) return false;
  return ALLOWED_HOSTS.some(allowed => h === allowed || h.endsWith("." + allowed));
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Accept",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, Accept-Ranges",
  "X-Content-Type-Options": "nosniff"
};

export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed. Only GET, HEAD, and OPTIONS are supported." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }

  const reqUrl = new URL(request.url);
  const targetParam = reqUrl.searchParams.get("url");

  if (!targetParam) {
    return new Response(
      JSON.stringify({ error: "Missing required query parameter: 'url'" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetParam);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid target URL format." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }

  // Protocol check: Only HTTPS allowed
  if (targetUrl.protocol !== "https:") {
    return new Response(
      JSON.stringify({ error: "Forbidden: Only secure HTTPS endpoints are allowed." }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }

  // Port check: Disallow non-standard ports
  if (targetUrl.port && targetUrl.port !== "443") {
    return new Response(
      JSON.stringify({ error: "Forbidden: Non-standard ports are prohibited." }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }

  // Allowlist & SSRF check
  if (!isAllowedHost(targetUrl.hostname)) {
    return new Response(
      JSON.stringify({
        error: `Forbidden host '${targetUrl.hostname}'. Target must belong to the trusted open-access catalog allowlist.`
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }

  // Check Cloudflare Cache
  let cache = null;
  let cacheKey = null;
  try {
    if (typeof caches !== "undefined" && caches && caches.default) {
      cache = caches.default;
      cacheKey = new Request(reqUrl.toString(), request);
    }
  } catch (_) {}

  if (cache && cacheKey && request.method === "GET") {
    try {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const hitHeaders = new Headers(cachedResponse.headers);
        hitHeaders.set("X-Cache-Status", "HIT");
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          hitHeaders.set(k, v);
        }
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers: hitHeaders
        });
      }
    } catch (_) {}
  }

  // Build clean upstream request
  const upstreamHeaders = new Headers();
  upstreamHeaders.set("User-Agent", "FreeRead-UniversalReadingRoom/1.0 (+https://github.com/aixenon1-ctrl/freeread)");
  upstreamHeaders.set("Accept", request.headers.get("Accept") || "*/*");
  if (request.headers.has("Range")) {
    upstreamHeaders.set("Range", request.headers.get("Range"));
  }

  try {
    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow"
    });

    // Prepare response headers
    const responseHeaders = new Headers();
    for (const [key, value] of upstreamResponse.headers.entries()) {
      const lower = key.toLowerCase();
      // Drop cookies and sensitive upstream server metadata
      if (lower === "set-cookie" || lower === "set-cookie2" || lower === "server") continue;
      responseHeaders.set(key, value);
    }

    // Set standard CORS & security headers
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(k, v);
    }

    // Set edge cache directives
    if (upstreamResponse.ok) {
      responseHeaders.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
    }
    responseHeaders.set("X-Cache-Status", "MISS");

    const modifiedResponse = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });

    // Cache successful GET responses (status 200) in Cloudflare edge cache
    if (cache && cacheKey && request.method === "GET" && upstreamResponse.status === 200 && context && context.waitUntil) {
      try {
        context.waitUntil(cache.put(cacheKey, modifiedResponse.clone()));
      } catch (_) {}
    }

    return modifiedResponse;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Upstream gateway error", details: err.message || String(err) }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      }
    );
  }
}
