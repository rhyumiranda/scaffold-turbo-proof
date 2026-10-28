// Mutation fuzzer for Server Action requests. Usage: node fuzz.mjs <origin> <createId> <renameId> <iterations>
const [origin, create, rename, n] = process.argv.slice(2);
const B = '----WebKitFormBoundaryFuzz0123456789';
const valid = (zero, fields = [['_1_name', 'Fuzz']]) =>
  `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${zero}\r\n` +
  fields.map(([k, v]) => `--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${B}--\r\n`;
const zeros = ['[{"status":"idle","message":""},"$K1"]', '["$undefined","$K1"]', '[{"a":"$$x"},"$K1"]'];
const refs = ['$F1', '$@1', '$Q1', '$W1', '$h1', '$T', '$D2020', '$n1', '$-0', '$NaN', '$Infinity', '$S1', '$E1', '$i1', '$B1', '$K', '$K1x', '$l1', '$Z', '$', '$0', '$:'];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
function mutate() {
  const zero = rnd(zeros);
  const choice = Math.floor(Math.random() * 14);
  let body = valid(zero), type = `multipart/form-data; boundary=${B}`;
  switch (choice) {
    case 0: body = valid(`[${JSON.stringify(rnd(refs))},"$K1"]`); break;
    case 1: body = valid(`[{"x":[${JSON.stringify(rnd(refs))}]},"$K1"]`); break;
    case 2: { const b = Buffer.from(body); for (let i = 0; i < 1 + Math.random() * 5; i++) b[Math.floor(Math.random() * b.length)] = Math.floor(Math.random() * 256); return { body: b, type }; }
    case 3: body = body.slice(0, Math.floor(Math.random() * body.length)); break;
    case 4: body = body.replace('Content-Disposition: form-data; name="0"', rnd(['content-disposition: form-data; name="0"', 'Content-Disposition: form-data;name="0"', 'Content-Disposition: form-data; name=0', 'Content-Disposition: form-data; name="0"; filename="a"', 'Content-Disposition: attachment; name="0"', 'Content-Disposition: form-data; name="0"\r\nContent-Type: application/json'])); break;
    case 5: body = valid(zero, [['_1_name', 'a'], ['_1_name', 'b']]); break;
    case 6: body = valid(zero, [[rnd(['1', '_1', '__1_x', '_1_', '_0_name', '$ACTION_KEY', '_1_né', '_1_' + 'x'.repeat(70), '00']), 'v']]); break;
    case 7: body = valid(`[${'['.repeat(30 + Math.floor(Math.random() * 10))}${']'.repeat(30)}`); break;
    case 8: body = valid(JSON.stringify(Array(995 + Math.floor(Math.random() * 10)).fill(0))); break;
    case 9: type = rnd([`multipart/form-data; boundary="${B}"`, `multipart/form-data;boundary=${B}`, `multipart/form-data; boundary=${B}; charset=utf-8`, `multipart/mixed; boundary=${B}`, 'multipart/form-data', `MULTIPART/FORM-DATA; BOUNDARY=${B}`]); break;
    case 10: body = body.replaceAll('\r\n', rnd(['\n', '\r', '\r\n\r\n'])); break;
    case 11: body = valid(rnd(['{}', '[]', '[1]', '"$K1"', '[null,null]', '[{"__proto__":{"x":1}},"$K1"]', '[{"constructor":1},"$K1"]', '["\\u0000","$K1"]', '["\ud800","$K1"]'])); break;
    case 12: body = valid(zero) + rnd(['', 'trailing', `--${B}\r\n`, '\r\n\r\n']); break;
    case 13: body = `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${zero}\r\n--${B}\r\n--${B}--\r\n`; break;
  }
  return { body: Buffer.from(body), type };
}
const counts = {}; const fivexx = [];
for (let i = 0; i < Number(n); i++) {
  const { body, type } = mutate();
  const id = Math.random() < 0.5 ? create : rename;
  const path = Math.random() < 0.5 ? '/projects' : '/projects/00000000-0000-4000-8000-000000000000';
  const headers = { origin, 'sec-fetch-site': 'same-origin', 'content-type': type };
  if (Math.random() < 0.9) headers['next-action'] = id;
  let status;
  try { status = (await fetch(origin + path, { method: 'POST', headers, body })).status; } catch (e) { status = 'ERR:' + e.cause?.code; }
  counts[status] = (counts[status] ?? 0) + 1;
  if (String(status).startsWith('5') && fivexx.length < 10) fivexx.push({ type, body: body.toString('latin1').slice(0, 300) });
}
console.log(JSON.stringify(counts));
for (const f of fivexx) console.log('5xx sample:', JSON.stringify(f));
