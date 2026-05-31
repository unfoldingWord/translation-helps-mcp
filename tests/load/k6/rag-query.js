/**
 * k6 load test — rag_query endpoint
 *
 * Targets: P95 <= 500ms, error rate < 1%
 *
 * Usage:
 *   BASE_URL=https://staging.example.com k6 run tests/load/k6/rag-query.js
 *
 * Default: runs against http://localhost:8787 (wrangler dev)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const ragQueryLatency = new Trend("rag_query_latency", true);
const ragQueryErrors = new Rate("rag_query_errors");
const cacheHitRate = new Rate("rag_query_cache_hit");

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
    "rag_query_latency{p:95}": ["p(95)<500"],
    rag_query_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
  },
};

// ---------------------------------------------------------------------------
// Test data — spread across common references
// ---------------------------------------------------------------------------

const QUERIES = [
  { query: "What does grace mean?", language: "en", reference: "JHN 3:16" },
  {
    query: "translation notes for love",
    language: "en",
    reference: "JHN 13:34",
  },
  { query: "eternal life concepts", language: "en", reference: "JHN 10:28" },
  { query: "gospel message", language: "en", reference: "ROM 1:16" },
  { query: "faith and works", language: "en", reference: "JAS 2:17" },
  {
    query: "notas de traducción gracia",
    language: "es-419",
    reference: "JHN 3:16",
  },
  { query: "contexte de la creation", language: "fr", reference: "GEN 1:1" },
  { query: "amor eterno", language: "es-419", reference: "1CO 13:4" },
];

// ---------------------------------------------------------------------------
// Default function
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || "http://localhost:8787";

export default function () {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  const payload = JSON.stringify({
    query: q.query,
    language: q.language,
    reference: q.reference,
    k: 10,
  });

  const res = http.post(`${BASE_URL}/api/skill/query`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { name: "rag_query" },
  });

  ragQueryLatency.add(res.timings.duration);

  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "has documents array": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.documents);
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

  ragQueryErrors.add(!ok);

  // Track cache efficiency
  const body = res.json();
  if (body && body.cacheStatus === "hit") {
    cacheHitRate.add(1);
  } else {
    cacheHitRate.add(0);
  }

  sleep(0.5);
}
