const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3600;

// Valid API credentials
const VALID_API_KEY = 'ltk_3a0d801c8d324153b0619f3f79685dea';
const VALID_API_SECRET = 'lts_832211a2e822415fb6756383bb84cc89aeb6c453ac424abd938aa150d9faa8e5';

// Connected users tracking
const connectedUsers = new Map(); // key: uniqueId, value: user info

// Middleware
app.use(cors());
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

  // Track connected user
  const userId = deviceId || company?.guid || req.headers['x-api-key'];
  if (userId) {
    connectedUsers.set(userId, {
      userId,
      deviceId: deviceId || 'unknown',
      companyName: company?.name || 'Unknown',
      companyGuid: company?.guid || 'N/A',
      lastSyncAt: new Date().toISOString(),
      firstConnectedAt: connectedUsers.get(userId)?.firstConnectedAt || new Date().toISOString(),
      syncCount: (connectedUsers.get(userId)?.syncCount || 0) + 1,
      lastLedgersCount: ledgers?.length || 0,
      lastVouchersCount: vouchers?.length || 0,
      ipAddress: req.ip || req.connection?.remoteAddress || 'unknown'
    });
  }

  console.log('\n========== SYNC DATA RECEIVED ==========');
  console.log('Company:', company?.name || 'Unknown');
  console.log('GUID:', company?.guid || 'N/A');
  console.log('Ledgers:', ledgers?.length || 0);
  console.log('Vouchers:', vouchers?.length || 0);
  console.log('Synced At:', syncedAt);
  console.log('Connected Users:', connectedUsers.size);
  console.log('=========================================\n');

  // Log sample data
  if (ledgers && ledgers.length > 0) {
    console.log('Sample Ledgers (first 5):');
    ledgers.slice(0, 5).forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.name} (${l.parent}) - Balance: ${l.closingBalance}`);
    });
  }

  if (vouchers && vouchers.length > 0) {
    console.log('Sample Vouchers (first 5):');
    vouchers.slice(0, 5).forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.voucherNumber} - ${v.voucherType} - ${v.amount}`);
    });
  }

  res.json({
    success: true,
    message: 'Data synced successfully',
    received: {
      company: company?.name,
      ledgersCount: ledgers?.length || 0,
      vouchersCount: vouchers?.length || 0
    },
    timestamp: new Date().toISOString()
  });
});

// Get connected users count
app.get('/api/v1/users/count', verifyApiKey, (req, res) => {
  res.json({
    success: true,
    totalConnectedUsers: connectedUsers.size,
    timestamp: new Date().toISOString()
  });
});

// Get all connected users list
app.get('/api/v1/users', verifyApiKey, (req, res) => {
  const users = Array.from(connectedUsers.values());
  res.json({
    success: true,
    totalConnectedUsers: connectedUsers.size,
    users: users,
    timestamp: new Date().toISOString()
  });
});

// Get active users (synced in last N minutes, default 30)
app.get('/api/v1/users/active', verifyApiKey, (req, res) => {
  const minutes = parseInt(req.query.minutes) || 30;
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const activeUsers = Array.from(connectedUsers.values()).filter(user => {
    return new Date(user.lastSyncAt) >= cutoff;
  });

  res.json({
    success: true,
    activeMinutes: minutes,
    totalActiveUsers: activeUsers.length,
    totalConnectedUsers: connectedUsers.size,
    users: activeUsers,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'LexOrigin Tally Sync Server',
    version: '1.0.0',
    connectedUsers: connectedUsers.size,
    endpoints: {
      health: 'GET /api/v1/health',
      sync: 'POST /api/v1/sync/data',
      usersCount: 'GET /api/v1/users/count',
      usersList: 'GET /api/v1/users',
      activeUsers: 'GET /api/v1/users/active?minutes=30'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  LexOrigin Tally Sync Server`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`========================================`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /api/v1/health       - Connection test`);
  console.log(`  POST /api/v1/sync/data    - Receive sync data`);
  console.log(`  GET  /api/v1/users/count  - Connected users count`);
  console.log(`  GET  /api/v1/users        - List all connected users`);
  console.log(`  GET  /api/v1/users/active - Active users (last 30 min)`);
  console.log(`\nWaiting for connections...\n`);
});
