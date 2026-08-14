#!/usr/bin/env python3
"""Controlled corrective-phase regressions for historical movement integrity."""
import datetime
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

B = 'http://localhost:3000'
DB = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'wms.db')
os.environ['no_proxy'] = 'localhost,127.0.0.1'
passed = failed = 0
fails = []

def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(B + path, data=data, method=method)
    request.add_header('Content-Type', 'application/json')
    if token:
        request.add_header('Authorization', 'Bearer ' + token)
    try:
        response = urllib.request.urlopen(request)
        return response.getcode(), json.loads(response.read() or '{}')
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or '{}')
        except Exception:
            return error.code, {}

def check(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        print('PASS:', name)
    else:
        failed += 1
        fails.append(name)
        print('FAIL:', name, detail)

def login(email, password):
    _, payload = call('POST', '/api/auth/login', body={'email': email, 'password': password})
    return payload.get('token')

def db_rows(sql, params=()):
    with sqlite3.connect(DB) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(sql, params).fetchall()]

def live_snapshot():
    return {
        'batches': db_rows('SELECT COUNT(*) rows, SUM(remaining_quantity) qty, SUM(reserved_quantity) reserved FROM batches')[0],
        'location_stock': db_rows('SELECT COUNT(*) rows, SUM(quantity) qty FROM material_location_stock')[0],
        'ledger': db_rows("SELECT COUNT(*) rows, SUM(CASE WHEN transaction_type='IN' THEN quantity ELSE -quantity END) qty FROM stock_transactions")[0],
    }

def iso(days_ago):
    return (datetime.date.today() - datetime.timedelta(days=days_ago)).isoformat()

admin = login('admin@example.com', 'Admin@123456')
check('admin login', bool(admin))

# Isolate coverage behavior from the seed's sample operational history. Live
# batch stock remains intact; this is a disposable test database only.
with sqlite3.connect(DB) as connection:
    connection.execute('DELETE FROM stock_transactions')

c, report = call('GET', '/api/analytics', admin)
stocked = [item for item in report.get('items', []) if item.get('current_stock', 0) > 0]
check('no movement evidence reports NONE coverage', c == 200 and report.get('coverage', {}).get('status') == 'NONE', report.get('coverage'))
check('stocked materials are UNKNOWN, never DEAD, with no history', stocked and all(item['classification'] == 'UNKNOWN' for item in stocked), stocked[:3])
check('coverage warning states absence is not proof', 'must not be interpreted' in (report.get('coverage', {}).get('warning') or ''), report.get('coverage'))

batch_columns = {row['name'] for row in db_rows('PRAGMA table_info(stock_movement_import_batches)')}
history_columns = {row['name'] for row in db_rows('PRAGMA table_info(stock_movement_history)')}
check('migration adds batch traceability fields', {'movement_category', 'source_system', 'source_file_checksum', 'field_mapping_json', 'reconciliation_json'} <= batch_columns, batch_columns)
check('migration adds canonical movement fields', {'material_id', 'movement_category', 'erp_movement_type', 'posting_date', 'document_date', 'storage_location', 'batch_number', 'erp_document_reference', 'purchase_order', 'cost_center', 'wbs_element', 'source_system', 'reversal_of_category'} <= history_columns, history_columns)

mapped_rows = [
    {'Material': 'MAT-0001', 'Qty': '10', 'Posting': iso(20), 'Document Date': iso(21),
     'ERP MvT': '201', 'SLoc': '0001', 'ERP Document': 'DOC-ISSUE-1', 'Cost Object': 'CC-TEST'},
    {'Material': '', 'Qty': '0', 'Posting': 'not-a-date'},
]
mapping = {'material_code': 'Material', 'quantity': 'Qty', 'posting_date': 'Posting',
           'document_date': 'Document Date', 'erp_movement_type': 'ERP MvT',
           'storage_location': 'SLoc', 'erp_document_reference': 'ERP Document',
           'cost_center': 'Cost Object'}
