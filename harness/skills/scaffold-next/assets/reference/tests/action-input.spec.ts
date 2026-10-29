import { test, expect } from '@playwright/test';
import { request as httpRequest } from 'node:http';

test('incomplete API uploads are client timeouts for fixed-length and chunked bodies', async () => {
  for (const framing of [{ 'content-length': '1000' }, { 'transfer-encoding': 'chunked' }]) {
    const started = Date.now();
    const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const upload = httpRequest(
        new URL('/v1/projects', process.env.TEST_API_URL!),
        { method: 'POST', headers: { 'content-type': 'application/json', ...framing }, agent: false },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () => {
            clearTimeout(timer);
            upload.destroy();
            resolve({ status: response.statusCode, body });
          });
          response.on('error', reject);
        },
      );
      const timer = setTimeout(() => upload.destroy(new Error('Upload timeout was not bounded')), 10000);
      upload.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      upload.write('{');
    });
    expect(result.status).toBe(408);
    expect(JSON.parse(result.body)).toMatchObject({ status: 408, code: 'REQUEST_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(8000);
  }
});

// Server Actions are public HTTP endpoints. Crafted bodies must get a clean 400 from the proxy and never reach the
// framework's argument decoder, which answers malformed input with a 500.
test('crafted Server Action requests are rejected with 400, never 500', async ({ request }) => {
  const headers = {
    origin: process.env.WEB_TEST_URL!,
    'sec-fetch-site': 'same-origin',
    'next-action': '0'.repeat(42),
  };
  for (const data of ['null', '"text"', '[', '["$F1"]']) {
    const response = await request.post('/projects', { headers: { ...headers, 'content-type': 'text/plain' }, data });
    expect(response.status(), `text/plain ${data}`).toBe(400);
    expect(await response.json()).toMatchObject({ status: 'error', fieldError: expect.any(String) });
  }
  for (const zero of ['null', '[', '["$F1","$K1"]', '["$@1","$K1"]', '[{"x":"$Q1"},"$K1"]']) {
    const response = await request.post('/projects', { headers, multipart: { '0': zero, '1_name': 'x' } });
    expect(response.status(), `multipart 0=${zero}`).toBe(400);
  }
  const missing = await request.post('/projects', { headers, multipart: { '1_name': 'x' } });
  expect(missing.status(), 'multipart without field 0').toBe(400);
  const deep = '['.repeat(5000) + ']'.repeat(5000);
  const nested = await request.post('/projects', { headers, multipart: { '0': `[${deep},"$K1"]`, '1_name': 'x' } });
  expect(nested.status(), 'deeply nested arguments').toBe(400);
  // Bodies that a lenient parser would accept but the framework reads differently.
  const raw = (headers: string) =>
    `--b\r\n${headers}\r\n\r\n["$undefined","$K1"]\r\n--b\r\nContent-Disposition: form-data; name="1_name"\r\n\r\nx\r\n--b--\r\n`;
  for (const part of [
    'Content-Disposition: form-data; name="0"\r\nContent-Transfer-Encoding: base64',
    'Content-Disposition: form-data; name="0"\r\nContent-Type: text/plain; charset=utf-16le',
    "Content-Disposition: form-data; name*=utf-8''0",
    'Content-Disposition: form-data; name="0"; name="0"',
  ]) {
    const response = await request.post('/projects', {
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=b' },
      data: Buffer.from(raw(part)),
    });
    expect(response.status(), part).toBe(400);
  }
  const shouted = await request.post('/projects', {
    headers: { ...headers, 'content-type': 'MULTIPART/FORM-DATA; BOUNDARY=b' },
    data: Buffer.from(raw('Content-Disposition: form-data; name="0"')),
  });
  expect(shouted.status(), 'upper-case content type').toBe(400);
  // Boundaries with characters browsers never use, and values that contain the boundary.
  const crafted: [string, string][] = [
    ['multipart/form-data; boundary=a/b', raw('Content-Disposition: form-data; name="0"').replaceAll('--b', '--a/b')],
    [
      'multipart/form-data; boundary=b',
      raw('Content-Disposition: form-data; name="0"').replace('x\r\n', 'x\r\n--b--\r\n'),
    ],
    [
      'multipart/form-data; boundary=b',
      raw('Content-Disposition: form-data; name="0"').replace('\r\n\r\nx', '\r\n\r\n--bx'),
    ],
  ];
  for (const [type, body] of crafted) {
    const response = await request.post('/projects', {
      headers: { ...headers, 'content-type': type },
      data: Buffer.from(body),
    });
    expect(response.status(), body.slice(0, 60)).toBe(400);
  }
  // The framework compares Origin with the forwarded host; a mismatch is refused, not answered with a 500.
  const forwarded = await request.post('/projects', {
    headers: { ...headers, 'x-forwarded-host': 'evil.example' },
    multipart: { '0': '["$undefined","$K1"]', _1_name: 'x' },
  });
  expect(forwarded.status(), 'forwarded host mismatch').toBe(403);
  const image = await request.get('/_next/image?url=%2F');
  expect(image.status(), 'image optimizer').toBeLessThan(500);
  // A byte-order mark before the first boundary makes the framework skip field "0".
  const bom = await request.post('/projects', {
    headers: { ...headers, 'content-type': 'multipart/form-data; boundary=b' },
    data: Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(raw('Content-Disposition: form-data; name="0"')),
    ]),
  });
  expect(bom.status(), 'byte-order mark').toBe(400);
  // Malformed paths and router headers are refused before the framework, which would answer them with a 500.
  for (const path of ['/auth/%', '/auth/%zz', '/projects/%c0%af']) {
    expect((await request.get(path)).status(), path).toBe(400);
  }
  expect((await request.get('/_global-error')).status(), '/_global-error').toBe(404);
  // Non-normal paths (browsers never send them; the HTTP client may normalize some before sending) and POSTs to
  // static files, which the proxy does not see.
  for (const path of ['/x/../_global-error', '/%2e/_global-error', '/projects/%2E%2E/projects']) {
    expect((await request.get(path)).status(), path).toBeLessThan(500);
  }
  for (const path of ['/favicon.ico', '/_next/image', '/_next/image%2f..%2fprojects']) {
    const response = await request.post(path, { headers, multipart: { '0': '["$undefined","$K1"]', _1_name: 'x' } });
    expect(response.status(), `POST ${path}`).toBe(405);
  }
  const tree = await request.get('/nope', { headers: { rsc: '1', 'next-router-state-tree': '%%%' } });
  expect(tree.status(), 'malformed router state').toBe(400);
  const long = await request.post('/projects', { headers, multipart: { '0': JSON.stringify(Array(1001).fill(0)) } });
  expect(long.status(), '1001 arguments').toBe(400);
  // Script-free posts are not a supported path (pages need JavaScript).
  const plain: Record<string, string> = { ...headers };
  delete plain['next-action'];
  const scriptFree = await request.post('/projects', {
    headers: plain,
    multipart: { $ACTION_REF_1: '', '$ACTION_1:0': '{"id":"x","bound":"$@2"}', name: 'x' },
  });
  expect(scriptFree.status(), 'script-free action post').toBe(400);
  const trace = await request.fetch('/projects', { method: 'TRACE' });
  expect(trace.status(), 'TRACE').toBe(405);
});
