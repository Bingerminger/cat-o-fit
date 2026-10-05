#!/usr/bin/env python3
"""Cat-O-Fit sustained load (soak): DURATION s at CONCURRENCY in parallel, mixed workload,
   write cap per user. Measures latency per 10 s window (degradation through growing JSON
   files) + data integrity. stdlib only.
   Call: loadtest_soak.py <BASE> <DATA_DIR> [NUSERS MAXW CONCURRENCY DURATION IMPORT_RECS]"""
import urllib.request, json, time, threading, statistics, sys, os, glob, random
from concurrent.futures import ThreadPoolExecutor

BASE        = sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8078/api/api.php"
DATA_DIR    = sys.argv[2] if len(sys.argv)>2 else "scratch/lt-app/data"
NUSERS      = int(sys.argv[3]) if len(sys.argv)>3 else 10
MAXW        = int(sys.argv[4]) if len(sys.argv)>4 else 5000
CONCURRENCY = int(sys.argv[5]) if len(sys.argv)>5 else 500
DURATION    = float(sys.argv[6]) if len(sys.argv)>6 else 60.0
IMPORT_RECS = int(sys.argv[7]) if len(sys.argv)>7 else 100
BUCKET      = 10.0

USER_AREAS = ['profile','events','plans','sessions','health','nutrition','diary','shopping','checklist','cycle','reports','labs','supplements']
def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={'Content-Type':'application/json','Accept':'application/json'})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return True, (time.perf_counter()-t0)*1000, json.loads(resp.read().decode() or 'null')
    except Exception as e:
        return False, (time.perf_counter()-t0)*1000, str(e)

users = [f"u-load-{i:02d}" for i in range(1,NUSERS+1)]
mops = [{"op":"upsert","record":{"id":u,"_kind":"member","name":f"User{i:02d}","role":"user","createdAt":"2026-06-30T00:00:00Z"}} for i,u in enumerate(users,1)]
ok,ms,pl = req("POST", f"{BASE}?area=family&scope=family&action=ops", {"ops":mops})
if not (ok and isinstance(pl,dict) and pl.get("ok")): print("ERROR members:", pl); sys.exit(1)

widx={u:0 for u in users}; wl={u:threading.Lock() for u in users}
def nextw(u):
    with wl[u]:
        if widx[u]>=MAXW: return None
        n=widx[u]; widx[u]+=1; return n
metrics={}; mlk=threading.Lock()
def rec(t,ok,ms,b):
    with mlk: metrics.setdefault(t,[]).append((ok,ms,b))