before_preview = live_snapshot()
c, preview = call('POST', '/api/import/movements/preview', admin, {
    'movement_category': 'ISSUE', 'source_system': 'SAP_ECC', 'source_filename': 'issues.csv',
    'source_file_checksum': 'sha256-test-issue', 'field_mapping': mapping, 'rows': mapped_rows,
})
check('mapped preview validates rows without writing', c == 200 and preview.get('mode') == 'DRY_RUN'
      and preview['reconciliation']['insertable_rows'] == 1 and preview['reconciliation']['invalid_rows'] == 1, preview)
check('preview exposes mapped ERP semantics', preview.get('preview', [{}])[0].get('erp_movement_type') == '201'
      and preview.get('preview', [{}])[0].get('storage_location') == '0001', preview.get('preview'))
check('preview proves live-stock invariant', before_preview == live_snapshot() and preview['reconciliation']['live_stock_changed'] is False, preview.get('reconciliation'))
check('preview creates no analytical rows', db_rows('SELECT COUNT(*) n FROM stock_movement_history')[0]['n'] == 0)

c, dry = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'ISSUE', 'dry_run': True, 'source_filename': 'issues.csv',
    'field_mapping': mapping, 'rows': mapped_rows[:1],
})
check('chunk dry_run is non-mutating', c == 200 and dry.get('mode') == 'DRY_RUN'
      and db_rows('SELECT COUNT(*) n FROM stock_movement_history')[0]['n'] == 0, dry)

c, invalid_period = call('POST', '/api/import/movements/preview', admin, {
    'movement_category': 'ISSUE', 'period_start': iso(0), 'period_end': iso(30),
    'rows': mapped_rows[:1],
})
check('reversed declared period is rejected', c == 400, invalid_period)

c, outside_period = call('POST', '/api/import/movements/preview', admin, {
    'movement_category': 'ISSUE', 'period_start': iso(10), 'period_end': iso(0),
    'rows': mapped_rows[:1],
})
check('posting date outside declared period is rejected', c == 200
      and outside_period['reconciliation']['invalid_rows'] == 1, outside_period)

c, first_chunk = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'ISSUE', 'source_system': 'SAP_ECC', 'source_filename': 'chunked.csv',
    'source_file_checksum': 'immutable-checksum',
    'rows': [{'external_id': 'CHUNK-1', 'material_code': 'MAT-0002', 'quantity': 3, 'posting_date': iso(5)}],
})
c2, mixed_chunk = call('POST', '/api/import/movements/chunk', admin, {
    'batch_id': first_chunk.get('batch_id'), 'movement_category': 'ISSUE',
    'source_system': 'OTHER', 'source_filename': 'chunked.csv',
    'source_file_checksum': 'immutable-checksum',
    'rows': [{'external_id': 'CHUNK-2', 'material_code': 'MAT-0002', 'quantity': 2, 'posting_date': iso(4)}],
})
check('continuation cannot change source provenance', c == 200 and c2 == 400, (first_chunk, mixed_chunk))

before_import = live_snapshot()
c, imported = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'ISSUE', 'source_system': 'SAP_ECC', 'source_filename': 'issues.csv',
    'source_file_checksum': 'sha256-test-issue', 'field_mapping': mapping,
    'period_start': iso(30), 'period_end': iso(0), 'finalize': True, 'rows': mapped_rows,
})
issue_batch = imported.get('batch_id')
check('issue import inserts valid row and isolates invalid row', c == 200 and imported.get('inserted') == 1 and imported.get('invalid') == 1, imported)
stored = db_rows('SELECT * FROM stock_movement_history WHERE import_batch_id=?', (issue_batch,))[0]
check('canonical dates and ERP fields are stored exactly', stored['posting_date'] == iso(20)
      and stored['document_date'] == iso(21) and stored['erp_movement_type'] == '201'
      and stored['erp_document_reference'] == 'DOC-ISSUE-1' and stored['cost_center'] == 'CC-TEST', stored)
