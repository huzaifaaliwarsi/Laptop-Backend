/**
 * WhatsApp Repair Notification Templates
 * Centralized, professional, clean templates with minimal standard icons:
 * 🔧 repair | 📱 device | 📋 status | 💳 payment | ✅ approval
 *
 * Strictly avoids:
 * - Excessive decorative borders/separators
 * - Internal tech notes, COGS, cost prices, or profit margins
 */

function formatMoney(amount) {
  const num = parseFloat(amount || 0);
  return 'PKR ' + num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateVal) {
  if (!dateVal) return null;
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal).trim() || null;
    return d.toISOString().split('T')[0];
  } catch (e) {
    return String(dateVal).trim() || null;
  }
}

function formatDevice(job) {
  if (!job) return 'Laptop / Device';
  const brand = (job.brand || '').trim();
  const model = (job.model || job.product_name || '').trim();
  const type = (job.product_type || '').trim();
  const serial = (job.serial || '').trim();

  const nameParts = [brand, model].filter(Boolean);
  let devName = nameParts.length > 0 ? nameParts.join(' ') : type || 'Laptop / Device';
  if (serial) {
    devName += ` (S/N: ${serial})`;
  }
  return devName;
}

/**
 * 1. SERVICE / DIAGNOSIS JOB INTAKE CONFIRMATION
 * Sent immediately after intake creation.
 */
function buildIntakeConfirmationTemplate({ job, requestedService = '', isDiagnosis = false }) {
  const trackingId = job.tracking_id || job.id;
  const device = formatDevice(job);
  const status = job.status || (isDiagnosis ? 'Diagnosis Received' : 'Job Received');
  const expected = formatDate(job.expected_completion) || (job.duration ? String(job.duration).trim() : null);

  const serviceName = requestedService || (
    isDiagnosis
      ? 'Diagnostic Inspection & Fault Analysis'
      : (job.problem || 'Standard Hardware Service')
  );

  const lines = [
    isDiagnosis ? '🔧 Diagnosis Order Received' : '🔧 Repair Order Confirmed',
    '',
    `📋 Tracking ID: ${trackingId}`,
    `📱 Device: ${device}`,
    `🔧 Requested Service: ${serviceName}`,
    `📋 Status: ${status}`
  ];

  if (expected) {
    lines.push(`📅 Expected Completion: ${expected}`);
  }

  lines.push('');
  lines.push(`Send ${trackingId} anytime for live status.`);

  return lines.join('\n');
}

/**
 * 2. LIVE TRACKING RESPONSE
 * Returned when customer sends Tracking ID (e.g. RPR-00001).
 * Strictly contains only customer-safe data from PostgreSQL.
 */
function buildTrackingResponseTemplate({ job, safeNote = '' }) {
  const trackingId = job.tracking_id || job.id;
  const device = formatDevice(job);
  const status = job.status || 'In Progress';
  const expected = formatDate(job.expected_completion) || 'In Progress';

  const total = parseFloat(job.total || 0);
  const paid = parseFloat(job.paid || 0);
  const balance = Math.max(0, total - paid);

  const lines = [
    '🔧 Repair Tracking Status',
    '',
    `📋 Tracking ID: ${trackingId}`,
    `📱 Device: ${device}`,
    `📋 Status: ${status}`,
    `📅 Expected Completion: ${expected}`,
    `💳 Total: ${formatMoney(total)}`,
    `💳 Paid: ${formatMoney(paid)}`,
    `💳 Balance: ${formatMoney(balance)}`
  ];

  // Latest customer-safe note (final_remarks / public note, NOT internal technical bench notes)
  const noteToShow = safeNote || job.final_remarks;
  if (noteToShow && String(noteToShow).trim() !== '') {
    lines.push(`📋 Note: ${String(noteToShow).trim()}`);
  }

  // If waiting for customer approval, provide actionable prompts
  if (status === 'Waiting for Customer Approval') {
    const quoteAmt = parseFloat(job.quotation_amount || 0);
    lines.push('');
    lines.push('✅ Approval Required:');
    if (quoteAmt > 0) {
      lines.push(`💳 Estimated Cost: ${formatMoney(quoteAmt)}`);
    }
    lines.push('Reply 1 or APPROVE to proceed.');
    lines.push('Reply 2 or DECLINE to cancel.');
  }

  return lines.join('\n');
}

