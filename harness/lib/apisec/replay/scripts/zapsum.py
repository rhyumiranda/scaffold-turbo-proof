import json,sys
d=json.load(open(sys.argv[1]))
for s in d['site']:
    print(s['@name'])
    for a in s['alerts']:
        ev=[i.get('evidence','')[:70].replace('\n',' ') for i in a['instances'][:2]]
        print('  ',a['riskdesc'],'|',a['name'],'|',a['count'],'inst |', ev if a['riskcode'] in('2','3') else '')
