const http = require('http');

const companyName = 'QUICK CARE HEALTH SERVICES PRIVATE LIMITED';

const requestXml = `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>ListOfLedgers</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="ListOfLedgers">
<TYPE>Ledger</TYPE>
<FETCH>Name,Parent,OpeningBalance,ClosingBalance,GUID</FETCH>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;

console.log('Fetching ledgers for company:', companyName);
console.log('Request length:', requestXml.length);

const options = {
  hostname: 'localhost',
  port: 9000,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'text/xml',
    'Content-Length': Buffer.byteLength(requestXml)
  },
  timeout: 30000
};

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response length:', data.length);
    console.log('Response (first 2000 chars):');
    console.log(data.substring(0, 2000));
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.on('timeout', () => {
  console.error('Request timed out');
  req.destroy();
});

req.write(requestXml);
req.end();