/**
 * 3. GENERAL STATUS UPDATE NOTIFICATION
 * Sent when technician or admin updates status on workbench.
 */
function buildStatusUpdateTemplate({ job, safeNote = '' }) {
  const trackingId = job.tracking_id || job.id;
  const device = formatDevice(job);
  const status = job.status || 'In Progress';
  const expected = formatDate(job.expected_completion);

  const total = parseFloat(job.total || 0);
  const paid = parseFloat(job.paid || 0);
  const balance = Math.max(0, total - paid);

  const lines = [
    '📋 Repair Status Update',
    '',
    `📋 Tracking ID: ${trackingId}`,
    `📱 Device: ${device}`,
    `📋 Status: ${status}`
  ];

  if (expected) {
    lines.push(`📅 Expected Completion: ${expected}`);
  }

  lines.push(`💳 Total: ${formatMoney(total)}`);
  lines.push(`💳 Paid: ${formatMoney(paid)}`);
  lines.push(`💳 Balance: ${formatMoney(balance)}`);

  const noteToShow = safeNote || job.final_remarks;
  if (noteToShow && String(noteToShow).trim() !== '') {
    lines.push(`📋 Note: ${String(noteToShow).trim()}`);
  }

  lines.push('');
  lines.push(`Send ${trackingId} anytime for live status.`);

  return lines.join('\n');
}

/**
 * 4. QUOTATION APPROVAL REQUEST TEMPLATE
 */
function buildQuotationApprovalTemplate(job) {
  const trackingId = job.tracking_id || job.id;
  const quoteAmt = parseFloat(job.quotation_amount || 0);

  const lines = [
    '🔧 *Repair Approval Required*',
    '',
    `*Repair:* ${trackingId}`,
    ''
  ];

  if (job.diagnosed_issue) {
    lines.push(`*Diagnosis:* ${job.diagnosed_issue.trim()}`);
  }
  if (job.recommended_solution) {
    lines.push(`*Recommended Repair:* ${job.recommended_solution.trim()}`);
  }

  lines.push(`*Quoted Amount:* ${formatMoney(quoteAmt)}`);

  if (job.final_remarks && String(job.final_remarks).trim()) {
    lines.push(`*Note:* ${String(job.final_remarks).trim()}`);
  }

  lines.push('');
  lines.push('Reply:');
  lines.push('*1* — Approve Repair');
  lines.push('*2* — Decline Repair');

  return lines.join('\n');
}

/**
 * 5. QUOTATION APPROVED CONFIRMATION
 */
function buildApprovalConfirmationTemplate(job) {
  const trackingId = job.tracking_id || job.id;
  const quoteAmt = parseFloat(job.quotation_amount || 0);

  const lines = [
    '✅ *Repair Approved*',
    '',
    `*Repair:* ${trackingId}`,
    '*Status:* Repair Approved'
  ];

  if (job.recommended_solution) {
    lines.push(`*Approved Repair:* ${job.recommended_solution.trim()}`);
  }
  if (quoteAmt > 0) {
    lines.push(`*Quoted Amount:* ${formatMoney(quoteAmt)}`);
  }

  lines.push('');
  lines.push('Our technician has started the repair work. Original quotation is now queued.');

  return lines.join('\n');
}

/**
 * 6. QUOTATION DECLINED CONFIRMATION
 */
function buildDeclineConfirmationTemplate(job) {
  const trackingId = job.tracking_id || job.id;

  const lines = [
    '📋 *Repair Declined*',
    '',
    `*Repair:* ${trackingId}`,
    '*Status:* Repair Declined',
    '',
    'Repair work has been cancelled. Only diagnostic inspection charges (if applicable) apply.'
  ];

  return lines.join('\n');
}

/**
 * 7. PAYMENT RECEIPT / ADVANCE NOTIFICATION
 */
