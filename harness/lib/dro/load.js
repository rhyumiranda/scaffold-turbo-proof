import http from 'k6/http';
import { Counter } from 'k6/metrics';
const s200 = new Counter('status_200'), s429 = new Counter('status_429'), s503 = new Counter('status_503'), sOther = new Counter('status_other');
export const options = { vus: 200, duration: '60s' };
export default function () {
  const r = http.get(__ENV.URL, { headers: { authorization: 'Bearer ' + __ENV.TOKEN } });
  if (r.status === 200) s200.add(1); else if (r.status === 429) s429.add(1); else if (r.status === 503) s503.add(1); else sOther.add(1);
}
