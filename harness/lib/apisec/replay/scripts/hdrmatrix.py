import re,sys
t=open(sys.argv[1]).read().split('##### ')[1:]
for blk in t:
    path,_,rest=blk.partition('\n'); h={}
    lines=rest.splitlines() or ["(no response)"]; st=lines[0]
    for l in lines[1:]:
        if ':' in l: k,v=l.split(':',1); h[k.lower()]=v.strip()
    csp=h.get('content-security-policy','')
    ss=re.search(r"script-src[^;]*",csp)
    uns=bool(ss and re.search(r"'unsafe-(inline|eval)'",ss.group(0)))
    fa="frame-ancestors 'none'" in csp
    print("%-48s %-16s csp=%s nonce=%s unsafe_in_script_src=%s fa_none=%s nosniff=%s ref=%s hsts=%s xpb=%s ct=%s"%(path,st[:16],'Y' if csp else 'N','nonce-' in (ss.group(0) if ss else ''),uns,fa,h.get('x-content-type-options'),h.get('referrer-policy'),h.get('strict-transport-security'),h.get('x-powered-by'),h.get('content-type','')[:22]))
