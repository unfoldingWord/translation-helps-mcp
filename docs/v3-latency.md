# /v3 latency

Each `/v3` tool call writes one Analytics Engine point. The first five blobs and the first double are the same columns `/v2` already uses. A `/v3` point appends three fields and does not reorder the earlier ones.

| Position | Field       | Meaning                                                                                                                          |
| -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| blob1    | tool        | `v3:` plus the tool name, for example `v3:th_get_passage`                                                                        |
| blob2    | requestId   | Id for that call                                                                                                                 |
| blob3    | cacheStatus | `hit`, `miss`, `stale`, or `none`. `views`, `memory` and `kv` count as `hit`. `r2` counts as `stale`. `network` counts as `miss` |
| blob4    | errorCode   | `OK`, or `TIMEOUT` when the API did not answer within 20 seconds                                                                 |
| blob5    | language    | BCP-47 code when the tool was given one                                                                                          |
| blob6    | layer       | The slowest layer that answered: `views`, `memory`, `kv`, `r2`, or `network`                                                     |
| double1  | latencyMs   | Time inside the MCP worker, including the wait on the API                                                                        |
| double2  | apiMs       | Sum of the API `Server-Timing` `total` durations. A tool that calls the API twice adds both                                      |
| double3  | mcpMs       | `latencyMs` minus the time the MCP worker spent waiting on those API calls                                                       |

`/v2` points stay five blobs and one double. The dataset is `translation_helps_metrics` on account `5a3ffd86280d3ed086be76d955829242`. Sampling is off, so `_sample_interval` is 1. The weighted quantiles stay right if sampling is turned on later.

The REST routes `/v3` calls send `Server-Timing` on the JSON response: `layer;desc="kv", total;dur=12`, plus any durations that route already recorded (`catalogMs`, `zipMs`, and so on). The header does not include a path, a cache key, or the caller's text. When several layers answered, `layer` is the slowest of `network`, `r2`, `kv`, `memory`, `views`.

## p50 and p90 for the last 7 days

```sql
SELECT
  blob1 AS tool,
  blob6 AS layer,
  quantileWeighted(0.5)(double1, _sample_interval) AS p50_ms,
  quantileWeighted(0.9)(double1, _sample_interval) AS p90_ms,
  quantileWeighted(0.5)(double2, _sample_interval) AS p50_api_ms,
  quantileWeighted(0.9)(double2, _sample_interval) AS p90_api_ms,
  quantileWeighted(0.5)(double3, _sample_interval) AS p50_mcp_ms,
  quantileWeighted(0.9)(double3, _sample_interval) AS p90_mcp_ms,
  SUM(_sample_interval) AS calls
FROM translation_helps_metrics
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 LIKE 'v3:%'
GROUP BY tool, layer
ORDER BY tool, layer
```

## How to run it

Create an API token that can read Analytics Engine for this account. Do not put the token in the repo.

```bash
curl --request POST \
  "https://api.cloudflare.com/client/v4/accounts/5a3ffd86280d3ed086be76d955829242/analytics_engine/sql" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: text/plain" \
  --data-binary @query.sql
```

`query.sql` is the statement above. The body is the SQL itself, not JSON. The response is JSON with a `data` array, one row per tool and layer.

Points from before this change have no blob6. They do not match `blob1 LIKE 'v3:%'` together with a layer until new calls are recorded, and older `/v3` rows simply have an empty layer.
