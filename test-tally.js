const http = require('http');

const requestXml = `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>ListOfCompanies</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="ListOfCompanies">
<TYPE>Company</TYPE>
<FETCH>Name,GUID</FETCH>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;

console.log('Sending request to Tally on port 9000...');
console.log('Request XML:', requestXml);

const options = {
  hostname: 'localhost',
  port: 9000,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'text/xml',
    'Content-Length': Buffer.byteLength(requestXml)
  }
};

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response length:', data.length);
    console.log('Response:');
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(requestXml);
req.end();
