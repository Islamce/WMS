/**
 * Request attachments — upload/list/download/delete supporting documents on a
 * material request. To stay consistent with the JSON-only API (and avoid a
 * multipart dependency) uploads are sent as base64 in the JSON body; bytes are
 * written under data/attachments/<requestId>/ and only metadata is stored in
 * request_attachments. Best-effort, size- and type-limited.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isNonEmptyString } = require('./../utils/validate');

const router = express.Router();
router.use(authenticate);

const CAN_ATTACH = requirePermission(['material_requests', 'create_request', 'approvals']);
const MAX_BYTES = 1.5 * 1024 * 1024; // keep base64 payload under the 2mb JSON cap
const ALLOWED = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'text/plain', 'text/csv',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const STORE_ROOT = path.join(__dirname, '..', '..', 'data', 'attachments');

function reqOr404(res, id) {
  const r = db.prepare('SELECT id, request_number FROM material_request_headers WHERE id=?').get(id);
  if (!r) { res.status(404).json({ error: 'Request not found.' }); return null; }
  return r;
}

/** GET /api/requests/:id/attachments — list metadata. */
router.get('/requests/:id/attachments', CAN_ATTACH, (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid request id.' });
  const rows = db.prepare(
    'SELECT id, file_name, content_type, byte_size, uploaded_by_name, created_at FROM request_attachments WHERE request_id=? ORDER BY id DESC'
  ).all(req.params.id);
  res.json({ attachments: rows });
});

/** POST /api/requests/:id/attachments — body { file_name, content_type, data_base64 }. */
router.post('/requests/:id/attachments', CAN_ATTACH, (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid request id.' });
  const header = reqOr404(res, req.params.id);
  if (!header) return;
  const { file_name, content_type, data_base64 } = req.body || {};
  if (!isNonEmptyString(file_name) || !isNonEmptyString(data_base64)) {
    return res.status(400).json({ error: 'file_name and data_base64 are required.' });
  }
  if (content_type && !ALLOWED.has(content_type)) {
    return res.status(400).json({ error: `Unsupported file type '${content_type}'.` });
  }
  let buf;
  try { buf = Buffer.from(data_base64, 'base64'); } catch { buf = null; }
  if (!buf || buf.length === 0) return res.status(400).json({ error: 'Invalid file data.' });
  if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'File exceeds the 1.5 MB limit.' });

  const safeName = path.basename(String(file_name)).replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'file';
  const dir = path.join(STORE_ROOT, String(header.id));
  fs.mkdirSync(dir, { recursive: true });
  const storageName = `${crypto.randomUUID()}_${safeName}`;
  const storagePath = path.join(dir, storageName);
  fs.writeFileSync(storagePath, buf);

  const info = db.prepare(`
    INSERT INTO request_attachments
      (request_id, request_number, file_name, content_type, byte_size, storage_path, uploaded_by, uploaded_by_name)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(header.id, header.request_number, safeName, content_type || 'application/octet-stream',
    buf.length, path.relative(path.join(__dirname, '..', '..'), storagePath), req.user.id, req.user.name);

  res.status(201).json({ message: 'Attachment uploaded.', id: info.lastInsertRowid, file_name: safeName, byte_size: buf.length });
});

/** GET /api/attachments/:aid/download — stream the file. */
router.get('/attachments/:aid/download', CAN_ATTACH, (req, res) => {
  if (!isId(req.params.aid)) return res.status(400).json({ error: 'Invalid attachment id.' });
  const a = db.prepare('SELECT * FROM request_attachments WHERE id=?').get(req.params.aid);
  if (!a) return res.status(404).json({ error: 'Attachment not found.' });
  const abs = path.join(__dirname, '..', '..', a.storage_path);
  if (!abs.startsWith(STORE_ROOT) || !fs.existsSync(abs)) {
    return res.status(404).json({ error: 'Attachment file is missing.' });
  }
  res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${a.file_name}"`);
  fs.createReadStream(abs).pipe(res);
});

/** DELETE /api/attachments/:aid — uploader or admin. */
router.delete('/attachments/:aid', CAN_ATTACH, (req, res) => {
  if (!isId(req.params.aid)) return res.status(400).json({ error: 'Invalid attachment id.' });
  const a = db.prepare('SELECT * FROM request_attachments WHERE id=?').get(req.params.aid);
  if (!a) return res.status(404).json({ error: 'Attachment not found.' });
  if (req.user.role !== 'admin' && a.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'Only the uploader or an admin can delete this attachment.' });
  }
  const abs = path.join(__dirname, '..', '..', a.storage_path);
  try { if (abs.startsWith(STORE_ROOT) && fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* file already gone */ }
  db.prepare('DELETE FROM request_attachments WHERE id=?').run(a.id);
  res.json({ message: 'Attachment deleted.' });
});

module.exports = router;
