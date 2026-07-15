#!/usr/bin/env python3
"""Cat-O-Fit Lasttest: paralleler Mix aus Write/Read/Backup/Import gegen die PHP-API,
   plus Datenintegritäts-Prüfungen. Reine stdlib. Gibt eine Auswertungstabelle aus.
   Aufruf: loadtest.py <BASE_URL> <DATA_DIR> [NUSERS WRITES READS BACKUPS IMPORTS IMPORT_RECS CONCURRENCY]"""
import urllib.request, json, time, threading, statistics, sys, os, glob, random
from concurrent.futures import ThreadPoolExecutor

BASE        = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8078/api/api.php"
DATA_DIR    = sys.argv[2] if len(sys.argv) > 2 else "scratch/lt-app/data"
NUSERS      = int(sys.argv[3]) if len(sys.argv) > 3 else 10
WRITES      = int(sys.argv[4]) if len(sys.argv) > 4 else 60    # einzelne Upserts/Nutzer (sessions)
READS       = int(sys.argv[5]) if len(sys.argv) > 5 else 25    # changes-Lesungen/Nutzer
BACKUPS     = int(sys.argv[6]) if len(sys.argv) > 6 else 3     # Voll-Backups/Nutzer (alle Areas)
IMPORTS     = int(sys.argv[7]) if len(sys.argv) > 7 else 2     # Importe/Nutzer (health replace)
IMPORT_RECS = int(sys.argv[8]) if len(sys.argv) > 8 else 50    # Datensätze pro Import
CONCURRENCY = int(sys.argv[9]) if len(sys.argv) > 9 else 40    # parallele Anfragen

USER_AREAS = ['profile','events','plans','sessions','health','nutrition','diary','shopping','checklist','cycle','reports']

def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={'Content-Type':'application/json','Accept':'application/json'})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            pl = json.loads(resp.read().decode() or 'null')
            return True, (time.perf_counter()-t0)*1000, pl
    except Exception as e:
        return False, (time.perf_counter()-t0)*1000, str(e)

metrics = {}; mlock = threading.Lock()
def record(typ, ok, ms):
    with mlock: metrics.setdefault(typ, []).append((ok, ms))

users = [f"u-load-{i:02d}" for i in range(1, NUSERS+1)]

# ---- Phase 0: Familie mit NUSERS Mitgliedern anlegen ----
member_ops = [{"op":"upsert","record":{"id":u,"_kind":"member","name":f"User{i:02d}",
               "role":"user","emoji":"🏃","color":"#3d8bff","createdAt":"2026-06-30T00:00:00Z"}}
              for i,u in enumerate(users,1)]
ok, ms, pl = req("POST", f"{BASE}?area=family&scope=family&action=ops", {"ops": member_ops})
if not (ok and isinstance(pl,dict) and pl.get("ok")):
    print("FEHLER: Mitglieder anlegen fehlgeschlagen:", pl); sys.exit(1)

# ---- Workload-Tasks ----
write_revs = {u: [] for u in users}; wr_lock = threading.Lock()
def do_write(u, n):
    rid = f"s-{u}-{n:04d}"
    ok, ms, pl = req("POST", f"{BASE}?area=sessions&user={u}&action=ops",
                     {"ops":[{"op":"upsert","record":{"id":rid,"date":"2026-06-15","type":"easy","distanceKm":8,"durationSec":2400,"rpe":4}}]})
    good = ok and isinstance(pl,dict) and pl.get("ok")
    if good:
        with wr_lock: write_revs[u].append(pl.get("rev"))
    record("write", good, ms)
def do_read(u):
    ok, ms, pl = req("GET", f"{BASE}?area=sessions&user={u}&action=changes&since=0")
    record("read", ok and isinstance(pl,dict) and pl.get("ok"), ms)
def do_backup(u):
    t0 = time.perf_counter(); allok = True
    for a in USER_AREAS:
        ok, ms, pl = req("GET", f"{BASE}?area={a}&user={u}")
        allok = allok and ok and isinstance(pl,dict) and pl.get("ok")
    record("backup", allok, (time.perf_counter()-t0)*1000)
def do_import(u, n):
    recs = [{"id":f"h-{u}-{n}-{k:03d}","date":"2026-06-15","weight":round(70+k*0.01,2),"restingHr":55} for k in range(IMPORT_RECS)]
    ok, ms, pl = req("POST", f"{BASE}?area=health&user={u}&action=ops", {"ops":[{"op":"replace","records":recs}]})
    record("import", ok and isinstance(pl,dict) and pl.get("ok"), ms)

tasks = []
for u in users:
    tasks += [(do_write,(u,n)) for n in range(WRITES)]
    tasks += [(do_read,(u,)) for _ in range(READS)]
    tasks += [(do_backup,(u,)) for _ in range(BACKUPS)]
    tasks += [(do_import,(u,n)) for n in range(IMPORTS)]
random.shuffle(tasks)

print(f"… {len(tasks)} Tasks, {NUSERS} Nutzer, Parallelität {CONCURRENCY} gegen {BASE}")
t_start = time.perf_counter()
with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
    for f in [ex.submit(fn,*a) for fn,a in tasks]: f.result()
