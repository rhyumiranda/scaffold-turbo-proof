import { capture, Tally, rq } from './z5lib.mjs';
const c = await capture();
const T = new Tally('z5-bom');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const mk = (B, parts) => Buffer.from(parts.map(([n, v]) => `--${B}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + `--${B}--\r\n`, 'utf8');
for (const [label, pre, parts] of [
  ['BOM + [0,_1_name]', BOM, [['0', '["$K1"]'], ['_1_name', 'z5-bom']]],
  ['BOM + [_1_name,0]', BOM, [['_1_name', 'z5-bom'], ['0', '["$K1"]']]],
  ['BOM + only 0', BOM, [['0', '["$K1"]']]],
  ['no BOM control', Buffer.alloc(0), [['0', '["$K1"]'], ['_1_name', 'z5-ctrl']]],
  ['2xBOM', Buffer.concat([BOM, BOM]), [['0', '["$K1"]'], ['_1_name', 'z5-bom2']]],
]) for (const [an, id] of [['create', c.createId]]) {
  const body = Buffer.concat([pre, mk('BB', parts)]);
  const r = await T.run(`${label} ${an}`, rq({ method: 'POST', target: '/projects', h: { Origin: 'http://localhost:3103', 'Sec-Fetch-Site': 'same-origin', 'Next-Action': id, 'Content-Type': 'multipart/form-data; boundary=BB', Cookie: c.cookie }, body }), { timeout: 20000 });
  console.log(label, r.status, r.ms + 'ms', r.head.slice(0, 160), '|', r.body.slice(0, 120));
}
T.done();
