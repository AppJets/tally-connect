// Standalone script to make HTTP POST requests to the server
// This runs as a separate Node.js process to avoid Electron's event loop issues
const https = require('https');
const http = require('http');
const fs = require('fs');

const inputFile = process.argv[2];

if (!inputFile) {
  console.log(JSON.stringify({ success: false, error: 'No input file provided' }));
  process.exit(1);
}

let requestData;
try {
  const fileContent = fs.readFileSync(inputFile, 'utf8');
  requestData = JSON.parse(fileContent);
} catch (error) {
  console.log(JSON.stringify({ success: false, error: `Error reading input file: ${error.message}` }));
  process.exit(1);
}

const { url, payload, headers } = requestData;

if (!url) {
  console.log(JSON.stringify({ success: false, error: 'No URL provided' }));
  process.exit(1);
}

const urlObj = new URL(url);
const isHttps = urlObj.protocol === 'https:';
const httpModule = isHttps ? https : http;

const bodyString = JSON.stringify(payload);

const options = {
  hostname: urlObj.hostname,
  port: urlObj.port || (isHttps ? 443 : 80),
  path: urlObj.pathname + urlObj.search,
  method: 'POST',
  headers: {
    ...headers,
    'Content-Length': Buffer.byteLength(bodyString),
  },
};

const req = httpModule.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    let responseData;
    try {
      responseData = JSON.parse(data);
    } catch (e) {
      responseData = data;
    }
    console.log(JSON.stringify({
      success: true,
      status: res.statusCode,
      data: responseData,
    }));
    process.exit(0);
  });
});

req.on('error', (error) => {
  console.log(JSON.stringify({ success: false, error: `Request error: ${error.message}` }));
  process.exit(1);
});

req.on('timeout', () => {
  console.log(JSON.stringify({ success: false, error: 'Request timeout' }));
  req.destroy();
  process.exit(1);
});

req.setTimeout(30000);
req.write(bodyString);
req.end();
