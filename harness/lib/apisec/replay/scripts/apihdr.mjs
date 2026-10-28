for (const p of ['/health/live','/health/ready','/v1/projects','/v1/does-not-exist']) {
  const r = await fetch('http://127.0.0.1:4103' + p);
  const h = Object.fromEntries(r.headers);
  const csp = h['content-security-policy'] || '';
  console.log(`API GET ${p} | HTTP ${r.status} | csp: ${!!csp} | nosniff: ${h['x-content-type-options']} | referrer: ${h['referrer-policy']} | hsts: ${h['strict-transport-security']} | x-powered-by: ${h['x-powered-by'] ?? null} | xfo: ${h['x-frame-options']} | corp: ${h['cross-origin-resource-policy']} | coop: ${h['cross-origin-opener-policy']} | csp=${csp}`);
}
