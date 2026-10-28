import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
export async function collector() {
  const records = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2000000) throw new Error('too big');
        chunks.push(chunk);
      }
      let body = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body, { maxOutputLength: 4000000 });
      records.push(JSON.parse(body.toString()));
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    } catch {
      res.writeHead(400);
      res.end('{}');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    endpoint: 'http://127.0.0.1:' + server.address().port,
    async verify({ paired = false } = {}) {
      let spans = [],
        metricNames = [];
      for (let i = 0; i < 150; i++) {
        spans = records.flatMap((r) =>
          (r.resourceSpans ?? []).flatMap((s) => (s.scopeSpans ?? []).flatMap((s) => s.spans ?? [])),
        );
        metricNames = records.flatMap((r) =>
          (r.resourceMetrics ?? []).flatMap((s) =>
            (s.scopeMetrics ?? []).flatMap((s) => (s.metrics ?? []).map((m) => m.name)),
          ),
        );
        const root = spans.find(
          (s) =>
            s.name === 'postgres.query' &&
            spans.some((p) => p.traceId === s.traceId && p.name === 'http.request') &&
            (!paired || spans.some((p) => p.traceId === s.traceId && p.name === 'projects.list')),
        );
        if (
          root &&
          metricNames.includes('http.server.requests') &&
          (!paired || metricNames.includes('api.request.count'))
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(
        spans.some(
          (s) =>
            s.name === 'postgres.query' &&
            spans.some((p) => p.traceId === s.traceId && p.name === 'http.request') &&
            (!paired || spans.some((p) => p.traceId === s.traceId && p.name === 'projects.list')),
        ),
        'Missing exported correlated spans',
      );
      assert.ok(metricNames.includes('http.server.requests'));
      if (paired) assert.ok(metricNames.includes('api.request.count'));
      assert.ok(!JSON.stringify(records).includes('never-log-this'), 'Sensitive sentinel exported');
      return {
        passed: true,
        paired,
        spanCount: spans.length,
        metricNames: [...new Set(metricNames)],
        scope: 'Loopback OTLP receiver; no vendor alerts or retention verified',
      };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