succ={u:0 for u in users}; sl=threading.Lock()
# Written IDs instead of a counter sum: a request that fails on the client side
# (timeout) may still have arrived at the server – it then counts as "sent".
sent={u:set() for u in users}; okids={u:set() for u in users}
revs={u:set() for u in users}; rl=threading.Lock()
start=time.perf_counter(); deadline=start+DURATION
def bk(): return int((time.perf_counter()-start)//BUCKET)

def op_write(u):
    n=nextw(u)
    if n is None: return op_read(u)
    sid=f"s-{u}-{n:05d}"
    with sl: sent[u].add(sid)
    ok,ms,pl=req("POST", f"{BASE}?area=sessions&user={u}&action=ops", {"ops":[{"op":"upsert","record":{"id":sid,"date":"2026-06-15","type":"easy","distanceKm":8,"durationSec":2400}}]})
    g=ok and isinstance(pl,dict) and pl.get("ok")
    if g:
        with sl: succ[u]+=1; okids[u].add(sid)
        with rl: revs[u].add(pl.get("rev"))
    rec("write",g,ms,bk())
def op_read(u):
    ok,ms,pl=req("GET", f"{BASE}?area=sessions&user={u}&action=changes&since=0"); rec("read",ok and isinstance(pl,dict) and pl.get("ok"),ms,bk())
def op_backup(u):
    t0=time.perf_counter(); a_ok=True
    for a in USER_AREAS:
        ok,ms,pl=req("GET", f"{BASE}?area={a}&user={u}"); a_ok=a_ok and ok and isinstance(pl,dict) and pl.get("ok")
    rec("backup",a_ok,(time.perf_counter()-t0)*1000,bk())
def op_import(u):
    recs=[{"id":f"h-{u}-{k:03d}","date":"2026-06-15","weight":round(70+k*0.01,2)} for k in range(IMPORT_RECS)]
    ok,ms,pl=req("POST", f"{BASE}?area=health&user={u}&action=ops", {"ops":[{"op":"replace","records":recs}]}); rec("import",ok and isinstance(pl,dict) and pl.get("ok"),ms,bk())

def worker():
    while time.perf_counter()<deadline:
        u=random.choice(users); r=random.random()
        if r<0.75: op_write(u)
        elif r<0.92: op_read(u)
        elif r<0.96: op_import(u)
        else: op_backup(u)

print(f"… soak run {DURATION:.0f}s · {CONCURRENCY} parallel · write cap {MAXW}/user · 8 PHP workers")
with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
    for f in [ex.submit(worker) for _ in range(CONCURRENCY)]: f.result()
wall=time.perf_counter()-start

# Integrity
integ=[]
cok=0
for u in users:
    ok,ms,pl=req("GET", f"{BASE}?area=sessions&user={u}")
    d=pl.get("data") if ok and isinstance(pl,dict) else None
    ids={r.get("id") for r in d} if isinstance(d,list) else None
    # Every confirmed ID is on the server, and nothing is there that was never sent.
    if ids is not None and okids[u] <= ids <= sent[u]: cok+=1
integ.append(("Write integrity – confirmed ⊆ server ⊆ sent", f"{cok}/{NUSERS} users exact", cok==NUSERS))
rok=sum(1 for u in users if len(revs[u])==succ[u])
integ.append(("Rev unique – no lost updates", f"{rok}/{NUSERS} unique", rok==NUSERS))
nf=0;bad=0
for fp in glob.glob(os.path.join(DATA_DIR,"**","*.json"),recursive=True):
    nf+=1
    try: json.load(open(fp))
    except Exception: bad+=1
integ.append(("JSON integrity on disk", f"{nf-bad}/{nf} valid", bad==0))
def sids(u):
    ok,ms,pl=req("GET", f"{BASE}?area=sessions&user={u}"); d=pl.get("data") if ok and isinstance(pl,dict) else []
    return {r.get("id") for r in d} if isinstance(d,list) else set()
ov=sids(users[0])&sids(users[1])
integ.append(("User isolation", "no overlap" if not ov else f"{len(ov)} overlap!", not ov))
hok=0
for u in users:
    ok,ms,pl=req("GET", f"{BASE}?area=health&user={u}"); d=pl.get("data") if ok and isinstance(pl,dict) else None
    n=len(d) if isinstance(d,list) else -1
    if n in (0,IMPORT_RECS): hok+=1
integ.append((f"Import integrity – health ∈ {{0,{IMPORT_RECS}}}", f"{hok}/{NUSERS} valid", hok==NUSERS))

def stx(t):
    rows=metrics.get(t,[]); n=len(rows); okc=sum(1 for ok,_,_ in rows if ok); lat=sorted(ms for _,ms,_ in rows)
    pct=lambda q: lat[min(len(lat)-1,int(q*len(lat)))] if lat else 0
    return n,okc,n-okc,(statistics.mean(lat) if lat else 0),pct(.5),pct(.95)
tot=sum(len(v) for v in metrics.values()); terr=sum(1 for v in metrics.values() for ok,_,_ in v if not ok)
totw=sum(succ.values())
print("\n=== PERFORMANCE (latency ms) ===")
L=lambda: print("+"+"-"*22+"+"+"-"*8+"+"+"-"*8+"+"+"-"*7+"+"+"-"*9+"+"+"-"*9+"+")
L(); print(f"| {'Operation':20} | {'Reqs':>6} | {'OK':>6} | {'Err':>5} | {'avg ms':>7} | {'p95':>7} |"); L()
for t,lab in [("write","Write (upsert)"),("read","Read (changes)"),("backup","Backup (11 Areas)"),("import",f"Import ({IMPORT_RECS})")]:
    n,okc,err,avg,p50,p95=stx(t); print(f"| {lab:20} | {n:>6} | {okc:>6} | {err:>5} | {avg:>7.1f} | {p95:>7.1f} |")
L()
print(f"\nTotal: {tot} requests · {totw} writes in {wall:.1f}s · {tot/wall:.0f} req/s · {terr} errors")

# Write latency per time window (degradation through file growth?)
print("\n=== WRITE LATENCY PER 10 s WINDOW (p95) ===")
wrows=metrics.get("write",[]); nb=int(DURATION//BUCKET)+1
print("+"+"-"*9+"+"+"-"*9+"+"+"-"*10+"+")
print(f"| {'Window':7} | {'Writes':>7} | {'p95 ms':>8} |")
print("+"+"-"*9+"+"+"-"*9+"+"+"-"*10+"+")
for b in range(nb):
    lat=sorted(ms for _,ms,bb in wrows if bb==b)
    if not lat: continue
    p95=lat[min(len(lat)-1,int(.95*len(lat)))]
    print(f"| {b*10:>3}-{b*10+10:<3} | {len(lat):>7} | {p95:>8.1f} |")
print("+"+"-"*9+"+"+"-"*9+"+"+"-"*10+"+")

print("\n=== DATA INTEGRITY ===")
ap=True
print("+"+"-"*52+"+"+"-"*24+"+"+"-"*8+"+")
print(f"| {'Check':50} | {'Result':22} | {'Status':6} |")
print("+"+"-"*52+"+"+"-"*24+"+"+"-"*8+"+")
for name,res,ok in integ:
    ap=ap and ok; print(f"| {name:50} | {res:22} | {('✓ OK' if ok else '✗ FAIL'):6} |")
print("+"+"-"*52+"+"+"-"*24+"+"+"-"*8+"+")
sz=sum(os.path.getsize(fp) for fp in glob.glob(os.path.join(DATA_DIR,'**','*.json'),recursive=True))/1e6
print(f"\nVERDICT: integrity {'PASSED' if ap else 'FAILED'} · error rate {100*terr/max(tot,1):.2f}% · "
      f"write p95 {stx('write')[5]:.0f}ms · data {sz:.1f}MB · usability: {'GOOD ✓' if (terr==0 and ap and stx('write')[5]<2000) else 'CHECK ✗'}")
sys.exit(0 if (ap and terr==0) else 2)
