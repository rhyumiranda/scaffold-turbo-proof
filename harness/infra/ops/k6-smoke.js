import http from 'k6/http';
import { check, sleep } from 'k6';
const tokens = JSON.parse(open('/secrets/tokens.json'));
const base = __ENV.BASE;
export const options = {
  scenarios: { smoke: { executor: 'constant-vus', vus: 50, duration: '3m' } },
  thresholds: { http_req_failed: ['rate<0.001'], http_req_duration: ['p(95)<300'] },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
export default function () {
  const token = tokens[(__VU - 1) % tokens.length];
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  if (Math.random() < 0.8) {
    const r = http.get(base + '/v1/projects?limit=20', { headers, tags: { op: 'list' } });
    check(r, { 'list 200': (x) => x.status === 200 });
  } else {
    const r = http.post(base + '/v1/projects', JSON.stringify({ name: 'load ' + __VU + '-' + __ITER }), { headers, tags: { op: 'create' } });
    check(r, { 'create 201': (x) => x.status === 201 });
  }
  sleep(1); // one second think time per virtual user: a modest load, as the criterion asks
}
