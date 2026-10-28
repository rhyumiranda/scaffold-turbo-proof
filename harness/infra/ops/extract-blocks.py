# Extract fenced shell blocks from the operations docs into numbered files. Usage: extract-blocks.py REPO OUTDIR
import glob, os, sys
root, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
files = ['docs/operations.md', 'AGENTS.md'] + sorted(glob.glob(root + '/apps/*/AGENTS.md')) + sorted(glob.glob(root + '/apps/*/docs/**/*.md', recursive=True))
files = [os.path.relpath(f, root) if os.path.isabs(f) else f for f in files]
n = 0
index = open(out + '/index.tsv', 'w')
for f in files:
    lines = open(os.path.join(root, f)).read().split('\n')
    i, prev = 0, ''
    while i < len(lines):
        l = lines[i]
        if l.startswith('```'):
            lang = l[3:].strip(); j = i + 1; body = []
            while j < len(lines) and not lines[j].startswith('```'):
                body.append(lines[j]); j += 1
            n += 1
            target = prev.startswith('**target**')
            shell = lang in ('bash', 'sh', 'shell', '')
            open('%s/%02d.sh' % (out, n), 'w').write('\n'.join(body) + '\n')
            index.write('%02d\t%s\t%d\t%s\t%s\t%s\n' % (n, f, i + 1, lang or '-', 'target' if target else 'local', 'shell' if shell else 'other'))
            i = j + 1
            continue
        if l.strip(): prev = l
        i += 1
index.close()
