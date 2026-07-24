#!/usr/bin/env python3
import json, urllib.request, urllib.error, os, sys
B='http://localhost:3000'
os.environ['no_proxy']='localhost,127.0.0.1'
passed=failed=0
fails=[]

def call(method,path,token=None,body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(B+path,data=data,method=method)
    req.add_header('Content-Type','application/json')
    if token: req.add_header('Authorization','Bearer '+token)
    try:
        r=urllib.request.urlopen(req)
        return r.getcode(),json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try:return e.code,json.loads(e.read() or '{}')
        except:return e.code,{}

def check(name,cond,detail=''):
    global passed,failed
    if cond: passed+=1; print('PASS:',name)
    else: failed+=1; fails.append(name); print('FAIL:',name,detail)

def login(email,pw):
    _,r=call('POST','/api/auth/login',body={'email':email,'password':pw})
    return r.get('token')

admin=login('admin@example.com','Admin@123456')
check('admin login',bool(admin))

# representative attached-file layouts
rows=[
 {'ID':'OUT-1','item':'MAT-001','Plant':'P101','Description':'Issue row','Unit':'EA','Bin Location':'A-01','Quantity':'5','last update':'24/07/2026','user':'tester','Timestamp':'24/07/2026 10:15:00','reservation number':'RES-1'},
 {'ID':'OUT-2','item':'MAT-002','Plant':'P101','Description':'Issue row 2','Unit':'EA','Bin Location':'A-02','Quantity':'3','last update':'24/07/2026','user':'tester','Timestamp':'24/07/2026 10:16:00','reservation number':'RES-2'},
 {'ID':'BAD','item':'','Plant':'P101','Quantity':'0','last update':'bad-date'}
]
c,r=call('POST','/api/import/movements/chunk',admin,{'movement_type':'ISSUE','source_filename':'stock_out.csv','period_start':'2026-07-24','period_end':'2026-07-24','finalize':True,'rows':rows})
check('movement import accepts valid rows and isolates invalid row',c==200 and r.get('inserted')==2 and r.get('invalid')==1,r)

c,r=call('POST','/api/import/movements/chunk',admin,{'movement_type':'ISSUE','source_filename':'stock_out.csv','finalize':True,'rows':rows[:2]})
check('repeat import is idempotent',c==200 and r.get('inserted')==0 and r.get('duplicates')==2,r)

# 60k scale in 12 chunks without browser involvement
batch_id=None
total_inserted=0
for chunk_no in range(12):
    base=chunk_no*5000
    chunk=[]
    for i in range(5000):
        n=base+i
        chunk.append({'ID':f'LOAD-{n}','Item ':f'MAT-{n%250:03d}','Plant':'P101','Description':'Load row','Unit':'EA','Bin Location':f'B-{n%100:03d}','Quantity':'1','last update':'24/07/2026','user':'load','Timestamp':f'24/07/2026 12:{(n//60)%60:02d}:{n%60:02d}'})
    c,r=call('POST','/api/import/movements/chunk',admin,{'batch_id':batch_id,'movement_type':'RECEIPT','source_filename':'stock_in.csv','row_offset':base,'finalize':chunk_no==11,'rows':chunk})
    if c!=200:
        check(f'60k chunk {chunk_no+1}',False,(c,r)); break
    batch_id=r.get('batch_id'); total_inserted+=r.get('inserted',0)
else:
    check('60k movement rows imported in chunks',total_inserted==60000,total_inserted)

c,r=call('GET','/api/import/movements/summary',admin)
issue=next((x for x in r.get('totals',[]) if x.get('movement_type')=='ISSUE'),None)
receipt=next((x for x in r.get('totals',[]) if x.get('movement_type')=='RECEIPT'),None)
check('summary includes imported issue and receipt history',c==200 and issue and issue.get('rows')==2 and receipt and receipt.get('rows')==60000,r)

print(f'\n===== RESULT: {passed} passed, {failed} failed =====')
if fails: print('Failed:',fails)
sys.exit(1 if failed else 0)
