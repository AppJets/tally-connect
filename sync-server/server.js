const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
// Use Railway's injected PORT in production; fall back to 3600 for local dev.
const PORT = process.env.PORT || 3600;

// Valid API credentials
const VALID_API_KEY = 'ltk_3a0d801c8d324153b0619f3f79685dea';
const VALID_API_SECRET = 'lts_832211a2e822415fb6756383bb84cc89aeb6c453ac424abd938aa150d9faa8e5';

// In-memory data storage
const dataStore = {
  companies: new Map(),    // key: companyGuid, value: company info
  ledgers: new Map(),      // key: companyGuid, value: array of ledgers
  vouchers: new Map(),     // key: companyGuid, value: array of vouchers
  syncHistory: [],         // array of sync events
  connectedUsers: new Map() // key: uniqueId, value: user info
};

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3003',
    'http://localhost:8001',
    'http://localhost:8003',
    'http://localhost:8008',
    'https://lexai-crm-fe.vercel.app',
    'https://lexai-admin-fe.vercel.app',
    'https://lexorigin.com',
    'https://www.lexorigin.com',
    'https://lexorigin.in',
    'https://www.lexorigin.in',
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Verify API Key
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API Key' });
  }

  if (apiKey !== VALID_API_KEY) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  next();
}

// Verify HMAC Signature
function verifySignature(req, res, next) {
  const signature = req.headers['x-signature'];
  const payload = req.body;

  if (!signature) {
    return res.status(401).json({ error: 'Missing Signature' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', VALID_API_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');

  if (signature !== expectedSignature) {
    console.log('Signature mismatch:');
    console.log('  Received:', signature);
    console.log('  Expected:', expectedSignature);
    return res.status(401).json({ error: 'Invalid Signature' });
  }

  next();
}

// Health check endpoint
app.get('/api/v1/health', verifyApiKey, (req, res) => {
  console.log('Health check - API Key verified');
  res.json({
    status: 'ok',
    message: 'LexOrigin Sync Server is running',
    timestamp: new Date().toISOString()
  });
});

// Sync data endpoint
app.post('/api/v1/sync/data', verifyApiKey, verifySignature, (req, res) => {
  const { company, ledgers, vouchers, syncedAt, deviceId } = req.body;

  const companyGuid = company?.guid || 'unknown';
  const companyName = company?.name || 'Unknown Company';

  // Store company info
  dataStore.companies.set(companyGuid, {
    guid: companyGuid,
    name: companyName,
    email: company?.email || null,
    startDate: company?.startDate || null,
    lastSyncAt: syncedAt,
    firstSyncAt: dataStore.companies.get(companyGuid)?.firstSyncAt || syncedAt,
    syncCount: (dataStore.companies.get(companyGuid)?.syncCount || 0) + 1
  });

  // Store ledgers (replace with latest)
  if (ledgers && ledgers.length > 0) {
    dataStore.ledgers.set(companyGuid, ledgers.map((l, index) => ({
      id: `${companyGuid}-ledger-${index}`,
      companyGuid,
      name: l.name || 'Unknown',
      parent: l.parent || null,
      openingBalance: parseFloat(l.openingBalance) || 0,
      closingBalance: parseFloat(l.closingBalance) || 0,
      guid: l.guid || null,
      syncedAt
    })));
  }

  // Store vouchers (replace with latest)
  if (vouchers && vouchers.length > 0) {
    dataStore.vouchers.set(companyGuid, vouchers.map((v, index) => ({
      id: `${companyGuid}-voucher-${index}`,
      companyGuid,
      voucherNumber: v.voucherNumber || null,
      date: v.date || null,
      voucherType: v.voucherType || null,
      amount: parseFloat(v.amount) || 0,
      partyName: v.partyName || null,
      guid: v.guid || null,
      syncedAt
    })));
  }

  // Track connected user
  const userId = deviceId || companyGuid;
  dataStore.connectedUsers.set(userId, {
    userId,
    deviceId: deviceId || 'unknown',
    companyName,
    companyGuid,
    lastSyncAt: new Date().toISOString(),
    firstConnectedAt: dataStore.connectedUsers.get(userId)?.firstConnectedAt || new Date().toISOString(),
    syncCount: (dataStore.connectedUsers.get(userId)?.syncCount || 0) + 1,
    lastLedgersCount: ledgers?.length || 0,
    lastVouchersCount: vouchers?.length || 0,
    ipAddress: req.ip || req.connection?.remoteAddress || 'unknown'
  });

  // Add to sync history
  dataStore.syncHistory.unshift({
    id: `sync-${Date.now()}`,
    companyGuid,
    companyName,
    deviceId,
    ledgersCount: ledgers?.length || 0,
    vouchersCount: vouchers?.length || 0,
    syncedAt: new Date().toISOString(),
    ipAddress: req.ip || req.connection?.remoteAddress || 'unknown'
  });

  // Keep only last 100 sync events
  if (dataStore.syncHistory.length > 100) {
    dataStore.syncHistory = dataStore.syncHistory.slice(0, 100);
  }

  console.log('\n========== SYNC DATA RECEIVED ==========');
  console.log('Company:', companyName);
  console.log('GUID:', companyGuid);
  console.log('Ledgers:', ledgers?.length || 0);
  console.log('Vouchers:', vouchers?.length || 0);
  console.log('Synced At:', syncedAt);
  console.log('Total Companies:', dataStore.companies.size);
  console.log('=========================================\n');

  res.json({
    success: true,
    message: 'Data synced successfully',
    received: {
      company: companyName,
      ledgersCount: ledgers?.length || 0,
      vouchersCount: vouchers?.length || 0
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== DATA RETRIEVAL APIs ====================

// Get all companies
app.get('/api/v1/companies', verifyApiKey, (req, res) => {
  const companies = Array.from(dataStore.companies.values());
  res.json({
    success: true,
    data: companies,
    total: companies.length,
    timestamp: new Date().toISOString()
  });
});

// Get company by GUID
app.get('/api/v1/companies/:guid', verifyApiKey, (req, res) => {
  const company = dataStore.companies.get(req.params.guid);
  if (!company) {
    return res.status(404).json({ success: false, error: 'Company not found' });
  }
  res.json({
    success: true,
    data: company,
    timestamp: new Date().toISOString()
  });
});

// Get ledgers (all or by company)
app.get('/api/v1/ledgers', verifyApiKey, (req, res) => {
  const { companyGuid, search, parent, page = 1, limit = 50 } = req.query;

  let allLedgers = [];

  if (companyGuid) {
    allLedgers = dataStore.ledgers.get(companyGuid) || [];
  } else {
    // Get ledgers from all companies
    for (const ledgers of dataStore.ledgers.values()) {
      allLedgers = allLedgers.concat(ledgers);
    }
  }

  // Filter by search term
  if (search) {
    const searchLower = search.toLowerCase();
    allLedgers = allLedgers.filter(l =>
      l.name.toLowerCase().includes(searchLower) ||
      (l.parent && l.parent.toLowerCase().includes(searchLower))
    );
  }

  // Filter by parent group
  if (parent) {
    allLedgers = allLedgers.filter(l => l.parent === parent);
  }

  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const paginatedLedgers = allLedgers.slice(startIndex, startIndex + parseInt(limit));

  res.json({
    success: true,
    data: paginatedLedgers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: allLedgers.length,
      totalPages: Math.ceil(allLedgers.length / parseInt(limit))
    },
    timestamp: new Date().toISOString()
  });
});

// Get vouchers (all or by company)
app.get('/api/v1/vouchers', verifyApiKey, (req, res) => {
  const { companyGuid, search, voucherType, startDate, endDate, page = 1, limit = 50 } = req.query;

  let allVouchers = [];

  if (companyGuid) {
    allVouchers = dataStore.vouchers.get(companyGuid) || [];
  } else {
    // Get vouchers from all companies
    for (const vouchers of dataStore.vouchers.values()) {
      allVouchers = allVouchers.concat(vouchers);
    }
  }

  // Filter by search term
  if (search) {
    const searchLower = search.toLowerCase();
    allVouchers = allVouchers.filter(v =>
      (v.voucherNumber && v.voucherNumber.toLowerCase().includes(searchLower)) ||
      (v.partyName && v.partyName.toLowerCase().includes(searchLower))
    );
  }

  // Filter by voucher type
  if (voucherType) {
    allVouchers = allVouchers.filter(v => v.voucherType === voucherType);
  }

  // Filter by date range
  if (startDate) {
    allVouchers = allVouchers.filter(v => v.date >= startDate);
  }
  if (endDate) {
    allVouchers = allVouchers.filter(v => v.date <= endDate);
  }

  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const paginatedVouchers = allVouchers.slice(startIndex, startIndex + parseInt(limit));

  res.json({
    success: true,
    data: paginatedVouchers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: allVouchers.length,
      totalPages: Math.ceil(allVouchers.length / parseInt(limit))
    },
    timestamp: new Date().toISOString()
  });
});

// Get sync history
app.get('/api/v1/sync/history', verifyApiKey, (req, res) => {
  const { limit = 20 } = req.query;
  const history = dataStore.syncHistory.slice(0, parseInt(limit));

  res.json({
    success: true,
    data: history,
    total: dataStore.syncHistory.length,
    timestamp: new Date().toISOString()
  });
});

// Get dashboard stats
app.get('/api/v1/stats', verifyApiKey, (req, res) => {
  const companies = Array.from(dataStore.companies.values());
  let totalLedgers = 0;
  let totalVouchers = 0;

  for (const ledgers of dataStore.ledgers.values()) {
    totalLedgers += ledgers.length;
  }
  for (const vouchers of dataStore.vouchers.values()) {
    totalVouchers += vouchers.length;
  }

  // Calculate total balance from ledgers
  let totalBalance = 0;
  for (const ledgers of dataStore.ledgers.values()) {
    for (const ledger of ledgers) {
      totalBalance += ledger.closingBalance || 0;
    }
  }

  res.json({
    success: true,
    data: {
      companiesCount: companies.length,
      ledgersCount: totalLedgers,
      vouchersCount: totalVouchers,
      totalBalance,
      connectedUsersCount: dataStore.connectedUsers.size,
      lastSyncAt: dataStore.syncHistory[0]?.syncedAt || null,
      totalSyncs: dataStore.syncHistory.length
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== USER TRACKING APIs ====================

// Get connected users count
app.get('/api/v1/users/count', verifyApiKey, (req, res) => {
  res.json({
    success: true,
    totalConnectedUsers: dataStore.connectedUsers.size,
    timestamp: new Date().toISOString()
  });
});

// Get all connected users list
app.get('/api/v1/users', verifyApiKey, (req, res) => {
  const users = Array.from(dataStore.connectedUsers.values());
  res.json({
    success: true,
    totalConnectedUsers: dataStore.connectedUsers.size,
    users: users,
    timestamp: new Date().toISOString()
  });
});

// Get active users (synced in last N minutes, default 30)
app.get('/api/v1/users/active', verifyApiKey, (req, res) => {
  const minutes = parseInt(req.query.minutes) || 30;
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const activeUsers = Array.from(dataStore.connectedUsers.values()).filter(user => {
    return new Date(user.lastSyncAt) >= cutoff;
  });

  res.json({
    success: true,
    activeMinutes: minutes,
    totalActiveUsers: activeUsers.length,
    totalConnectedUsers: dataStore.connectedUsers.size,
    users: activeUsers,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'LexOrigin Tally Sync Server',
    version: '2.0.0',
    stats: {
      companies: dataStore.companies.size,
      connectedUsers: dataStore.connectedUsers.size,
      totalSyncs: dataStore.syncHistory.length
    },
    endpoints: {
      health: 'GET /api/v1/health',
      sync: 'POST /api/v1/sync/data',
      companies: 'GET /api/v1/companies',
      ledgers: 'GET /api/v1/ledgers',
      vouchers: 'GET /api/v1/vouchers',
      stats: 'GET /api/v1/stats',
      syncHistory: 'GET /api/v1/sync/history',
      users: 'GET /api/v1/users',
      activeUsers: 'GET /api/v1/users/active'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  LexOrigin Tally Sync Server v2.0`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`========================================`);
  console.log(`\nData Endpoints:`);
  console.log(`  GET  /api/v1/companies     - List all companies`);
  console.log(`  GET  /api/v1/ledgers       - List ledgers (with filters)`);
  console.log(`  GET  /api/v1/vouchers      - List vouchers (with filters)`);
  console.log(`  GET  /api/v1/stats         - Dashboard statistics`);
  console.log(`  GET  /api/v1/sync/history  - Sync history`);
  console.log(`\nSync Endpoints:`);
  console.log(`  POST /api/v1/sync/data     - Receive sync data`);
  console.log(`  GET  /api/v1/health        - Health check`);
  console.log(`\nUser Endpoints:`);
  console.log(`  GET  /api/v1/users         - Connected users`);
  console.log(`  GET  /api/v1/users/active  - Active users`);
  console.log(`\nWaiting for connections...\n`);
});
