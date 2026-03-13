// Standalone script to make Tally requests
// This runs as a separate Node.js process to avoid Electron's event loop issues
const http = require('http');
const fs = require('fs');

const port = parseInt(process.argv[2]) || 9000;
const xmlFile = process.argv[3];

if (!xmlFile) {
  console.error('No XML file provided');
  process.exit(1);
}

let requestXml;
try {
  requestXml = fs.readFileSync(xmlFile, 'utf8');
} catch (error) {
  console.error('Error reading XML file:', error.message);
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
    'Connection': 'close',
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
