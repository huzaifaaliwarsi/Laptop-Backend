const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const db = require('../../config/db');

// English words converter (PKR format)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertGroup(num) {
  let str = '';
  if (num >= 100) {
    str += ONES[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  if (num >= 20) {
    const tensPart = TENS[Math.floor(num / 10)];
    const onesPart = ONES[num % 10];
    str += (onesPart ? `${tensPart}-${onesPart}` : tensPart) + ' ';
  } else if (num > 0) {
    str += ONES[num] + ' ';
  }
  return str.trim();
}

function amountInWordsPKR(amount) {
  const num = parseFloat(amount || 0);
  if (isNaN(num) || num === 0) return 'Rupees Zero Only.';
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const integerPart = Math.floor(absNum);
  const decimalPart = Math.round((absNum - integerPart) * 100);

  const billions = Math.floor(integerPart / 1000000000);
  const millions = Math.floor((integerPart % 1000000000) / 1000000);
  const thousands = Math.floor((integerPart % 1000000) / 1000);
  const remainder = integerPart % 1000;
  const parts = [];

  if (billions > 0) parts.push(`${convertGroup(billions)} Billion`);
  if (millions > 0) parts.push(`${convertGroup(millions)} Million`);
  if (thousands > 0) parts.push(`${convertGroup(thousands)} Thousand`);
  if (remainder > 0) parts.push(convertGroup(remainder));

  const words = parts.length > 0 ? parts.join(' ') : 'Zero';
  if (decimalPart > 0) {
    return `${isNegative ? 'Minus ' : ''}Rupees ${words} and ${convertGroup(decimalPart)} Paisas Only.`;
  }
  return `${isNegative ? 'Minus ' : ''}Rupees ${words} Only.`;
}

function numStr(val) {
  const n = parseFloat(val || 0);
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateDMY(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (e) {
    return String(v);
  }
}

function getDocumentTitle(invoice = {}) {
  const t = String(invoice.type || invoice.typeKey || '').toLowerCase();
  if (invoice.isPaymentReceipt || t.includes('payment receipt') || t === 'payment') {
    const isVendor = invoice.partyType === 'Vendor' || invoice.direction === 'Paid' || String(invoice.accountType || '').includes('Vendor');
    return isVendor ? 'VENDOR PAYMENT RECEIPT' : 'CUSTOMER PAYMENT RECEIPT';
  }
  if (t.includes('buyback') || t.includes('customer purchase')) return 'CUSTOMER BUYBACK RECEIPT';
  if (t.includes('exchange')) return 'PRODUCT EXCHANGE INVOICE';
  if (t.includes('vendor return') || t.includes('vendor-return')) return 'VENDOR RETURN NOTE';
  if (t.includes('sales return') || t.includes('sale return') || invoice.isVoided) return 'SALES RETURN / REFUND RECEIPT';
  if (t.includes('vendor purchase') || t.includes('vendor') || t.includes('purchase')) return 'VENDOR PURCHASE INVOICE';
  if (t.includes('diagnosis')) return 'DIAGNOSIS & INSPECTION INVOICE';
  if (t.includes('repair')) return 'REPAIR SERVICE INVOICE';
  if (t.includes('custom')) return 'SALES INVOICE (CUSTOM)';
  const hasTax = parseFloat(invoice.taxAmount || 0) > 0 || !!invoice.fbrInvoiceNo;
  return hasTax ? 'SALES TAX INVOICE' : 'RETAIL SALES INVOICE';
}

async function getBusinessSettings() {
  try {
    const res = await db.query(
      `SELECT company_name, tagline, invoice_subtitle, phone, email, tax_number, ntn, strn, pos_id, fbr_pos_id, address, invoice_footer, logo_data
       FROM business_settings WHERE id = 1`
    );
    if (res.rows.length > 0) return res.rows[0];
  } catch (e) {
    console.warn('[InvoicePDF] Could not fetch business_settings:', e.message);
  }
  return {
    company_name: 'Saad Communication',
    tagline: 'Retail and Repair management system',
    phone: '',
    email: '',
    address: 'Karachi, Pakistan',
    ntn: '-',
    strn: '-',
    pos_id: '-'
  };
}

/**
 * Generate official White Paper A4 PDF matching the exact real invoice layout
 */
async function generateInvoicePdf(invoice) {
  const branding = await getBusinessSettings();

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 30,
        info: {
          Title: `Invoice ${invoice.invoiceNo || invoice.id}`,
          Author: branding.company_name || 'Retail & Repair Management',
          Subject: `${getDocumentTitle(invoice)} - ${invoice.invoiceNo || invoice.id}`
        }
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const margin = 30;
      const pageWidth = 595.28;
      const contentWidth = pageWidth - (margin * 2); // 535.28 pt

      // --- TOP HEADER ---
      let curY = margin + 4;
      const companyName = (branding.company_name || 'SAAD COMMUNICATION').toUpperCase();
      const companyAddress = branding.address || 'Shop #12, Computer Plaza, Main Boulevard Karachi';
      const phone = branding.phone || '';
      const email = branding.email || '';
      const ntn = branding.ntn || branding.tax_number || '-';
      const strn = branding.strn || '-';
      const posId = branding.pos_id || branding.fbr_pos_id || '-';

      // Centered Logo + Company Title
      let logoBuf = null;
      let hasLogo = false;
      if (branding.logo_data && typeof branding.logo_data === 'string' && branding.logo_data.startsWith('data:image')) {
        try {
          const base64Data = branding.logo_data.replace(/^data:image\/\w+;base64,/, '');
          logoBuf = Buffer.from(base64Data, 'base64');
          hasLogo = true;
        } catch (logoErr) {
          console.warn('[InvoicePDF] Error parsing logo:', logoErr.message);
        }
      }

      doc.font('Helvetica-Bold').fontSize(16);
      const titleWidth = doc.widthOfString(companyName);
      const logoW = 44;
      const logoH = 34;
      const gap = 12;

      if (hasLogo && logoBuf) {
        const totalHeaderW = logoW + gap + titleWidth;
        const startX = (pageWidth - totalHeaderW) / 2;
        try {
          doc.image(logoBuf, startX, curY - 3, { fit: [logoW, logoH] });
        } catch (imgErr) {
          console.warn('[InvoicePDF] Image rendering skipped:', imgErr.message);
        }
        doc.fillColor('#000000').text(companyName, startX + logoW + gap, curY + 6);
      } else {
        doc.fillColor('#000000').text(companyName, 0, curY + 4, { width: pageWidth, align: 'center' });
      }

      curY += 36;

      // Header Grid: Address & Contact on Left, NTN / STRN / POS Table on Right
      doc.font('Helvetica').fontSize(8.5).fillColor('#111827');
      doc.text(companyAddress.toUpperCase(), margin, curY, { width: 320 });
      curY += 12;

      const contactParts = [];
      if (phone) contactParts.push(`Tel: ${phone}`);
      if (email) contactParts.push(`Email: ${email}`);
      const contactStr = contactParts.join(' | ');
      if (contactStr) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(contactStr, margin, curY, { width: 320 });
      }

      // Tax Table on Right
      const taxTableY = curY - 14;
      const taxLabelX = margin + 355;
      const taxValX = margin + 415;
      const taxLineW = 118;

      const renderTaxRow = (label, val, y) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(label, taxLabelX, y);
        doc.font('Helvetica').fontSize(8).fillColor('#000000').text(val || '-', taxValX, y, { width: taxLineW, align: 'center' });
        doc.moveTo(taxValX - 4, y + 9).lineTo(taxValX + taxLineW, y + 9).lineWidth(0.5).strokeColor('#374151').stroke();
      };

      renderTaxRow('NTN #', ntn, taxTableY);
      renderTaxRow('STRN #', strn, taxTableY + 12);
      renderTaxRow('POS ID #', posId, taxTableY + 24);

      curY += 28;

      // Main Top Divider Line
      doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 8;

      // --- VOID / REFUND NOTICE (If voided) ---
      if (invoice.isVoided) {
        doc.rect(margin, curY, contentWidth, 18).fillColor('#fee2e2').fill();
        doc.rect(margin, curY, contentWidth, 18).lineWidth(1).strokeColor('#dc2626').stroke();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#dc2626')
          .text(`VOIDED / REFUNDED: ${invoice.voidReason || 'Returned'} · Refund PKR ${numStr(invoice.refundAmount || invoice.total)} via ${invoice.refundMethod || 'Return'}`,
            margin, curY + 4, { width: contentWidth, align: 'center' });
        curY += 24;
      }

      // --- SUBHEADER META BAR ---
      const invNo = invoice.invoiceNo || invoice.trackingId || invoice.id || '—';
      const invDate = fmtDateDMY(invoice.date || invoice.createdAt);
      const docTitle = getDocumentTitle(invoice);

      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#111827').text('Invoice No.', margin, curY);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000').text(invNo, margin + 58, curY);

      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#111827').text('Invoice Date', margin + 155, curY);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000').text(invDate, margin + 218, curY);

      // Title Box on Right
      const titleBoxW = 200;
      const titleBoxH = 19;
      const titleBoxX = margin + contentWidth - titleBoxW;
      doc.rect(titleBoxX, curY - 3, titleBoxW, titleBoxH).lineWidth(1.2).strokeColor('#000000').stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000')
        .text(docTitle, titleBoxX, curY + 2, { width: titleBoxW, align: 'center' });

      curY += 24;

      // --- TWO SIDE-BY-SIDE BOXES (Party Details & Terms) ---
      const boxW = (contentWidth - 10) / 2; // 262.64 pt
      const isRepairInvoice = !!invoice.repairDetails;
      const boxH = isRepairInvoice ? 84 : 68;
      const leftBoxX = margin;
      const rightBoxX = margin + boxW + 10;

      // Border boxes
      doc.rect(leftBoxX, curY, boxW, boxH).lineWidth(1.2).strokeColor('#000000').stroke();
      doc.rect(rightBoxX, curY, boxW, boxH).lineWidth(1.2).strokeColor('#000000').stroke();

      // Left Box: Party Details
      const partyName = invoice.partyName || invoice.customerName || invoice.vendorName || 'Walk-in Customer';
      const partyAddress = invoice.partyAddress || invoice.address || '—';
      const partyContact = invoice.contact || invoice.phone || '—';
      const stRegNo = invoice.stRegNo || '—';
      const taxId = invoice.partyTaxId || invoice.ntnCnic || invoice.ntn || invoice.ntnTaxId || '—';

      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('To: M/s', leftBoxX + 8, curY + 6);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(partyName, leftBoxX + 64, curY + 6, { width: boxW - 72, lineBreak: false, ellipsis: true });

      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('Address', leftBoxX + 8, curY + 19);
      doc.font('Helvetica').fontSize(8).fillColor('#000000').text(partyAddress, leftBoxX + 64, curY + 19, { width: boxW - 72, lineBreak: false, ellipsis: true });

      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('Telephone', leftBoxX + 8, curY + 32);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(partyContact, leftBoxX + 64, curY + 32, { width: boxW - 72, lineBreak: false, ellipsis: true });

      // Bottom Row of Left Box: ST Reg No & N.T.N / C.N.I.C
      const partyBotY = curY + 48;
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#111827').text('ST Reg No', leftBoxX + 8, partyBotY);
      doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(stRegNo, leftBoxX + 58, partyBotY, { width: 55, lineBreak: false, ellipsis: true });

      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#111827').text('N.T.N / C.N.I.C', leftBoxX + 120, partyBotY);
      doc.font('Helvetica').fontSize(7.5).fillColor('#000000').text(taxId, leftBoxX + 190, partyBotY, { width: boxW - 198, lineBreak: false, ellipsis: true });

      if (isRepairInvoice && invoice.repairDetails) {
        const repY = curY + 61;
        doc.moveTo(leftBoxX + 6, repY).lineTo(leftBoxX + boxW - 6, repY).lineWidth(0.5).dash(2, { space: 2 }).strokeColor('#6b7280').stroke();
        doc.undash();
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#111827').text('Device:', leftBoxX + 8, repY + 4);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000').text(`${invoice.repairDetails.brand || ''} ${invoice.repairDetails.model || ''}`, leftBoxX + 46, repY + 4, { width: boxW - 54, lineBreak: false, ellipsis: true });
        if (invoice.repairDetails.problem) {
          doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#dc2626').text('Problem:', leftBoxX + 8, repY + 13);
          doc.font('Helvetica').fontSize(7.5).fillColor('#dc2626').text(invoice.repairDetails.problem, leftBoxX + 46, repY + 13, { width: boxW - 54, lineBreak: false, ellipsis: true });
        }
      }

      // Right Box: Terms of Payment & Specifications
      const paymentMethod = (invoice.paymentMethod || 'Cash').toUpperCase();
      const paymentStatus = invoice.isVoided ? 'VOIDED / RETURNED' : (invoice.paymentStatus || 'PAID').toUpperCase();
      const staff = invoice.createdByName || invoice.createdBy || 'Admin';
      const refId = invoice.referenceId || invoice.paymentReference || '';

      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('Terms of Payment', rightBoxX + 8, curY + 6);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(paymentMethod, rightBoxX + 96, curY + 6, { width: boxW - 104, lineBreak: false, ellipsis: true });

      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('Payment Status', rightBoxX + 8, curY + 19);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(paymentStatus, rightBoxX + 96, curY + 19, { width: boxW - 104, lineBreak: false, ellipsis: true });

      if (refId) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('Reference / Slip', rightBoxX + 8, curY + 32);
        doc.font('Helvetica').fontSize(8).fillColor('#000000').text(refId, rightBoxX + 96, curY + 32, { width: boxW - 104, lineBreak: false, ellipsis: true });
      }

      const rightBotY = curY + (isRepairInvoice ? 64 : 48);
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#111827').text('Sales Person / Tech', rightBoxX + 8, rightBotY);
      doc.font('Helvetica').fontSize(8).fillColor('#000000').text(staff, rightBoxX + 96, rightBotY, { width: boxW - 104, lineBreak: false, ellipsis: true });

      curY += boxH + 12;

      // --- ITEMS TABLE ---
      // Columns matching user's exact white invoice screenshot
      const cols = {
        sr: { x: margin, w: 28, align: 'center' },
        desc: { x: margin + 30, w: 182, align: 'left' },
        code: { x: margin + 214, w: 76, align: 'left' },
        qty: { x: margin + 292, w: 42, align: 'center' },
        rate: { x: margin + 336, w: 48, align: 'right' },
        amount: { x: margin + 386, w: 48, align: 'right' },
        disc: { x: margin + 436, w: 40, align: 'right' },
        net: { x: margin + 478, w: 57, align: 'right' }
      };

      // Table Header Top Rule
      doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 4;

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000');
      doc.text('S. NO.', cols.sr.x, curY, { width: cols.sr.w, align: cols.sr.align });
      doc.text('DESCRIPTION', cols.desc.x, curY, { width: cols.desc.w, align: cols.desc.align });
      doc.text('H S CODE / CODE', cols.code.x, curY, { width: cols.code.w, align: cols.code.align });
      doc.text('QUANTITY', cols.qty.x, curY, { width: cols.qty.w, align: cols.qty.align });
      doc.text('RATE', cols.rate.x, curY, { width: cols.rate.w, align: cols.rate.align });
      doc.text('AMOUNT', cols.amount.x, curY, { width: cols.amount.w, align: cols.amount.align });
      doc.text('DISCOUNT', cols.disc.x, curY, { width: cols.disc.w, align: cols.disc.align });
      doc.text('NET AMOUNT', cols.net.x, curY, { width: cols.net.w, align: cols.net.align });

      curY += 12;
      // Table Header Bottom Rule
      doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(1.2).strokeColor('#000000').stroke();
      curY += 6;

      const items = Array.isArray(invoice.items) && invoice.items.length > 0 ? invoice.items : [];
      let totalGross = 0;
      let totalDisc = 0;
      let totalNet = 0;

      if (items.length === 0) {
        const itemTot = parseFloat(invoice.total || 0);
        totalGross = itemTot;
        totalNet = itemTot;

        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        doc.text('1', cols.sr.x, curY, { width: cols.sr.w, align: 'center' });
        doc.font('Helvetica-Bold').text(invoice.type || 'Standard Invoice Item', cols.desc.x, curY, { width: cols.desc.w });
        doc.font('Helvetica').text('—', cols.code.x, curY, { width: cols.code.w });
        doc.text('1.00', cols.qty.x, curY, { width: cols.qty.w, align: 'center' });
        doc.text(numStr(itemTot), cols.rate.x, curY, { width: cols.rate.w, align: 'right' });
        doc.text(numStr(itemTot), cols.amount.x, curY, { width: cols.amount.w, align: 'right' });
        doc.text('0.00', cols.disc.x, curY, { width: cols.disc.w, align: 'right' });
        doc.font('Helvetica-Bold').text(numStr(itemTot), cols.net.x, curY, { width: cols.net.w, align: 'right' });
        curY += 22;
      } else {
        items.forEach((item, idx) => {
          const qty = parseFloat(item.quantity || 1);
          const rate = parseFloat(item.rate || item.unitPrice || item.unit_price || item.charges || 0);
          const gross = qty * rate;
          const disc = parseFloat(item.discount || 0);
          const net = parseFloat(item.lineTotal || item.line_total || (gross - disc));

          totalGross += gross;
          totalDisc += disc;
          totalNet += net;

          doc.font('Helvetica').fontSize(8).fillColor('#000000');
          doc.text(String(idx + 1), cols.sr.x, curY, { width: cols.sr.w, align: 'center' });

          const itemName = item.name || item.description || 'Product / Item';
          doc.font('Helvetica-Bold').text(itemName, cols.desc.x, curY, { width: cols.desc.w, lineBreak: false, ellipsis: true });

          const hasSubDesc = item.description && item.description !== itemName;
          if (hasSubDesc) {
            doc.font('Helvetica').fontSize(7).fillColor('#4b5563')
              .text(item.description, cols.desc.x, curY + 9, { width: cols.desc.w, lineBreak: false, ellipsis: true });
          }

          doc.font('Helvetica').fontSize(8).fillColor('#000000');
          const itemCode = item.hsCode || item.hs_code || item.productCode || item.code || '—';
          doc.text(itemCode, cols.code.x, curY, { width: cols.code.w, lineBreak: false, ellipsis: true });
          doc.text(qty.toFixed(2), cols.qty.x, curY, { width: cols.qty.w, align: 'center' });
          doc.text(numStr(rate), cols.rate.x, curY, { width: cols.rate.w, align: 'right' });
          doc.text(numStr(gross), cols.amount.x, curY, { width: cols.amount.w, align: 'right' });
          doc.text(numStr(disc), cols.disc.x, curY, { width: cols.disc.w, align: 'right' });
          doc.font('Helvetica-Bold').text(numStr(net), cols.net.x, curY, { width: cols.net.w, align: 'right' });

          curY += hasSubDesc ? 22 : 18;
        });
      }

      // Totals Rs. line under table
      doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(0.75).strokeColor('#000000').stroke();
      curY += 4;

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000')
        .text('Totals Rs.', margin + 350, curY, { width: 120, align: 'right' });
      doc.text(numStr(totalNet || invoice.total), cols.net.x, curY, { width: cols.net.w, align: 'right' });
      curY += 12;

      // Double Underline Under Table Totals (Accounting standard)
      doc.moveTo(margin, curY).lineTo(margin + contentWidth, curY).lineWidth(0.6).strokeColor('#000000').stroke();
      doc.moveTo(margin, curY + 2.5).lineTo(margin + contentWidth, curY + 2.5).lineWidth(0.6).strokeColor('#000000').stroke();
      curY += 14;

      // --- BOTTOM FINANCIAL SECTION ---
      const totalAmount = totalNet > 0 ? totalNet : parseFloat(invoice.total || 0);
      const paidAmount = parseFloat(invoice.paid || 0);
      const balanceAmount = Math.max(0, parseFloat(invoice.balance || (totalAmount - paidAmount)));
      const taxAmount = parseFloat(invoice.taxAmount || invoice.tax_amount || 0);
      const totalExcludingTax = totalGross - totalDisc;

      // Left Column: Amount in Words
      const leftColW = 280;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000').text('Amount in Words :', margin, curY);
      doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(amountInWordsPKR(totalAmount), margin, curY + 12, { width: leftColW });

      if (invoice.remarks) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#374151').text('Remarks:', margin, curY + 36);
        doc.font('Helvetica').fontSize(7.5).fillColor('#4b5563').text(invoice.remarks, margin + 42, curY + 36, { width: leftColW - 42 });
      }

      // Document Verification # (Centered horizontally below Amount in Words)
      const docVerY = curY + 62;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text('Document Verification #', margin + 110, docVerY, { width: 160, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(9.5).text(invNo, margin + 110, docVerY + 11, { width: 160, align: 'center' });

      // Right Column: Bordered Financial Summary Box
      const sumBoxW = 226;
      const sumBoxX = margin + contentWidth - sumBoxW;
      const hasBalance = balanceAmount > 0;
      const sumBoxH = hasBalance ? 104 : 92;

      doc.rect(sumBoxX, curY, sumBoxW, sumBoxH).lineWidth(1.2).strokeColor('#000000').stroke();

      let sumRowY = curY + 6;
      const sumLblX = sumBoxX + 8;
      const sumValX = sumBoxX + 140;
      const sumValW = 78;

      const renderSumRow = (lbl, val, bold = false, underline = false, color = '#000000') => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(color).text(lbl, sumLblX, sumRowY);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(color).text(numStr(val), sumValX, sumRowY, { width: sumValW, align: 'right' });
        sumRowY += 12;
        if (underline) {
          doc.moveTo(sumBoxX, sumRowY - 2).lineTo(sumBoxX + sumBoxW, sumRowY - 2).lineWidth(0.5).strokeColor('#000000').stroke();
        }
      };

      renderSumRow('Gross Amount', totalGross);
      renderSumRow('Discount', totalDisc);
      renderSumRow('Total Excluding Sales Tax Rs.', totalExcludingTax);
      renderSumRow('Sales Tax Rs.', taxAmount, false, true);
      renderSumRow('Total Including Sales Tax Rs.', totalAmount, true);
      renderSumRow('Amount Paid Rs.', paidAmount, true);
      if (hasBalance) {
        renderSumRow('Remaining Balance Rs.', balanceAmount, true, false, '#dc2626');
      }

      // Verification QR Code on far right below summary
      try {
        const qrPayload = JSON.stringify({
          inv: invNo,
          dt: invDate,
          tot: totalAmount,
          party: partyName,
          fbr: invoice.fbrInvoiceNo || undefined
        });
        const qrBuf = await QRCode.toBuffer(qrPayload, { margin: 0, width: 80 });
        doc.image(qrBuf, margin + contentWidth - 68, docVerY - 4, { width: 64, height: 64 });
      } catch (qrErr) {
        console.warn('[InvoicePDF] QR code error:', qrErr.message);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePdf,
  getBusinessSettings,
  getDocumentTitle,
  amountInWordsPKR
};
