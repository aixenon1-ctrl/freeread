/**
 * FreeRead Health Check Function (Cloudflare Pages Functions)
 */

export async function onRequestGet(context) {
  const { request } = context;
  const cf = request.cf || {};

  const payload = {
    status: "ok",
    app: "freeread",
    version: "1.0.0",
    colo: cf.colo || "local",
    country: cf.country || "unknown",
    timestamp: new Date().toISOString(),
    capabilities: [
      "federated-catalog-search",
      "text-cleanup-engine",
      "epub-rendering",
      "pdf-rendering",
      "scan-facsimiles",
      "edge-caching-proxy",
      "offline-indexeddb"
    ]
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
