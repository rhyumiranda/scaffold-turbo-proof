import json,sys,collections,re
# usage: logsum.py LOG [OFFSET_BYTES]  -> request.complete lines with status >= 500, grouped by method + route class
f=sys.argv[1]; off=int(sys.argv[2]) if len(sys.argv)>2 else 0
data=open(f,'rb').read()[off:].decode('utf8','replace')
tot=0; c=collections.Counter(); ex={}
st=collections.Counter()
for l in data.splitlines():
    try: d=json.loads(l)
    except Exception: continue
    if d.get('event')!='request.complete': continue
    tot+=1; st[d['status']//100]+=1
    if d['status']>=500:
        r=d['route']; k=(d['method'], d['status'], re.sub(r'[0-9a-f-]{36}','<uuid>',r)[:60])
        c[k]+=1; ex.setdefault(k,r[:100])
print('request.complete lines:',tot,'by class:',dict(st))
for k,v in sorted(c.items(), key=lambda x:-x[1]): print(v,k)