check('analytical import never mutates live stock', before_import == live_snapshot(), (before_import, live_snapshot()))
batch = db_rows('SELECT * FROM stock_movement_import_batches WHERE id=?', (issue_batch,))[0]
check('batch stores source traceability and reconciliation', batch['movement_category'] == 'ISSUE'
      and batch['source_system'] == 'SAP_ECC' and batch['source_file_checksum'] == 'sha256-test-issue'
      and batch['status'] == 'COMPLETED_WITH_ERRORS' and bool(batch['reconciliation_json']), batch)
c, rejected = call('GET', f'/api/import/movements/batches/{issue_batch}/errors', admin)
check('rejected rows are retrievable with raw source data', c == 200 and len(rejected.get('errors', [])) == 1
      and rejected['errors'][0].get('raw_row_json'), rejected)

c, duplicate = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'ISSUE', 'source_system': 'SAP_ECC', 'source_filename': 'issues.csv',
    'field_mapping': mapping, 'finalize': True, 'rows': mapped_rows[:1],
})
check('repeat import remains idempotent', c == 200 and duplicate.get('inserted') == 0 and duplicate.get('duplicates') == 1, duplicate)

def import_one(category, quantity, suffix, **extra):
    body = {'movement_category': category, 'source_system': 'SAP_ECC', 'source_filename': f'{category.lower()}.csv',
            'period_start': iso(30), 'period_end': iso(0), 'finalize': True,
            'rows': [{'external_id': f'{category}-{suffix}', 'material_code': 'MAT-0001',
                      'quantity': quantity, 'posting_date': iso(10), 'erp_document_reference': f'DOC-{suffix}'}]}
    body.update(extra)
    return call('POST', '/api/import/movements/chunk', admin, body)

category_batches = {}
for category, quantity, suffix, extra in [
    ('RECEIPT', 4, 'REC', {}), ('RETURN', 2, 'RET', {}),
    ('REVERSAL', 1, 'REV', {'reversal_of_category': 'ISSUE'}),
    ('TRANSFER_OUT', 50, 'TOUT', {}), ('TRANSFER_IN', 50, 'TIN', {}),
    ('ADJUSTMENT_OUT', 100, 'AOUT', {}), ('ADJUSTMENT_IN', 100, 'AIN', {}),
]:
    c, result = import_one(category, quantity, suffix, **extra)
    check(f'{category} category accepted', c == 200 and result.get('inserted') == 1, result)
    category_batches[category] = result.get('batch_id')

receipt_row = db_rows('SELECT posting_date FROM stock_movement_history WHERE import_batch_id=?',
                      (category_batches['RECEIPT'],))[0]
reversal_row = db_rows('SELECT posting_date, reversal_of_category FROM stock_movement_history WHERE import_batch_id=?',
                       (category_batches['REVERSAL'],))[0]
check('historical Receipt import preserves posting date', receipt_row['posting_date'] == iso(10), receipt_row)
check('reversal preserves date and original category semantics', reversal_row['posting_date'] == iso(10)
      and reversal_row['reversal_of_category'] == 'ISSUE', reversal_row)

# Opening balance is an operational stock-establishment record, not a receipt
# or consumption-history signal.
with sqlite3.connect(DB) as connection:
    material_id = connection.execute("SELECT id FROM materials WHERE item_code='MAT-0001'").fetchone()[0]
    location_id = connection.execute('SELECT id FROM locations ORDER BY id LIMIT 1').fetchone()[0]
    user_id = connection.execute("SELECT id FROM users WHERE email='admin@example.com'").fetchone()[0]
    connection.execute("INSERT INTO stock_transactions(transaction_type,material_id,location_id,quantity,user_id,notes,transaction_date) VALUES('IN',?,?,?,?,?,?)",
                       (material_id, location_id, 999, user_id, 'Opening stock import — batch TEST-OPENING', iso(0)))