wall = time.perf_counter() - t_start

# ---- Phase 2: Integrität ----
integ = []
counts_ok = 0
for u in users:
    ok, ms, pl = req("GET", f"{BASE}?area=sessions&user={u}")
    d = pl.get("data") if ok and isinstance(pl,dict) else None
    n = len(d) if isinstance(d,(list,dict)) else -1
    if n == WRITES: counts_ok += 1
integ.append(("Schreib-Integrität – alle Upserts persistiert", f"{counts_ok}/{NUSERS} Nutzer = {WRITES}", counts_ok==NUSERS))

rev_ok = sum(1 for u in users if len(write_revs[u])==len(set(write_revs[u])) and all(r is not None for r in write_revs[u]))
integ.append(("Rev eindeutig – keine verlorenen Updates", f"{rev_ok}/{NUSERS} Nutzer eindeutig", rev_ok==NUSERS))

nfiles=0; bad=0
for fp in glob.glob(os.path.join(DATA_DIR,"**","*.json"), recursive=True):
    nfiles+=1
    try: json.load(open(fp))
    except Exception: bad+=1
integ.append(("JSON-Integrität auf Platte", f"{nfiles-bad}/{nfiles} Dateien valide", bad==0))

def ids(u):
    ok,ms,pl = req("GET", f"{BASE}?area=sessions&user={u}")
    d = pl.get("data") if ok and isinstance(pl,dict) else []
    return {r.get("id") for r in d} if isinstance(d,list) else set()
overlap = ids(users[0]) & ids(users[1]) if NUSERS>=2 else set()
integ.append(("Nutzer-Isolation – keine fremden Datensätze", "kein Überlapp" if not overlap else f"{len(overlap)} Überlapp!", not overlap))

imp_ok=0
for u in users:
    ok,ms,pl = req("GET", f"{BASE}?area=health&user={u}")
    d = pl.get("data") if ok and isinstance(pl,dict) else None
    if isinstance(d,list) and len(d)==IMPORT_RECS: imp_ok+=1
integ.append((f"Import-Integrität – health == {IMPORT_RECS}", f"{imp_ok}/{NUSERS} korrekt", imp_ok==NUSERS))

# ---- Phase 3: Auswertung ----
def st(typ):
    rows = metrics.get(typ, []); n=len(rows); okc=sum(1 for ok,_ in rows if ok)
    lat=sorted(ms for _,ms in rows); pct=lambda q: lat[min(len(lat)-1,int(q*len(lat)))] if lat else 0
    return n, okc, n-okc, (statistics.mean(lat) if lat else 0), pct(.5), pct(.95), (max(lat) if lat else 0)

total = sum(len(v) for v in metrics.values()); total_err = sum(1 for v in metrics.values() for ok,_ in v if not ok)
def line(): print("+"+"-"*22+"+"+"-"*8+"+"+"-"*8+"+"+"-"*7+"+"+"-"*9+"+"+"-"*9+"+"+"-"*9+"+")
print("\n=== PERFORMANCE (Latenz in ms) ===")
line(); print(f"| {'Operation':20} | {'Anfr.':>6} | {'OK':>6} | {'Fehl':>5} | {'Ø ms':>7} | {'p50':>7} | {'p95':>7} |"); line()
for typ,label in [("write","Write (upsert)"),("read","Read (changes)"),("backup","Backup (11 Areas)"),("import",f"Import (replace {IMPORT_RECS})")]:
    n,okc,err,avg,p50,p95,mx = st(typ)
    print(f"| {label:20} | {n:>6} | {okc:>6} | {err:>5} | {avg:>7.1f} | {p50:>7.1f} | {p95:>7.1f} |")
line()
print(f"\nGesamt: {total} Anfragen in {wall:.2f}s  ·  {total/wall:.0f} req/s  ·  {total_err} Fehler  ·  {CONCURRENCY} parallel, 8 PHP-Worker")

print("\n=== DATENINTEGRITÄT ===")
allpass=True
print("+"+"-"*48+"+"+"-"*26+"+"+"-"*8+"+")
print(f"| {'Prüfung':46} | {'Ergebnis':24} | {'Status':6} |")
print("+"+"-"*48+"+"+"-"*26+"+"+"-"*8+"+")
for name,res,ok in integ:
    allpass = allpass and ok
    print(f"| {name:46} | {res:24} | {('✓ OK' if ok else '✗ FAIL'):6} |")
print("+"+"-"*48+"+"+"-"*26+"+"+"-"*8+"+")

# Maschinenlesbares Fazit (letzte Zeile)
usable = (total_err==0) and allpass and (st('write')[5] < 1000)  # p95 write < 1s als „benutzbar"
print(f"\nFAZIT: Integrität {'BESTANDEN' if allpass else 'FEHLGESCHLAGEN'} · "
      f"Fehlerquote {100*total_err/max(total,1):.2f}% · "
      f"Write-p95 {st('write')[5]:.0f}ms · "
      f"Nutzbarkeit: {'GUT ✓' if usable else 'PRÜFEN ✗'}")
sys.exit(0 if (allpass and total_err==0) else 2)
