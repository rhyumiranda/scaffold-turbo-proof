import { capture, Tally, rq } from './z5lib.mjs';
const c = await capture();
const T = new Tally('z5e-authed-5xx-probe');
const tree = '%5B%22%22%2C%7B%22children%22%3A%5B%22projects%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D';
const UNK = '00000000-0000-4000-8000-000000000000';
const cases = [
  ['authed GET /projects/%', '/projects/%', {}], ['authed GET /projects/%zz', '/projects/%zz', {}], ['authed GET /projects/%ff', '/projects/%ff', {}], ['authed GET /projects/%25', '/projects/%25', {}],
  ['authed GET /projects/<unknown uuid> (notFound page)', '/projects/' + UNK, {}], ['authed GET /projects/not-a-uuid', '/projects/not-a-uuid', {}],
  ['authed RSC+tree /projects/<unknown uuid>', '/projects/' + UNK, { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /projects/not-a-uuid', '/projects/not-a-uuid', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /projects/<pid>', '/projects/' + c.pid, { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /projects', '/projects', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree + prefetch /projects/<pid>', '/projects/' + c.pid, { RSC: '1', 'Next-Router-State-Tree': tree, 'Next-Router-Prefetch': '1' }],
  ['authed RSC+tree /signed-out', '/signed-out', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /', '/', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /sign-in-problem', '/sign-in-problem', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /nope', '/nope', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /auth/login', '/auth/login', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /healthz', '/healthz', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /_not-found', '/_not-found', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed RSC+tree /_global-error', '/_global-error', { RSC: '1', 'Next-Router-State-Tree': tree }],
  ['authed GET /_not-found', '/_not-found', {}], ['authed GET /_global-error', '/_global-error', {}],
  ['authed GET /projects/ + garbage query %', '/projects?x=%', {}],
  ['authed GET /projects/<pid>/%', '/projects/' + c.pid + '/%', {}],
  ['authed GET /%', '/%', {}],
];
for (const [l, p, h] of cases) { const r = await T.run(l, rq({ target: p, h: { Cookie: c.cookie, ...h } })); console.log(String(r.status).padEnd(5), l); }
T.done();
