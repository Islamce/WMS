/**
 * Report export — turns a set of columns + rows (sent by the client from any
 * report table) into a downloadable PDF table. CSV and Excel are generated on
 * the client; PDF is rendered here with pdfkit (already a dependency).
 *
 * POST /api/export/pdf  body: { title, columns:[{key,label}], rows:[{...}] }
 */
const express = require('express');
const PDFDocument = require('pdfkit');
const { authenticate } = require('./../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.post('/pdf', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || 'Report').slice(0, 120);
  const columns = Array.isArray(b.columns) ? b.columns.slice(0, 20) : [];
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
  if (!columns.length) return res.status(400).json({ error: 'No columns to export.' });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
  const filename = (b.filename || 'report').replace(/[^a-z0-9_-]+/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;
  const colW = usable / columns.length;
  const cell = (v) => (v == null ? '' : String(v));

  // Title + generated timestamp.
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text(title, left, doc.page.margins.top);
  doc.font('Helvetica').fontSize(8).fillColor('#64748b')
    .text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} · ${rows.length} row(s)`);
  doc.moveDown(0.6);

  const rowHeight = 16;
  let y = doc.y;

  const drawHeader = () => {
    doc.rect(left, y, usable, rowHeight).fill('#eef2f7');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155');
    columns.forEach((c, i) => doc.text(cell(c.label || c.key), left + i * colW + 4, y + 4, { width: colW - 8, ellipsis: true, lineBreak: false }));
    y += rowHeight;
  };
  drawHeader();

  doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
  rows.forEach((r, idx) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage(); y = doc.page.margins.top; drawHeader();
      doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    }
    if (idx % 2 === 1) doc.rect(left, y, usable, rowHeight).fill('#f8fafc').fillColor('#0f172a');
    columns.forEach((c, i) => {
      doc.fillColor('#0f172a').text(cell(r[c.key]), left + i * colW + 4, y + 4, { width: colW - 8, ellipsis: true, lineBreak: false });
    });
    y += rowHeight;
  });

  doc.end();
});

module.exports = router;
