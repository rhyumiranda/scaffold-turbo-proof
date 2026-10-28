import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export async function measure({ url, requests = 100, concurrency = 5, token, p95BudgetMs, errorBudget = 0 }) {
  const target = new URL(url);
  if (target.username || target.password || !['http:', 'https:'].includes(target.protocol))
    throw new Error('Invalid load URL');
  if (
    !Number.isInteger(requests) ||
    requests < 1 ||
    requests > 10000 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 128 ||
    concurrency > requests
  )
    throw new Error('Invalid bounded workload');
  if (
    !Number.isFinite(errorBudget) ||
    errorBudget < 0 ||
    errorBudget > 1 ||
    (p95BudgetMs !== undefined && (!Number.isFinite(p95BudgetMs) || p95BudgetMs <= 0))
  )
    throw new Error('Invalid load budget');
  let next = 0,
    errors = 0;
  const durations = [],
    statusCounts = {},
    started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next++ < requests) {
        const start = performance.now();
        try {
          const response = await fetch(target, {
            headers: token ? { authorization: 'Bearer ' + token } : {},
            redirect: 'error',
            signal: AbortSignal.timeout(4000),
          });
          statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
          await response.body?.cancel();
          if (!response.ok) errors++;
        } catch {
          errors++;
        }
        durations.push(performance.now() - start);
      }
    }),
  );
  durations.sort((a, b) => a - b);
  const percentile = (p) => Math.round(durations[Math.ceil(durations.length * p) - 1]);
  const durationMs = Math.round(performance.now() - started),
    errorRate = errors / requests;
  return {
    requests,
    concurrency,
    durationMs,
    requestsPerSecond: Math.round((requests * 1000) / durationMs),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    errorRate,
    statusCounts,
    passed: errorRate <= errorBudget && (p95BudgetMs === undefined || percentile(0.95) <= p95BudgetMs),
    scope: 'Client-observed GET response headers; not server CPU/memory or a production capacity claim',
  };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (!process.env.LOAD_URL) throw new Error('Set LOAD_URL to an authorized target; only GET is sent');
    const result = await measure({
      url: process.env.LOAD_URL,
      requests: Number(process.env.LOAD_REQUESTS ?? 100),
      concurrency: Number(process.env.LOAD_CONCURRENCY ?? 5),
      token: process.env.LOAD_BEARER,
      p95BudgetMs: process.env.LOAD_P95_MS ? Number(process.env.LOAD_P95_MS) : undefined,
      errorBudget: Number(process.env.LOAD_ERROR_RATE ?? 0),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
