const http = require('http');
const axios = require('axios');
const xml2js = require('xml2js');
const crypto = require('crypto');

const TALLY_PORT = 9000;
const SYNC_URL = 'http://localhost:3600/api/v1';
const API_KEY = 'ltk_3a0d801c8d324153b0619f3f79685dea';
const API_SECRET = 'lts_832211a2e822415fb6756383bb84cc89aeb6c453ac424abd938aa150d9faa8e5';

function generateSignature(payload) {
  return crypto.createHmac('sha256', API_SECRET).update(JSON.stringify(payload)).digest('hex');
}

function tallyRequest(requestXml) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TALLY_PORT,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(requestXml)
      },
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(requestXml);
    req.end();
  });
}

async function parseXml(xml) {
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, mergeAttrs: true });
  return parser.parseStringPromise(xml);
}

function extractString(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    for (const item of val) {
      if (typeof item === 'string') return item;
      if (item && item._) return item._;
    }
  }
  if (typeof val === 'object') return val._ || null;
  return String(val);
}

async function main() {
  console.log('=== FULL SYNC TEST ===\n');

  // 1. Get companies
  console.log('1. Fetching companies...');
  const companiesXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ListOfCompanies</ID></HEADER>
<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="ListOfCompanies"><TYPE>Company</TYPE><FETCH>Name,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

  const companiesResponse = await tallyRequest(companiesXml);
  const companiesResult = await parseXml(companiesResponse);

  const companyData = companiesResult?.ENVELOPE?.BODY?.DATA?.COLLECTION?.COMPANY;
  if (!companyData) {
    console.log('No companies found!');
    return;
  }

  const companies = Array.isArray(companyData) ? companyData : [companyData];
  console.log(`   Found ${companies.length} company(s)`);

  for (const company of companies) {
    const name = extractString(company.NAME);
    const guid = extractString(company.GUID);
    console.log(`   - ${name} (${guid})`);

    // 2. Get ledgers
    console.log(`\n2. Fetching ledgers for ${name}...`);
    const ledgersXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ListOfLedgers</ID></HEADER>
<BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${name}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="ListOfLedgers"><TYPE>Ledger</TYPE><FETCH>Name,Parent,ClosingBalance,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

    const ledgersResponse = await tallyRequest(ledgersXml);
    const ledgersResult = await parseXml(ledgersResponse);
    const ledgerData = ledgersResult?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER;
    const ledgers = ledgerData ? (Array.isArray(ledgerData) ? ledgerData : [ledgerData]) : [];
    console.log(`   Found ${ledgers.length} ledger(s)`);

    // 3. Get vouchers (last 30 days)
    console.log(`\n3. Fetching vouchers for ${name}...`);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const formatDate = (d) => `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;

    const vouchersXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ListOfVouchers</ID></HEADER>
<BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${name}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVFROMDATE>${formatDate(startDate)}</SVFROMDATE><SVTODATE>${formatDate(endDate)}</SVTODATE></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="ListOfVouchers"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,Date,VoucherTypeName,Amount,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

    const vouchersResponse = await tallyRequest(vouchersXml);
    const vouchersResult = await parseXml(vouchersResponse);
    const voucherData = vouchersResult?.ENVELOPE?.BODY?.DATA?.COLLECTION?.VOUCHER;
    const vouchers = voucherData ? (Array.isArray(voucherData) ? voucherData : [voucherData]) : [];
    console.log(`   Found ${vouchers.length} voucher(s)`);

    // 4. Send to server
    console.log(`\n4. Sending to sync server...`);
    const payload = {
      company: { name, guid },
      ledgers: ledgers.slice(0, 10).map(l => ({ name: extractString(l.NAME), parent: extractString(l.PARENT), guid: extractString(l.GUID) })),
      vouchers: vouchers.slice(0, 10).map(v => ({ number: extractString(v.VOUCHERNUMBER), type: extractString(v.VOUCHERTYPENAME), guid: extractString(v.GUID) })),
      syncedAt: new Date().toISOString(),
      deviceId: 'test-script-' + Date.now()
    };

    const signature = generateSignature(payload);

    try {
      const response = await axios.post(`${SYNC_URL}/sync/data`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
          'X-Signature': signature
        },
        timeout: 30000
      });
      console.log('   Server response:', response.status, response.data);
    } catch (error) {
      console.error('   Server error:', error.message);
    }
  }

  console.log('\n=== SYNC COMPLETE ===');
}

main().catch(console.error);
