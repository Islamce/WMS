/**
 * PDF label generation for QR codes (pdfkit + qrcode, no native deps).
 * One 4x6in label page per QR with a scannable QR image and the full
 * traceability block (material, batch, PO/GR, warehouse/bin, dates, quality).
 */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

/** Stream a PDF of one or more QR labels into `res`. */
async function streamLabelsPdf(res, qrs) {
  const doc = new PDFDocument({ size: [288, 432], margin: 18 }); // 4x6in @72dpi
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="qr-labels.pdf"`);
  doc.pipe(res);

  for (let i = 0; i < qrs.length; i++) {
    if (i > 0) doc.addPage();
    const qr = qrs[i];

    // Real scannable QR code (PNG buffer).
    const png = await QRCode.toBuffer(qr.qr_code_value, { width: 180, margin: 1 });
    doc.image(png, (288 - 180) / 2, 24, { width: 180, height: 180 });

    doc.font('Helvetica-Bold').fontSize(13)
      .text(qr.material_code || '', 18, 214, { width: 252, align: 'center' });
    doc.font('Helvetica').fontSize(9)
      .text(qr.material_description || '', { width: 252, align: 'center' });

    doc.moveTo(18, doc.y + 6).lineTo(270, doc.y + 6).strokeColor('#999').stroke();
    doc.y += 12;

    const row = (k, v) => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#444').text(k, 18, y, { width: 90 });
      doc.font('Helvetica').fontSize(8).fillColor('#000').text(v ?? '—', 112, y, { width: 158 });
      doc.y = Math.max(doc.y, y + 11);
    };
    row('Batch', qr.batch_number);
    row('Quantity', `${qr.remaining_quantity ?? qr.received_quantity ?? ''} ${qr.uom || ''}`);
    row('PO / GR', `${qr.po_number || '—'} / ${qr.gr_number || '—'}`);
    row('Supplier', qr.supplier_name || qr.supplier_code);
    row('Warehouse / Bin', `${qr.warehouse_code || '—'} / ${qr.bin_location || '—'}`);
    row('Received', qr.receiving_date);
    row('Mfg date', qr.manufacturing_date);
    row('Expiry', qr.expiry_date);
    row('Quality', qr.quality_status);
    row('QR ID', qr.qr_code_value);
  }
  doc.end();
}

/** Stream a single 4x6in outbound shipment label (QR + delivery block). */
async function streamShipmentLabelPdf(res, s) {
  const doc = new PDFDocument({ size: [288, 432], margin: 18 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${s.shipment_number}.pdf"`);
  doc.pipe(res);

  const png = await QRCode.toBuffer(s.qr_code_value || s.shipment_number, { width: 180, margin: 1 });
  doc.image(png, (288 - 180) / 2, 24, { width: 180, height: 180 });

  doc.font('Helvetica-Bold').fontSize(14)
    .text(s.shipment_number, 18, 214, { width: 252, align: 'center' });
  doc.font('Helvetica').fontSize(9)
    .text(`Status: ${s.status}`, { width: 252, align: 'center' });

  doc.moveTo(18, doc.y + 6).lineTo(270, doc.y + 6).strokeColor('#999').stroke();
  doc.y += 12;

  const row = (k, v) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#444').text(k, 18, y, { width: 90 });
    doc.font('Helvetica').fontSize(8).fillColor('#000').text(v ?? '—', 112, y, { width: 158 });
    doc.y = Math.max(doc.y, y + 11);
  };
  row('Ship to', s.ship_to);
  row('Request', s.request_number);
  row('Delivery order', s.delivery_order_number);
  row('Carrier', s.carrier);
  row('Vehicle / Driver', `${s.vehicle || '—'} / ${s.driver || '—'}`);
  row('Packages', String(s.packages ?? 1));
  row('Weight (kg)', s.weight_kg != null ? String(s.weight_kg) : null);
  row('Created', s.created_at);
  row('QR ID', s.qr_code_value);
  doc.end();
}

module.exports = { streamLabelsPdf, streamShipmentLabelPdf };