c, partial = call('GET', '/api/analytics', admin)
known = next(item for item in partial['items'] if item['item_code'] == 'MAT-0001')
unknown = [item for item in partial['items'] if item['classification'] == 'UNKNOWN']
check('partial issue coverage stays prominently PARTIAL', c == 200 and partial['coverage']['status'] == 'PARTIAL' and partial['coverage']['warning'], partial['coverage'])
check('returns and issue reversals net consumption', known['net_consumption'] == 7 and known['out_qty_window'] == 10, known)
check('transfers and adjustments are excluded from demand', known['avg_monthly_consumption'] == round(7 / 90 * 30, 2), known)
check('opening stock is not interpreted as a historical receipt', known['receipt_qty_window'] == 4 and known['receipt_frequency_per_month'] == round(1 / 90 * 30, 2), known)
check('known moving material is never mislabeled dead', known['classification'] in ('SLOW', 'NORMAL', 'FAST'), known)
check('no-issue stocked materials remain UNKNOWN under partial coverage', bool(unknown), unknown[:2])

# A second sparse issue-history file cannot prove continuous global coverage.
c, complete_batch = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'ISSUE', 'source_system': 'LEGACY_WMS', 'source_filename': 'older-issues.csv',
    'period_start': iso(120), 'period_end': iso(31), 'finalize': True,
    'rows': [{'external_id': 'OLD-ISSUE-1', 'material_code': 'MAT-0002', 'quantity': 1, 'posting_date': iso(60)}],
})
check('older issue interval imported', c == 200 and complete_batch.get('inserted') == 1, complete_batch)
c, complete = call('GET', '/api/analytics', admin)
check('declared sparse intervals do not produce COMPLETE coverage', c == 200
      and complete['coverage']['status'] == 'PARTIAL', complete['coverage'])
check('sparse imports cannot enable DEAD classification', complete['summary']['dead_count'] == 0
      and complete['summary']['unknown_count'] > 0, complete['summary'])

# Append-only enforcement remains active after migration backfill.
try:
    with sqlite3.connect(DB) as connection:
        connection.execute("UPDATE stock_movement_history SET description='mutated' WHERE id=(SELECT MIN(id) FROM stock_movement_history)")
    append_only = False
except sqlite3.IntegrityError as error:
    append_only = 'append-only' in str(error)
check('movement history remains append-only', append_only)

c, invalid_category = call('POST', '/api/import/movements/preview', admin, {
    'movement_category': 'CONSUMPTIONISH', 'rows': [{'material_code': 'MAT-0001', 'quantity': 1, 'posting_date': iso(0)}],
})
check('ambiguous movement category is rejected', c == 400, invalid_category)

# COR-002: material-and-plant scope attestations are review-only evidence.
attestation_columns = {row['name'] for row in db_rows('PRAGMA table_info(analytical_scope_attestations)')}
check('attestation migration is additive with immutable provenance fields',
      {'import_batch_id', 'material_id', 'material_code', 'plant_code', 'source_extract_reference',
       'period_start', 'period_end', 'evidence_state', 'supersedes_attestation_id',
       'submitted_by', 'approved_by'} <= attestation_columns, attestation_columns)

with sqlite3.connect(DB) as connection:
    connection.execute("INSERT OR IGNORE INTO user_permissions(user_id, permission_id) SELECT u.id, p.id FROM users u, permissions p WHERE u.email='requester@example.com' AND p.key='analytical_attestation_submit'")
    connection.execute("INSERT OR IGNORE INTO user_permissions(user_id, permission_id) SELECT u.id, p.id FROM users u, permissions p WHERE u.email='requester@example.com' AND p.key='analytical_attestation_approve'")
    connection.execute("INSERT OR IGNORE INTO user_permissions(user_id, permission_id) SELECT u.id, p.id FROM users u, permissions p WHERE u.email='manager@example.com' AND p.key='analytical_attestation_approve'")
source_owner = login('requester@example.com', 'Passw0rd!')
steward = login('manager@example.com', 'Passw0rd!')
supervisor = login('supervisor@example.com', 'Passw0rd!')
check('attestation source owner and steward logins work', bool(source_owner and steward))

