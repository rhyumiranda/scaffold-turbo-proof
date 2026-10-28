import { capture } from './z5lib.mjs';
import { writeFileSync } from 'node:fs';
const c = await capture(); writeFileSync(process.env.OUT + '/ids.json', JSON.stringify({ createId: c.createId, renameId: c.renameId, pid: c.pid }));
console.log(JSON.stringify({ createId: c.createId.slice(0, 8) + '…', renameId: c.renameId.slice(0, 8) + '…', pid: c.pid }));
