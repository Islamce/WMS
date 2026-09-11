#!/usr/bin/env python3
"""Subcontractor material requests — project management owns the quantity.

The contractor stated the authority split plainly: material is drawn on the
subcontractor's request, but the quantities are decided by project management
and design, not by the stores. Phase 1 made stock attributable to an owner; this
makes the *request* attributable to the subcontractor it is raised for, and
moves the quantity decision to the authority that actually owns it.

What this pins:

 1. A request can name the subcontractor it is raised for, validated against the
    register; an unknown or inactive one is refused.
 2. An ordinary company request is COMPLETELY unaffected — the manager who could
    approve one before still can. This is the regression guard: the new
    authority must not become a blanket approval tax.
 3. On a subcontractor request the same manager is refused, and the refusal names
    the authority that is missing rather than a bare "forbidden".
 4. The gate covers changing an approved quantity, not just the final decision.
    Quantity is the thing project management owns, so editing it is gated at the
    point of edit.
 5. Rejecting is NOT gated. Refusing to release material is never the direction
    that needs extra authority, and gating it would strand a request with nobody
    able to close it.

Requires a running server (started by tests/run.sh).
"""
import json, os, sys, urllib.error, urllib.request

B = "http://localhost:3000"
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), json.loads(r.read() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or '{}')
        except Exception:
            return e.code, {}


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print("PASS:", name)
    else:
        failed += 1
        fails.append(name)
        print("FAIL:", name, detail)


def login(email, pw):
    _, r = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return r.get('token')


admin = login('admin@example.com', 'Admin@123456')
manager = login('manager@example.com', 'Passw0rd!')
check('S0 admin logged in', bool(admin))
check('S0 manager logged in', bool(manager))

_, me = call('GET', '/api/auth/me', manager)
perms = (me.get('user') or me).get('permissions') or []
check('S0 manager holds approvals', 'approvals' in perms, perms)
check('S0 manager does NOT hold project_management_approval',
      'project_management_approval' not in perms, perms)

# Fixtures: a subcontractor, and a cheap material so the value-based approval
# matrix does not interfere with what this test is actually measuring.
c, sub = call('POST', '/api/subcontractor/subcontractors', admin,
              {'name': 'Request Test Contracting', 'trade_category': 'Blockwork'})
check('S0 subcontractor created', c == 201, (c, sub))
sub_id = sub.get('id')

_, mats = call('GET', '/api/materials?limit=5', admin)
rows = mats.get('materials', [])
check('S0 a material is available', len(rows) > 0, mats)
material_id = rows[0]['id']


def make_request(subcontractor_id=None):
    body = {'purpose': 'Authority split test', 'lines': [
        {'material_id': material_id, 'requested_quantity': 1}]}
    if subcontractor_id is not None:
        body['subcontractor_id'] = subcontractor_id
    return call('POST', '/api/requests', admin, body)


# ===== 1. Attribution is validated against the register =====
c, r = make_request(999999)
check('S1 an unknown subcontractor is refused', c == 404, (c, r))

c, plain = make_request()
check('S1 a company request needs no subcontractor', c == 201, (c, plain))
plain_id = plain.get('id')

c, attributed = make_request(sub_id)
check('S1 a subcontractor request is accepted', c == 201, (c, attributed))
attributed_id = attributed.get('id')

c, r = call('GET', f'/api/requests/{attributed_id}', admin)
check('S1 the subcontractor is recorded on the request',
      r.get('request', {}).get('subcontractor_id') == sub_id, r.get('request'))
check('S1 the name is snapshotted, not just the id',
      r.get('request', {}).get('subcontractor_name') == 'Request Test Contracting', r.get('request'))

c, r = call('GET', f'/api/requests?subcontractor_id={sub_id}', admin)
check('S1 requests are filterable by subcontractor',
      c == 200 and any(x['id'] == attributed_id for x in r.get('requests', [])), (c, r))

for rid in (plain_id, attributed_id):
    c, r = call('POST', f'/api/requests/{rid}/submit', admin, {})
    check(f'S1 request {rid} submitted', c == 200, (c, r))

# ===== 2. Regression guard: an ordinary request is unaffected =====
# If this fails, the new authority has become a tax on every approval.
c, r = call('POST', f'/api/approvals/{plain_id}/decision', manager,
            {'decision': 'approve', 'comments': 'Routine'})
check('S2 the manager still approves an ordinary request', c == 200, (c, r))

# ===== 3. The manager is refused on the subcontractor request =====
c, r = call('POST', f'/api/approvals/{attributed_id}/decision', manager,
            {'decision': 'approve', 'comments': 'Should not pass'})
check('S3 the manager cannot approve a subcontractor request', c == 403, (c, r))
check('S3 the refusal names the missing authority',
      r.get('required_permission') == 'project_management_approval', r)
check('S3 the refusal explains why, not just "forbidden"',
      'project management' in (r.get('error') or '').lower(), r)

# ===== 4. The gate covers editing the quantity, not only the decision =====
_, detail = call('GET', f'/api/requests/{attributed_id}', admin)
line_id = detail['lines'][0]['id']
c, r = call('PATCH', f'/api/approvals/{attributed_id}/lines/{line_id}', manager,
            {'approved_quantity': 5, 'reason': 'Should not pass'})
check('S4 the manager cannot change the approved quantity', c == 403, (c, r))
check('S4 that refusal names the authority too',
      r.get('required_permission') == 'project_management_approval', r)

# ===== 5. Rejection is deliberately NOT gated =====
c, r = call('POST', f'/api/approvals/{attributed_id}/decision', manager,
            {'decision': 'reject', 'reason': 'Not required on site this month'})
check('S5 the manager may still reject', c == 200, (c, r))

# ===== 6. The authority holder can approve =====
c, second = make_request(sub_id)
second_id = second.get('id')
call('POST', f'/api/requests/{second_id}/submit', admin, {})
c, r = call('PATCH', f'/api/approvals/{second_id}/lines/'
            + str(call('GET', f'/api/requests/{second_id}', admin)[1]['lines'][0]['id']),
            admin, {'approved_quantity': 2, 'reason': 'Project management quantity'})
check('S6 project management sets the quantity', c == 200, (c, r))
c, r = call('POST', f'/api/approvals/{second_id}/decision', admin,
            {'decision': 'approve', 'comments': 'Approved by project management'})
check('S6 project management approves', c == 200, (c, r))

print(f"\n===== RESULT: {passed} passed, {failed} failed =====")
if fails:
    print("Failed:", fails)
sys.exit(1 if failed else 0)
