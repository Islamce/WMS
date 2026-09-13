/**
 * Setup progress — what a new tenant still has to do before the product works.
 *
 * A freshly provisioned tenant is correct and completely empty: 43 screens and
 * nothing in them, with no indication of where to start. Worse, the order is not
 * guessable. A received batch arrives on QUALITY HOLD in no bin, and allocation
 * will not touch it until it is both released and put away — so a customer who
 * receives stock and raises a request finds that nothing can be picked, which
 * looks exactly like a broken product rather than a missing step.
 *
 * The state is computed on the SERVER from real rows rather than inferred in the
 * browser. public/js/pages/home.js deliberately does not aggregate action queues
 * without a server-authorised contract; this is that contract, kept narrow: it
 * reports counts of emptiness and nothing about any individual record.
 *
 * It reports itself complete the moment material has been issued once, and the
 * UI then stops showing it. A checklist that outlives its usefulness is clutter,
 * and on an established tenant (production included) every step is already
 * satisfied, so it never appears there at all.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');

const router = express.Router();
router.use(authenticate);

const count = (sql, ...params) => db.prepare(sql).get(...params).n;

/** GET /api/setup/status — the ordered first-run steps and which are done. */
router.get('/status', (req, res) => {
  const warehouses = count('SELECT COUNT(*) AS n FROM warehouses WHERE COALESCE(is_active,1)=1');
  const bins = count('SELECT COUNT(*) AS n FROM bin_locations');
  const materials = count('SELECT COUNT(*) AS n FROM materials');
  const batches = count('SELECT COUNT(*) AS n FROM batches');
  const released = count("SELECT COUNT(*) AS n FROM batches WHERE quality_status='RELEASED'");
  const binned = count("SELECT COUNT(*) AS n FROM batches WHERE bin_location IS NOT NULL AND bin_location <> ''");
  const issued = count("SELECT COUNT(*) AS n FROM stock_transactions WHERE transaction_type='OUT'");

  const steps = [
    { key: 'warehouse', done: warehouses > 0, route: '#/warehouses-master',
      title: 'Create a site store',
      detail: 'Material is received into a store. Without one, nothing else can happen.' },
    { key: 'bins', done: bins > 0, route: '#/bins-master',
      title: 'Add a few bin locations',
      detail: 'Where things physically sit in the store — a yard, a rack, a locked cage.' },
    { key: 'materials', done: materials > 0, route: '#/import',
      title: 'Load your material list',
      detail: 'Import a CSV. Download the template first; it carries a worked example row.' },
    { key: 'receive', done: batches > 0, route: '#/receiving',
      title: 'Post your first goods receipt',
      detail: 'Receive something real into the store.' },
    { key: 'release', done: released > 0, route: '#/quality',
      title: 'Release it from quality hold',
      detail: 'Received stock arrives on hold. It cannot be issued until quality releases it.' },
    { key: 'putaway', done: binned > 0, route: '#/receiving',
      title: 'Put it away in a bin',
      detail: 'Stock with no bin cannot be allocated to a request, so this step is not optional.' },
    { key: 'issue', done: issued > 0, route: '#/create-request',
      title: 'Request it, approve it, and issue it',
      detail: 'The full round trip. Once this works, the system is live.' },
  ];

  const next = steps.find((s) => !s.done) || null;
  res.json({
    complete: !next,
    completed_steps: steps.filter((s) => s.done).length,
    total_steps: steps.length,
    next_step: next,
    steps,
  });
});

module.exports = router;
