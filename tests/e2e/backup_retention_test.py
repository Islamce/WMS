#!/usr/bin/env python3
"""Offsite-backup helper scripts: backup-select.js (deterministic set choice)
and backup-retention.js (safe local retention). Pure-filesystem — no server
needed. Runs in Phase 3.

Covers: manifest-to-file selection; rejection of unrelated/historical files;
missing db; missing manifest; malformed manifest; attachments present/absent;
retention keeps newest N; retention never deletes the newest; logical-set
deletion; dry-run deletes nothing."""
import json, os, subprocess, sys, tempfile, shutil, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
passed = failed = 0
fails = []

def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print("PASS:", name)
    else: failed += 1; fails.append(name); print("FAIL:", name, detail)

def node(script, *args):
    return subprocess.run(['node', script, *args], cwd=ROOT, capture_output=True, text=True)

def make_set(d, stamp, with_attach=False, db_bytes=b'SQLite format 3\x00rest', break_manifest=None):
    """Create a backup set (db + manifest [+ attachments]) with a valid checksum."""
    dbname = f'wms-{stamp}.db'
    with open(os.path.join(d, dbname), 'wb') as f: f.write(db_bytes)
    sha = hashlib.sha256(db_bytes).hexdigest()
    man = {'created_at': '2026-07-20T00:00:00.000Z', 'app_version': '1.0.0',
           'db_file': dbname, 'db_bytes': len(db_bytes), 'db_sha256': sha,
           'attachments_dir': None, 'attachment_count': 0, 'attachments_sha256': None}
    if with_attach:
        adir = f'attachments-{stamp}'
        os.makedirs(os.path.join(d, adir, 'demo'), exist_ok=True)
        with open(os.path.join(d, adir, 'demo', 'f.txt'), 'w') as f: f.write('x')
        man.update({'attachments_dir': adir, 'attachment_count': 1, 'attachments_sha256': 'a'*64})
    if break_manifest == 'json':
        with open(os.path.join(d, f'wms-{stamp}.manifest.json'), 'w') as f: f.write('{not json')
        return
    if break_manifest == 'missing_db':
        os.remove(os.path.join(d, dbname))
    with open(os.path.join(d, f'wms-{stamp}.manifest.json'), 'w') as f: json.dump(man, f)

# ===== backup-select.js =====
d = tempfile.mkdtemp(prefix='sel-')
try:
    make_set(d, '20260720100000')
    r = node('scripts/backup-select.js', d, '--json')
    check('select: single valid set resolved', r.returncode == 0 and '"stamp": "20260720100000"'.replace(' ','') in r.stdout.replace(' ',''), (r.returncode, r.stdout, r.stderr))

    # add a second, older set — now ambiguous without --manifest
    make_set(d, '20260719090000')
    r = node('scripts/backup-select.js', d, '--json')
    check('select: ambiguous (2 manifests) fails without --manifest', r.returncode != 0, r.stdout)
    # with --manifest we deterministically pick the NEW one, not by mtime
    r = node('scripts/backup-select.js', d, '--manifest', 'wms-20260720100000.manifest.json', '--json')
    ok = r.returncode == 0 and json.loads(r.stdout)['stamp'] == '20260720100000'
    check('select: --manifest picks the exact set (not historical)', ok, (r.returncode, r.stdout))
finally:
    shutil.rmtree(d, ignore_errors=True)

# missing db / malformed manifest
for scenario, setup in [('missing db file', lambda dd: make_set(dd, '20260720110000', break_manifest='missing_db')),
                        ('malformed manifest', lambda dd: make_set(dd, '20260720110000', break_manifest='json'))]:
    d = tempfile.mkdtemp(prefix='sel-')
    try:
        setup(d)
        r = node('scripts/backup-select.js', d, '--json')
        check(f'select: fails on {scenario}', r.returncode != 0, (r.returncode, r.stdout, r.stderr))
    finally:
        shutil.rmtree(d, ignore_errors=True)

# missing manifest entirely
d = tempfile.mkdtemp(prefix='sel-')
try:
    with open(os.path.join(d, 'wms-20260720120000.db'), 'wb') as f: f.write(b'x')
    r = node('scripts/backup-select.js', d, '--json')
    check('select: fails when no manifest present', r.returncode != 0, r.stdout)
finally:
    shutil.rmtree(d, ignore_errors=True)

# attachments present
d = tempfile.mkdtemp(prefix='sel-')
try:
    make_set(d, '20260720130000', with_attach=True)
    r = node('scripts/backup-select.js', d, '--json')
    ok = r.returncode == 0 and json.loads(r.stdout)['attachments_dir'] == 'attachments-20260720130000'
    check('select: attachments set resolves attachments_dir', ok, (r.returncode, r.stdout))
finally:
    shutil.rmtree(d, ignore_errors=True)

# ===== path-traversal / injection safety on manifest values =====
def make_evil_manifest(d, stamp, db_file):
    """A manifest whose db_file points outside the set (traversal attempt)."""
    man = {'created_at': '2026-07-20T00:00:00.000Z', 'app_version': '1.0.0',
           'db_file': db_file, 'db_bytes': 1, 'db_sha256': 'a'*64,
           'attachments_dir': None, 'attachment_count': 0, 'attachments_sha256': None}
    with open(os.path.join(d, f'wms-{stamp}.manifest.json'), 'w') as f: json.dump(man, f)

