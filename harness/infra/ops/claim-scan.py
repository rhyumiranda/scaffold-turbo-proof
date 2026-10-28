# Protocol rule 5: no generated document or manifest may claim that any AC-97..AC-107 item is verified.
# Usage: claim-scan.py REPO. Prints every candidate line; exits 1 when an un-negated claim remains.
import glob, json, os, re, sys
root = sys.argv[1]
topics = r'deploy|deployment|identity provider|vendor|tls|ssl labs|proxy|replica|point-in-time|pitr|rpo|rto|managed backup|alert|on-call|capacity|signed|signing|provenance|attestation|branch protection|ruleset|secret store|rotation drill|core web vitals|rum\b|real[- ]user|production'
claims = r'\b(verified|proven|proved|certified|passed|validated|confirmed|production-ready|deployment-ready|ssl labs grade [ab])\b'
negation = r'\b(not|no|never|unverified|until|without|cannot|can\'t|unresolved|must|remain|remains|before|require|requires|required|need|needs|if|unless|only|do not|does not|nothing|none|not_run|still|should|claim|evidence|target|ensure|prove)\b'
files = [f for f in glob.glob(root + '/**/*', recursive=True) if os.path.isfile(f) and '/node_modules/' not in f and '/.git/' not in f and '/.next/' not in f and '/dist/' not in f and f.endswith(('.md', '.json', '.yml', '.yaml', '.mjs', '.ts', '.tsx')) and not f.endswith(('pnpm-lock.yaml', 'openapi.json', 'accepted.openapi.json', 'api.d.ts'))]
cands, bad = 0, []
for f in sorted(files):
    for i, line in enumerate(open(f, errors='replace'), 1):
        l = line.strip()
        if re.search(claims, l, re.I) and re.search(topics, l, re.I):
            cands += 1
            neg = re.search(negation, l, re.I)
            print(('NEGATED/CONDITIONAL ' if neg else 'CLAIM? ') + '%s:%d: %s' % (os.path.relpath(f, root), i, l[:220]))
            if not neg: bad.append((f, i))
m = json.load(open(root + '/scaffold-manifest.json'))
def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items(): yield from walk(v, path + '/' + k)
    elif isinstance(o, str): yield path, o
statuses = [(p, v) for p, v in walk(m) if re.search(r'(status|deployment|authIntegration)$', p)]
for p, v in statuses:
    print('MANIFEST %s = %s' % (p, v))
    if re.search(r'verified$|passed|certified', v) and not re.search(r'unverified|not', v): bad.append((p, v))
print('candidates=%d unnegated=%d' % (cands, len(bad)))
sys.exit(1 if bad else 0)
