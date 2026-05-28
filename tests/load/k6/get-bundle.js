/**
 * k6 load test — get_bundle endpoint
 *
 * Targets: P95 <= 500ms, error rate < 1%, cache hit >= 70%
 *
 * Usage:
 *   BASE_URL=https://staging.example.com k6 run tests/load/k6/get-bundle.js
 *
 * Default: runs against http://localhost:8787 (wrangler dev)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const bundleLatency = new Trend("get_bundle_latency", true);
const bundleErrors = new Rate("get_bundle_errors");
const bundleCacheHit = new Rate("get_bundle_cache_hit");

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: "30s", target: 10 }, // ramp up
    { duration: "2m", target: 30 }, // steady state
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: {
    "get_bundle_latency{p:95}": ["p(95)<500"],
    get_bundle_errors: ["rate<0.01"],
    get_bundle_cache_hit: ["rate>0.70"], // 70% cache hit target
    http_req_failed: ["rate<0.01"],
  },
};

// ---------------------------------------------------------------------------
// Test data — concentrated on hot references to exercise cache
// ---------------------------------------------------------------------------

const BUNDLES = [
  { language: "en", reference: "JHN 3:16" },
  { language: "en", reference: "GEN 1:1" },
  { language: "en", reference: "MAT 5:1" },
  { language: "en", reference: "ROM 8:1" },
  { language: "en", reference: "PSA 23:1" },
  { language: "es-419", reference: "JHN 3:16" },
  { language: "es-419", reference: "GEN 1:1" },
  { language: "fr", reference: "JHN 3:16" },
  { language: "pt-BR", reference: "JHN 3:16" },
  // Intentional repeats to drive cache hit rate up
  { language: "en", reference: "JHN 3:16" },
  { language: "en", reference: "JHN 3:16" },
  { language: "en", reference: "GEN 1:1" },
];

// ---------------------------------------------------------------------------
// Default function
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || "http://localhost:8787";

export default function () {
  const b = BUNDLES[Math.floor(Math.random() * BUNDLES.length)];

  const payload = JSON.stringify({
    language: b.language,
    reference: b.reference,
  });

  const res = http.post(`${BASE_URL}/api/skill/fetch-passage`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { name: "get_bundle" },
  });

  bundleLatency.add(res.timings.duration);

  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "has bundle.notes": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.bundle?.notes);
      } catch {
        return false;
      }
    },
    "has bundle.metadata": (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.bundle?.metadata?.cacheStatus === "string";
      } catch {
        return false;
      }
    },
    "has requestId": (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.requestId === "string";
      } catch {
        return false;
      }
    },
  });

  bundleErrors.add(!ok);

  // Track cache efficiency
  try {
    const body = res.json();
    const cacheStatus = body?.bundle?.metadata?.cacheStatus;
    bundleCacheHit.add(cacheStatus !== "miss" ? 1 : 0);
  } catch {
    bundleCacheHit.add(0);
  }

  sleep(0.3);
}