function buildPaymentReceiptTemplate({ job, amountPaid = 0, newBalance = 0 }) {
  const trackingId = job.tracking_id || job.id;
  const device = formatDevice(job);
  const total = parseFloat(job.total || 0);

  const lines = [
    '💳 Payment Received',
    '',
    `📋 Tracking ID: ${trackingId}`,
    `📱 Device: ${device}`,
    `💳 Amount Paid: ${formatMoney(amountPaid)}`,
    `💳 Total Bill: ${formatMoney(total)}`,
    `💳 Balance Due: ${formatMoney(newBalance)}`,
    '',
    `Send ${trackingId} anytime for live status.`
  ];

  return lines.join('\n');
}

/**
 * 8. DELIVERY & CLOSURE NOTIFICATION
 */
function buildDeliveryClosedTemplate(job) {
  const trackingId = job.tracking_id || job.id;
  const device = formatDevice(job);
  const total = parseFloat(job.total || 0);

  const lines = [
    '✅ Device Delivered',
    '',
    `📋 Tracking ID: ${trackingId}`,
    `📱 Device: ${device}`,
    `📋 Status: Delivered & Closed`,
    `💳 Total Paid: ${formatMoney(total)}`,
    `💳 Balance: PKR 0.00`,
    '',
    'Thank you for choosing our service!'
  ];

  return lines.join('\n');
}

/**
 * 9. ADDITIONAL WORK / FAULT APPROVAL REQUEST TEMPLATE
 */
function buildAdditionalWorkApprovalTemplate({ job, workRequest }) {
  const trackingId = job.tracking_id || job.id;
  const totalAdditionalCost = parseFloat(workRequest.total_quotation || (parseFloat(workRequest.service_charge || 0) + parseFloat(workRequest.parts_charge || 0)));

  const lines = [
    '🔧 *Additional Repair Approval*',
    '',
    `*Repair:* ${trackingId}`,
    'Our technician found an additional issue:',
    '',
    `*Issue:* ${workRequest.fault_finding || 'Additional hardware fault'}`,
    `*Recommended:* ${workRequest.recommended_service || 'Component replacement / repair'}`,
    `*Additional Cost:* ${formatMoney(totalAdditionalCost)}`
  ];

  if (workRequest.customer_safe_note && String(workRequest.customer_safe_note).trim()) {
    lines.push(`*Note:* ${String(workRequest.customer_safe_note).trim()}`);
  }

  lines.push('');
  lines.push('Reply:');
  lines.push('*1* — Approve');
  lines.push('*2* — Decline');

  return lines.join('\n');
}

/**
 * 10. ADDITIONAL WORK APPROVED CONFIRMATION
 */
function buildAdditionalWorkApprovedTemplate({ job, workRequest }) {
  const trackingId = job.tracking_id || job.id;
  const totalAdditionalCost = parseFloat(workRequest.total_quotation || (parseFloat(workRequest.service_charge || 0) + parseFloat(workRequest.parts_charge || 0)));

  const lines = [
    '✅ *Additional Work Approved*',
    '',
    `*Repair:* ${trackingId}`,
    `*Approved Work:* ${workRequest.recommended_service || 'Additional Repair Work'}`,
    `*Additional Cost:* ${formatMoney(totalAdditionalCost)}`,
    '',
    'Our technician has queued the additional work. Original and approved repair will proceed.'
  ];

  return lines.join('\n');
}

/**
 * 11. ADDITIONAL WORK DECLINED CONFIRMATION
 */
function buildAdditionalWorkDeclinedTemplate({ job, workRequest }) {
  const trackingId = job.tracking_id || job.id;

  const lines = [
    '📋 *Additional Work Declined*',
    '',
    `*Repair:* ${trackingId}`,
    `*Declined Work:* ${workRequest.recommended_service || 'Additional Repair Work'}`,
    '',
    'No additional charges have been added. Original repair will continue normally.'
  ];

  return lines.join('\n');
}

module.exports = {
  formatMoney,
  formatDate,
  formatDevice,
  buildIntakeConfirmationTemplate,
  buildTrackingResponseTemplate,
  buildStatusUpdateTemplate,
  buildQuotationApprovalTemplate,
  buildApprovalConfirmationTemplate,
  buildDeclineConfirmationTemplate,
  buildPaymentReceiptTemplate,
  buildDeliveryClosedTemplate,
  buildAdditionalWorkApprovalTemplate,
  buildAdditionalWorkApprovedTemplate,
  buildAdditionalWorkDeclinedTemplate
};
