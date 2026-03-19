// Standalone script to make Tally requests
// This runs as a separate process to avoid Electron's event loop issues
const http = require('http');

const port = parseInt(process.argv[2]) || 9000;
const requestXml = process.argv[3] || '';

if (!requestXml) {
  console.error('No request XML provided');
  process.exit(1);
}

const options = {
  hostname: 'localhost',
  port: port,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'text/xml',
    'Content-Length': Buffer.byteLength(requestXml),
  },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    process.stdout.write(data);
    process.exit(0);
  });
});

req.on('error', (error) => {
  console.error('Request error:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Request timeout');
  req.destroy();
  process.exit(1);
});

req.setTimeout(30000);
req.write(requestXml);
req.end();