for label, evil in [('parent-relative db_file', '../evil.db'),
                    ('absolute db_file', '/etc/passwd'),
                    ('nested path db_file', 'sub/evil.db'),
                    ('backslash db_file', '..\\evil.db')]:
    d = tempfile.mkdtemp(prefix='evil-')
    try:
        # also drop a real file the traversal might target, to prove it is NOT used
        with open(os.path.join(os.path.dirname(d), 'evil.db'), 'wb') as f: f.write(b'x')
        make_evil_manifest(d, '20260720140000', evil)
        r = node('scripts/backup-select.js', d, '--manifest', 'wms-20260720140000.manifest.json', '--json')
        check(f'select: rejects {label}', r.returncode != 0, (r.returncode, r.stdout, r.stderr))
    finally:
        shutil.rmtree(d, ignore_errors=True)
        try: os.remove(os.path.join(os.path.dirname(d), 'evil.db'))
        except OSError: pass

# malformed attachment path in manifest
d = tempfile.mkdtemp(prefix='evil-')
try:
    dbn = 'wms-20260720150000.db'
    with open(os.path.join(d, dbn), 'wb') as f: f.write(b'x')
    man = {'db_file': dbn, 'db_bytes': 1, 'db_sha256': 'a'*64,
           'attachments_dir': '../../etc', 'attachment_count': 1, 'attachments_sha256': 'b'*64,
           'created_at': 'x', 'app_version': '1.0.0'}
    with open(os.path.join(d, 'wms-20260720150000.manifest.json'), 'w') as f: json.dump(man, f)
    r = node('scripts/backup-select.js', d, '--manifest', 'wms-20260720150000.manifest.json', '--json')
    check('select: rejects malformed attachments_dir (traversal)', r.returncode != 0, (r.returncode, r.stdout))
finally:
    shutil.rmtree(d, ignore_errors=True)

# retention must not delete through a symlink escape
d = tempfile.mkdtemp(prefix='ret-sym-')
outside = tempfile.mkdtemp(prefix='outside-')
try:
    with open(os.path.join(outside, 'precious.txt'), 'w') as f: f.write('do not delete')
    # 8 valid newer sets so the symlinked "set" would be a deletion candidate
    for s in [f'2026072016{ i:02d}00' for i in range(8)]: make_set(d, s)
    # craft an older set whose attachments dir is a symlink to 'outside'
    make_set(d, '20260720000000')
    os.remove(os.path.join(d, 'wms-20260720000000.db'))  # invalidate normal parts…
    # actually create a proper-looking older valid set, then replace attachments with symlink
    make_set(d, '20260715000000', with_attach=True)
    shutil.rmtree(os.path.join(d, 'attachments-20260715000000'))
    os.symlink(outside, os.path.join(d, 'attachments-20260715000000'))
    r = node('scripts/backup-retention.js', d, '--keep', '7')
    check('retention: does not delete through a symlink escape', os.path.exists(os.path.join(outside, 'precious.txt')), r.stdout[-300:])
finally:
    shutil.rmtree(d, ignore_errors=True)
    shutil.rmtree(outside, ignore_errors=True)

# ===== backup-retention.js =====
def stamps_present(d):
    return sorted(s.split('wms-')[1].split('.db')[0] for s in os.listdir(d) if s.endswith('.db'))

# keep newest 7 out of 10
d = tempfile.mkdtemp(prefix='ret-')
try:
    all_stamps = [f'2026072000{ i:02d}00' for i in range(10)]  # 10 ascending stamps
    for s in all_stamps: make_set(d, s)
    r = node('scripts/backup-retention.js', d, '--keep', '7')
    remaining = stamps_present(d)
    check('retention: keeps exactly newest 7 sets', len(remaining) == 7 and remaining == sorted(all_stamps)[-7:], (r.returncode, remaining))
    check('retention: newest set retained', sorted(all_stamps)[-1] in remaining, remaining)
    # manifest + db deleted together (no orphan manifests)
    orphan = [f for f in os.listdir(d) if f.endswith('.manifest.json') and f.replace('.manifest.json','.db') not in os.listdir(d)]
    check('retention: deletes sets as a unit (no orphan manifest/db)', orphan == [], orphan)
finally:
    shutil.rmtree(d, ignore_errors=True)

# dry-run deletes nothing
d = tempfile.mkdtemp(prefix='ret-')
try:
    for s in [f'2026072001{ i:02d}00' for i in range(9)]: make_set(d, s)
    before = stamps_present(d)
    r = node('scripts/backup-retention.js', d, '--keep', '7', '--dry-run')
    check('retention: --dry-run deletes nothing', stamps_present(d) == before and r.returncode == 0, (r.returncode, len(before)))
    check('retention: --dry-run reports candidates', 'DRYRUN' in r.stdout, r.stdout[-200:])
finally:
    shutil.rmtree(d, ignore_errors=True)

# never delete the newest even with --keep 0; invalid set left untouched
d = tempfile.mkdtemp(prefix='ret-')
try:
    make_set(d, '20260720020000')          # valid newest
    make_set(d, '20260720010000', break_manifest='json')  # invalid older
    r = node('scripts/backup-retention.js', d, '--keep', '0')
    present = stamps_present(d)
    check('retention: --keep 0 still keeps newest valid set', '20260720020000' in present, present)
    check('retention: invalid set is not deleted', '20260720010000' in present, present)
finally:
    shutil.rmtree(d, ignore_errors=True)

# logical-set deletion includes attachments dir
d = tempfile.mkdtemp(prefix='ret-')
try:
    make_set(d, '20260720030000', with_attach=True)  # older, with attachments
    for s in [f'2026072004{ i:02d}00' for i in range(7)]: make_set(d, s)  # 7 newer valid sets
    r = node('scripts/backup-retention.js', d, '--keep', '7')
    check('retention: attachments dir removed with its set', not os.path.exists(os.path.join(d, 'attachments-20260720030000')), os.listdir(d))
finally:
    shutil.rmtree(d, ignore_errors=True)

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails: print("Failed:", fails)
sys.exit(1 if failed else 0)
