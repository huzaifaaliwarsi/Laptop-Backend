const db = require('../../config/db');
const { getNextEntityId } = require('../../utils/codeGenerator');
const { emitEvent } = require('../../config/socket');
const baileys = require('../whatsapp/baileys.service');
const { generateInvoicePdf, getBusinessSettings } = require('./invoice-pdf.service');

function numStr(val) {
  const n = parseFloat(val || 0);
  return n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateStr(d) {
  if (!d) return '—';
  try {
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return String(d);
    return dateObj.toISOString().split('T')[0];
  } catch (e) {
    return String(d);
  }
}

class InvoiceWhatsAppService {
  /**
   * Main method to generate PDF and dispatch via WhatsApp (Baileys) + log into WhatsApp CRM
   * @param {string|Object} invoiceIdOrObj - Invoice ID or full invoice object
   * @param {Object} [options] - Optional settings (branchId, customNote)
   */
  static async sendInvoiceWhatsApp(invoiceIdOrObj, options = {}) {
    try {
      const InvoiceService = require('./invoices.service');
      let invoice = invoiceIdOrObj;

      // If only ID passed or items array missing, fetch complete invoice
      if (typeof invoiceIdOrObj === 'string' || !invoice?.items) {
        const id = typeof invoiceIdOrObj === 'string' ? invoiceIdOrObj : (invoiceIdOrObj?.id || invoiceIdOrObj?.invoice_no);
        invoice = await InvoiceService.getInvoiceById(id);
      }

      if (!invoice) {
        console.warn('[InvoiceWhatsApp] Invoice not found for WhatsApp dispatch:', invoiceIdOrObj);
        return { success: false, reason: 'invoice_not_found' };
      }

      // 1. Resolve contact number (from invoice, customer table, or vendor table)
      let rawContact = invoice.contact;
      if (!rawContact && invoice.partyId) {
        try {
          if (invoice.partyType === 'Vendor' || invoice.type === 'Vendor Purchase') {
            const vRes = await db.query('SELECT contact, phone FROM vendors WHERE id = $1', [invoice.partyId]);
            if (vRes.rows.length > 0) rawContact = vRes.rows[0].contact || vRes.rows[0].phone;
          } else {
            const cRes = await db.query('SELECT contact, phone FROM customers WHERE id = $1', [invoice.partyId]);
            if (cRes.rows.length > 0) rawContact = cRes.rows[0].contact || cRes.rows[0].phone;
          }
        } catch (e) {
          console.warn('[InvoiceWhatsApp] Error looking up contact for party:', e.message);
        }
      }

      const cleanDigits = String(rawContact || '').replace(/[^0-9]/g, '');
      if (!cleanDigits || cleanDigits.length < 8) {
        console.log(`[InvoiceWhatsApp] Invoice #${invoice.invoiceNo || invoice.id} has no valid contact phone number ("${rawContact}"). Skipping WhatsApp.`);
        return { success: false, reason: 'no_contact_phone', message: 'No valid phone number for party' };
      }

      // If triggered automatically on invoice creation, verify setting is enabled
      if (!options.isManual) {
        try {
          const sRes = await db.query('SELECT auto_invoice_whatsapp FROM whatsapp_settings WHERE id = 1');
          if (sRes.rows.length > 0 && sRes.rows[0].auto_invoice_whatsapp === false) {
            console.log('[InvoiceWhatsApp] Auto invoice WhatsApp notifications disabled in settings. Skipping.');
            return { success: false, reason: 'auto_disabled_in_settings' };
          }
        } catch (e) {}
      }

      const branding = await getBusinessSettings();
      const branchId = parseInt(options.branchId || invoice.branchId || 1, 10) || 1;

      // 2. Generate PDF in-memory buffer
      const pdfBuffer = await generateInvoicePdf(invoice);
      const fileName = `Invoice-${invoice.invoiceNo || invoice.id}.pdf`;

      // 3. Build WhatsApp caption text
      const invTitle = invoice.type || 'Sales Invoice';
      const partyLabel = invoice.partyType === 'Vendor' || invoice.type === 'Vendor Purchase' ? 'Vendor' : 'Customer';
      const total = parseFloat(invoice.total || 0);
      const paid = parseFloat(invoice.paid || 0);
      const balance = Math.max(0, parseFloat(invoice.balance || 0));
      const payStatus = (invoice.paymentStatus || (balance <= 0 ? 'Paid' : 'Unpaid')).toUpperCase();

      const lines = [
        `📄 *${invTitle.toUpperCase()}* #${invoice.invoiceNo || invoice.id}`,
        `🏢 *${branding.company_name || 'Retail & Repair Management'}*`,
        '',
        `👤 *${partyLabel}:* ${invoice.partyName || 'Valued Customer'}`,
        `📅 *Date:* ${formatDateStr(invoice.date)}`,
        `💳 *Payment:* ${invoice.paymentMethod || 'Cash'} [${payStatus}]`,
        '',
        `💰 *Total:* PKR ${numStr(total)}`,
        `💵 *Paid:* PKR ${numStr(paid)}`,
        balance > 0 ? `⚠️ *Balance Due:* PKR ${numStr(balance)}` : `✅ *Balance:* Fully Settled`
      ];

      if (options.customNote) {
        lines.push('');
        lines.push(`📝 *Note:* ${options.customNote}`);
      }

      lines.push('');
      lines.push('📎 *Official PDF invoice attached above.*');
      lines.push(`Thank you for choosing ${branding.company_name || 'us'}!`);

      const captionText = lines.join('\n');

      // 4. Log in WhatsApp CRM (whatsapp_conversations & whatsapp_messages)
      try {
        let convId = null;
        const convRes = await db.query('SELECT id FROM whatsapp_conversations WHERE contact = $1', [rawContact]);
        if (convRes.rows.length > 0) {
          convId = convRes.rows[0].id;
        } else {
          convId = await getNextEntityId('whatsapp_conversations', 'id', 'CONV', 4);
          await db.query(
            `INSERT INTO whatsapp_conversations (id, contact, name, status, lead_type)
             VALUES ($1, $2, $3, 'Bot Active', 'Invoice Notification')`,
            [convId, rawContact, invoice.partyName || 'Customer / Vendor']
          );
        }

        const logMsg = `[PDF Document: ${fileName}]\n${captionText}`;
        await db.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, text, tag)
           VALUES ($1, 'out', $2, 'invoice')`,
          [convId, logMsg]
        );

        await db.query(
          `UPDATE whatsapp_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [logMsg, convId]
        );

        emitEvent('whatsapp.message_added', {
          conversationId: convId,
          text: logMsg,
          tag: 'invoice'
        });
      } catch (crmErr) {
        console.warn('[InvoiceWhatsApp] CRM history log warning:', crmErr.message);
      }

      // 5. Send live document via Baileys if WhatsApp is connected
      const isConnected = baileys.isBranchConnected(branchId) || baileys.isConnected;
      if (!isConnected) {
        console.log(`[InvoiceWhatsApp] WhatsApp device not currently connected for Branch ${branchId}. Invoice logged in CRM.`);
        return {
          success: true,
          delivered: false,
          wa_not_connected: true,
          contact: rawContact,
          message: 'Invoice logged in CRM, but WhatsApp device is not connected.'
        };
      }

      await baileys.sendDocumentMessage(branchId, rawContact, pdfBuffer, fileName, captionText);
      console.log(`[InvoiceWhatsApp] ✅ Successfully sent Invoice #${invoice.invoiceNo} PDF to ${rawContact} via WhatsApp!`);

      return {
        success: true,
        delivered: true,
        contact: rawContact,
        fileName,
        message: `Invoice PDF successfully sent to ${rawContact}`
      };
    } catch (err) {
      console.error('[InvoiceWhatsApp] Error sending invoice on WhatsApp:', err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = InvoiceWhatsAppService;
