const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3600;

// Valid API credentials
const VALID_API_KEY = 'ltk_3a0d801c8d324153b0619f3f79685dea';
const VALID_API_SECRET = 'lts_832211a2e822415fb6756383bb84cc89aeb6c453ac424abd938aa150d9faa8e5';

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
  const { company, ledgers, vouchers, syncedAt } = req.body;

  console.log('\n========== SYNC DATA RECEIVED ==========');
  console.log('Company:', company?.name || 'Unknown');
  console.log('GUID:', company?.guid || 'N/A');
  console.log('Ledgers:', ledgers?.length || 0);
  console.log('Vouchers:', vouchers?.length || 0);
  console.log('Synced At:', syncedAt);
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

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'LexOrigin Tally Sync Server',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/v1/health',
      sync: 'POST /api/v1/sync/data'
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
  console.log(`  GET  /api/v1/health  - Connection test`);
  console.log(`  POST /api/v1/sync/data - Receive sync data`);
  console.log(`\nWaiting for connections...\n`);
});
