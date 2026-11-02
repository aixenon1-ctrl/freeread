/**
 * FreeRead Universal Worker (Cloudflare Workers + Static Assets)
 * Handles API routes and falls back to static assets (index.html, etc.)
 */

import { onRequest as proxyHandler } from "./functions/api/proxy.js";
import { onRequestGet as healthHandler } from "./functions/api/health.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route /api/proxy
    if (url.pathname === "/api/proxy") {
      return proxyHandler({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    }

    // Route /api/health
    if (url.pathname === "/api/health") {
      return healthHandler({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    }

    // Static Assets fallback (index.html, etc.)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("FreeRead Asset Binding Not Found", { status: 500 });
  }
};
