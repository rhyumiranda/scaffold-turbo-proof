import net from 'node:net';
function go(label, cl) { return new Promise((resolve) => {
  const t0 = Date.now(); const s = net.connect(3103, '127.0.0.1'); let buf = '';
  s.on('connect', () => s.write(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: http://localhost:3103\r\nSec-Fetch-Site: same-origin\r\nNext-Action: 600980683472081f0745a17ac47ae166fdff54e88d\r\nContent-Type: multipart/form-data; boundary=----z2b\r\nContent-Length: ${cl}\r\n\r\n------z2b\r\nContent-Dispo`));
  s.on('data', (d) => (buf += d)); s.on('close', () => resolve(`${label}: closed after ${Math.round((Date.now() - t0) / 1000)}s, response: ${JSON.stringify(buf.slice(0, 40))}`)); s.on('error', (e) => resolve(`${label}: error ${e.code} after ${Math.round((Date.now() - t0) / 1000)}s`));
  setTimeout(() => { s.destroy(); }, 45000);
}); }
console.log(await Promise.all([go('CL=1048576 (exact limit), body truncated', 1048576), go('CL=1048577 (over limit), body truncated', 1048577)]).then((r) => r.join('\n')));
