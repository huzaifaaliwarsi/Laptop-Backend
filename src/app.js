const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./modules/auth/auth.routes');
const staffRoutes = require('./modules/staff/staff.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const customersRoutes = require('./modules/customers/customers.routes');
const vendorsRoutes = require('./modules/vendors/vendors.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const invoiceRoutes = require('./modules/invoices/invoices.routes');
const accountsRoutes = require('./modules/accounts/accounts.routes');
const ledgerRoutes = require('./modules/ledger/ledger.routes');
const expensesRoutes = require('./modules/expenses/expenses.routes');
const repairServicesRoutes = require('./modules/repair-services/repair-services.routes');
const repairsRoutes = require('./modules/repairs/repairs.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const whatsappRoutes = require('./modules/whatsapp/whatsapp.routes');

const app = express();

// Hybrid CORS: Allow localhost, local network, Vercel preview/production URLs, and configured CORS_ORIGIN
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server, mobile, or requests without Origin header
    if (!origin) return callback(null, true);

    const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin) ||
                    /^http:\/\/192\.168\.[0-9]+\.[0-9]+(:[0-9]+)?$/.test(origin);
    const isVercel = /\.vercel\.app$/.test(origin);
    const isConfigured = process.env.CORS_ORIGIN && (
      process.env.CORS_ORIGIN === '*' ||
      process.env.CORS_ORIGIN.split(',').map(s => s.trim()).includes(origin)
    );

    if (isLocal || isVercel || isConfigured || !process.env.CORS_ORIGIN) {
      return callback(null, true);
    }
    return callback(null, true); // Permissive fallback for smooth deployment
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/products', inventoryRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/pos', invoiceRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/repair-services', repairServicesRoutes);
app.use('/api/repairs', repairsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Retail & Repair Management API'
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;
