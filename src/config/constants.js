module.exports = {
  ROLES: {
    ADMIN: 'admin',
    SALES: 'sales',
    TECHNICIAN: 'technician'
  },
  PAYMENT_METHODS: {
    CASH: 'Cash',
    ONLINE: 'Online',
    EXCHANGE_CREDIT: 'Exchange Credit',
    VENDOR_ADJUSTMENT: 'Vendor Adjustment',
    STORE_CREDIT: 'Store Credit'
  },
  INVOICE_TYPES: {
    SALES: 'Sales Invoice',
    VENDOR_PURCHASE: 'Vendor Purchase',
    CUSTOMER_PURCHASE: 'Customer Purchase',
    EXCHANGE: 'Exchange Invoice',
    REPAIR: 'Repair Invoice',
    DIAGNOSIS: 'Diagnosis Invoice'
  },
  JOB_TYPES: {
    SERVICE: 'Service Job',
    DIAGNOSIS: 'Diagnosis Job'
  },
  REPAIR_STATUSES: [
    'Received',
    'Checking',
    'Waiting for Approval',
    'Repair Approved',
    'Work in Progress',
    'Waiting for Part',
    'Ready for Delivery',
    'Delivered & Closed',
    'Repair Declined',
    'Returned Without Repair',
    'Cancelled'
  ],
  PRODUCT_CONDITIONS: ['New', 'Used', 'Refurbished'],
  PRIORITIES: ['Normal', 'High', 'Urgent'],
  ACCOUNT_TYPES: {
    CUSTOMER_RECEIVABLE: 'Customer Receivable',
    CUSTOMER_PAYABLE: 'Customer Payable',
    VENDOR_PAYABLE: 'Vendor Payable',
    VENDOR_RECEIVABLE: 'Vendor Receivable'
  }
};