scope_period_start, scope_period_end = iso(30), iso(10)
c, scope_import = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'RECEIPT', 'source_system': 'SAP_SCOPE', 'source_filename': 'mat-0003-p100.csv',
    'period_start': scope_period_start, 'period_end': scope_period_end, 'finalize': True,
    'rows': [{'external_id': 'SCOPE-MAT3-1', 'material_code': 'MAT-0003', 'plant_code': 'P100',
              'quantity': 1, 'posting_date': iso(20), 'erp_document_reference': 'SCOPE-REF-1'}],
})
scope_batch = scope_import.get('batch_id')
check('single-material single-plant scope batch imports cleanly', c == 200 and scope_import.get('invalid') == 0, scope_import)

scope_body = {
    'import_batch_id': scope_batch, 'material_code': 'MAT-0003', 'plant_code': 'P100',
    'source_system': 'SAP_SCOPE', 'source_extract_reference': 'SAP report ZMM_SCOPE/2026-08-14/001',
    'data_generated_at': f'{iso(9)}T12:00:00Z', 'period_start': scope_period_start,
    'period_end': scope_period_end, 'covered_material_codes': ['MAT-0003'],
}
c, broad_denied = call('POST', '/api/analytical-attestations', supervisor, scope_body)
check('broad goods-receipt permission cannot submit narrow attestation', c == 403, broad_denied)
c, before_attestation = call('GET', '/api/analytics', admin)
before_mat3 = next(item for item in before_attestation['items'] if item['item_code'] == 'MAT-0003')
check('unsigned imported scope remains PARTIAL and UNKNOWN', before_attestation['coverage']['status'] == 'PARTIAL'
      and before_mat3['classification'] == 'UNKNOWN' and before_mat3['attestation'] is None, before_mat3)

for name, body in [
    ('mismatched source prevents attestation', {**scope_body, 'source_system': 'OTHER_SOURCE'}),
    ('mismatched period prevents attestation', {**scope_body, 'period_start': iso(29)}),
    ('excluded material list prevents attestation', {**scope_body, 'covered_material_codes': ['MAT-0001']}),
    ('undocumented exception window prevents attestation', {**scope_body, 'exception_window': {
        'start_date': iso(25), 'end_date': iso(24), 'reason': 'ERP outage'}}),
]:
    c, rejected_scope = call('POST', '/api/analytical-attestations', source_owner, body)
    check(name, c == 400, rejected_scope)

c, submitted_scope = call('POST', '/api/analytical-attestations', source_owner, scope_body)
scope_attestation_id = submitted_scope.get('attestation', {}).get('id')
check('source owner submits payload-unverified material-and-plant evidence', c == 201
      and submitted_scope.get('attestation', {}).get('evidence_state') == 'ATTESTED_PAYLOAD_UNVERIFIED'
      and submitted_scope.get('attestation', {}).get('status') == 'SUBMITTED', submitted_scope)
c, self_approval = call('POST', f'/api/analytical-attestations/{scope_attestation_id}/approve', source_owner)
check('same user submit and approve is rejected', c == 400, self_approval)
c, approved_scope = call('POST', f'/api/analytical-attestations/{scope_attestation_id}/approve', steward)
check('separate internal data steward approves after five-business-day cut-off', c == 200
      and approved_scope.get('attestation', {}).get('status') == 'APPROVED', approved_scope)

c, attested_report = call('GET', '/api/analytics', admin)
attested_mat3 = next(item for item in attested_report['items'] if item['item_code'] == 'MAT-0003')
check('attested scope affects only declared plant and material as review evidence', attested_mat3['classification'] == 'UNKNOWN'
      and attested_mat3['attested_review_required'] is True
      and attested_mat3['attestation']['plant_code'] == 'P100'
      and attested_mat3['attestation']['label'] == 'ATTESTED_PAYLOAD_UNVERIFIED', attested_mat3)
