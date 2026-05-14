# GRAFANA_DASHBOARD_MINIMAL

Panels minimaux pre-cutover:

1. HTTP error rate (5xx)
```
100 * (
  sum(rate(http_server_requests_seconds_count{application="spotu-api",status=~"5.."}[5m]))
  /
  clamp_min(sum(rate(http_server_requests_seconds_count{application="spotu-api"}[5m])), 1)
)
```

2. HTTP latency p95
```
histogram_quantile(
  0.95,
  sum(rate(http_server_requests_seconds_bucket{application="spotu-api"}[5m])) by (le)
)
```

3. JVM heap usage %
```
100 *
sum(jvm_memory_used_bytes{application="spotu-api",area="heap"})
/
clamp_min(sum(jvm_memory_max_bytes{application="spotu-api",area="heap"}), 1)
```

4. Hikari pending connections
```
max(hikaricp_connections_pending{application="spotu-api"})
```

5. WebSocket active sessions par canal
```
spotu_ws_active_sessions{application="spotu-api"}
```

6. Expo push failed rate (15 min)
```
100 *
(
  clamp_min(delta(spotu_push_expo_failed_total{application="spotu-api"}[15m]), 0)
  /
  clamp_min(delta(spotu_push_expo_attempted_total{application="spotu-api"}[15m]), 1)
)
```

7. Marketplace async failures (delta 15 min)
```
clamp_min(delta(spotu_marketplace_async_failed_total{application="spotu-api"}[15m]), 0)
```