check('attested payload-unverified evidence cannot yield direct DEAD or change global coverage',
      attested_report['coverage']['status'] == 'PARTIAL' and attested_report['summary']['dead_count'] == 0, attested_report['summary'])

# A late period is submittable but cannot become an attestation until five business days pass.
c, cutoff_import = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'RECEIPT', 'source_system': 'SAP_CUTOFF', 'source_filename': 'mat-0003-cutoff.csv',
    'period_start': iso(5), 'period_end': iso(1), 'finalize': True,
    'rows': [{'external_id': 'SCOPE-MAT3-CUTOFF', 'material_code': 'MAT-0003', 'plant_code': 'P100',
              'quantity': 1, 'posting_date': iso(2), 'erp_document_reference': 'SCOPE-CUTOFF'}],
})
cutoff_body = {**scope_body, 'import_batch_id': cutoff_import.get('batch_id'), 'source_system': 'SAP_CUTOFF',
               'source_extract_reference': 'SAP report ZMM_SCOPE/recent', 'period_start': iso(5), 'period_end': iso(1)}
c, cutoff_submitted = call('POST', '/api/analytical-attestations', source_owner, cutoff_body)
c2, cutoff_approval = call('POST', f"/api/analytical-attestations/{cutoff_submitted.get('attestation', {}).get('id')}/approve", steward)
check('five-business-day posting cut-off is enforced', c == 201 and c2 == 400
      and 'cut-off' in (cutoff_approval.get('error') or ''), cutoff_approval)

# A correction uses a new batch and an append-only supersession link; the prior
# approved attestation is neither edited nor deleted.
c, replacement_import = call('POST', '/api/import/movements/chunk', admin, {
    'movement_category': 'RECEIPT', 'source_system': 'SAP_SCOPE_CORRECTED', 'source_filename': 'mat-0003-p100-corrected.csv',
    'period_start': scope_period_start, 'period_end': scope_period_end, 'finalize': True,
    'rows': [{'external_id': 'SCOPE-MAT3-REPLACEMENT', 'material_code': 'MAT-0003', 'plant_code': 'P100',
              'quantity': 1, 'posting_date': iso(20), 'erp_document_reference': 'SCOPE-REF-REPLACEMENT'}],
})
replacement_body = {**scope_body, 'import_batch_id': replacement_import.get('batch_id'),
                    'source_system': 'SAP_SCOPE_CORRECTED',
                    'source_extract_reference': 'SAP report ZMM_SCOPE/2026-08-14/001 corrected',
                    'supersedes_attestation_id': scope_attestation_id}
c, replacement_submitted = call('POST', '/api/analytical-attestations', source_owner, replacement_body)
replacement_id = replacement_submitted.get('attestation', {}).get('id')
c2, replacement_approved = call('POST', f'/api/analytical-attestations/{replacement_id}/approve', steward)
supersession = db_rows('SELECT * FROM analytical_scope_attestation_supersessions WHERE prior_attestation_id=?', (scope_attestation_id,))
prior_row = db_rows('SELECT status, approved_at, evidence_state FROM analytical_scope_attestations WHERE id=?', (scope_attestation_id,))[0]
try:
    with sqlite3.connect(DB) as connection:
        connection.execute("UPDATE analytical_scope_attestations SET source_extract_reference='mutated' WHERE id=?", (scope_attestation_id,))
    prior_immutable = False
except sqlite3.IntegrityError as error:
    prior_immutable = 'immutable' in str(error)
check('replacement attestation is separately approved and supersedes prior evidence', c == 201 and c2 == 200
      and supersession and supersession[0]['replacement_attestation_id'] == replacement_id, replacement_approved)
check('supersession preserves prior approved attestation without editing it', prior_row['status'] == 'APPROVED'
      and prior_row['evidence_state'] == 'ATTESTED_PAYLOAD_UNVERIFIED' and prior_immutable, prior_row)

print(f'\n===== RESULT: {passed} passed, {failed} failed =====')
if fails:
    print('Failed:', fails)
sys.exit(1 if failed else 0)
