const axios = require('axios');
const http = require('http');
const xml2js = require('xml2js');
const crypto = require('crypto');

class TallySync {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.syncUrl = config.syncUrl || 'http://localhost:3100/api/v1';
    this.tallyPort = config.tallyPort || 9000;
    this.syncInterval = config.syncInterval || 5; // minutes
    this.autoSync = config.autoSync !== false;
    this.intervalId = null;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.onStatusChange = null;
  }

  /**
   * Generate HMAC signature for API requests
   */
  generateSignature(payload) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  /**
   * Start auto-sync
   */
  start() {
    if (this.intervalId) {
      this.stop();
    }

    console.log(`Starting auto-sync every ${this.syncInterval} minutes`);

    // Run initial sync
    this.syncNow();

    // Schedule periodic sync
    this.intervalId = setInterval(() => {
      this.syncNow();
    }, this.syncInterval * 60 * 1000);
  }

  /**
   * Stop auto-sync
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Auto-sync stopped');
    }
  }

  /**
   * Test connection to LexOrigin server
   */
  async testConnection() {
    try {
      const response = await axios.get(`${this.syncUrl}/health`, {
        headers: {
          'X-API-Key': this.apiKey,
        },
        timeout: 10000,
      });

      return {
        success: true,
        status: response.status,
        message: 'Connected to LexOrigin server',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to connect to LexOrigin server',
      };
    }
  }

  /**
   * Sync data from Tally to LexOrigin
   */
  async syncNow() {
    if (this.isSyncing) {
      console.log('Sync already in progress');
      return { success: false, error: 'Sync already in progress' };
    }

    this.isSyncing = true;
    this.notifyStatus('syncing', 'Sync in progress...');

    try {
      // 1. Get company list from Tally
      const companies = await this.getCompaniesFromTally();
      if (!companies.success) {
        throw new Error(`Failed to get companies: ${companies.error}`);
      }

      // 2. For each company, sync data
      const results = [];
      for (const company of companies.data) {
        const companyResult = await this.syncCompany(company);
        results.push(companyResult);
      }

      this.lastSyncTime = new Date();
      this.isSyncing = false;
      this.notifyStatus('success', `Synced ${results.length} companies`);

      return {
        success: true,
        companiesSynced: results.length,
        lastSyncTime: this.lastSyncTime,
        results,
      };
    } catch (error) {
      this.isSyncing = false;
      this.notifyStatus('error', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get companies from Tally Gateway
   */
  async getCompaniesFromTally() {
    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: this.tallyPort,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
        },
        timeout: 15000,
      };

      const requestXml = `<ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <TALLYREQUEST>Export</TALLYREQUEST>
          <TYPE>Collection</TYPE>
          <ID>List of Companies</ID>
        </HEADER>
        <BODY>
          <DESC>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <TDL>
              <TDLMESSAGE>
                <COLLECTION NAME="List of Companies">
                  <TYPE>Company</TYPE>
                  <NATIVEMETHOD>Name</NATIVEMETHOD>
                  <NATIVEMETHOD>GUID</NATIVEMETHOD>
                  <NATIVEMETHOD>StartingFrom</NATIVEMETHOD>
                  <NATIVEMETHOD>Email</NATIVEMETHOD>
                </COLLECTION>
              </TDLMESSAGE>
            </TDL>
          </DESC>
        </BODY>
      </ENVELOPE>`;

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(data);
            const companies = this.parseCompanyList(result);
            resolve({ success: true, data: companies });
          } catch (error) {
            resolve({ success: false, error: error.message });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: `Tally not responding: ${error.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Tally connection timeout' });
      });

      req.write(requestXml);
      req.end();
    });
  }

  /**
   * Parse company list from Tally XML response
   */
  parseCompanyList(result) {
    const companies = [];
    try {
      if (result.ENVELOPE && result.ENVELOPE.BODY) {
        const body = result.ENVELOPE.BODY;
        if (body.DATA && body.DATA.COLLECTION && body.DATA.COLLECTION.COMPANY) {
          let companyList = body.DATA.COLLECTION.COMPANY;
          if (!Array.isArray(companyList)) {
            companyList = [companyList];
          }
          for (const company of companyList) {
            companies.push({
              name: company.NAME || company._ || String(company),
              guid: company.GUID || null,
              startDate: company.STARTINGFROM || null,
              email: company.EMAIL || null,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error parsing company list:', error);
    }
    return companies;
  }

  /**
   * Sync a single company's data
   */
  async syncCompany(company) {
    try {
      // Get ledgers for this company
      const ledgers = await this.getLedgersFromTally(company.name);

      // Get vouchers for this company
      const vouchers = await this.getVouchersFromTally(company.name);

      // Send to LexOrigin server
      const payload = {
        company: {
          name: company.name,
          guid: company.guid,
        },
        ledgers: ledgers.success ? ledgers.data : [],
        vouchers: vouchers.success ? vouchers.data : [],
        syncedAt: new Date().toISOString(),
      };

      const signature = this.generateSignature(payload);

      const response = await axios.post(
        `${this.syncUrl}/sync/data`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
            'X-Signature': signature,
          },
          timeout: 30000,
        }
      );

      return {
        company: company.name,
        success: true,
        ledgersCount: payload.ledgers.length,
        vouchersCount: payload.vouchers.length,
      };
    } catch (error) {
      return {
        company: company.name,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get ledgers from Tally for a company
   */
  async getLedgersFromTally(companyName) {
    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: this.tallyPort,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
        },
        timeout: 30000,
      };

      const requestXml = `<ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <TALLYREQUEST>Export</TALLYREQUEST>
          <TYPE>Collection</TYPE>
          <ID>List of Ledgers</ID>
        </HEADER>
        <BODY>
          <DESC>
            <STATICVARIABLES>
              <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <TDL>
              <TDLMESSAGE>
                <COLLECTION NAME="List of Ledgers">
                  <TYPE>Ledger</TYPE>
                  <NATIVEMETHOD>Name</NATIVEMETHOD>
                  <NATIVEMETHOD>Parent</NATIVEMETHOD>
                  <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
                  <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
                  <NATIVEMETHOD>GUID</NATIVEMETHOD>
                </COLLECTION>
              </TDLMESSAGE>
            </TDL>
          </DESC>
        </BODY>
      </ENVELOPE>`;

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(data);
            const ledgers = this.parseLedgerList(result);
            resolve({ success: true, data: ledgers });
          } catch (error) {
            resolve({ success: false, error: error.message, data: [] });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message, data: [] });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout', data: [] });
      });

      req.write(requestXml);
      req.end();
    });
  }

  /**
   * Parse ledger list from Tally XML response
   */
  parseLedgerList(result) {
    const ledgers = [];
    try {
      if (result.ENVELOPE && result.ENVELOPE.BODY) {
        const body = result.ENVELOPE.BODY;
        if (body.DATA && body.DATA.COLLECTION && body.DATA.COLLECTION.LEDGER) {
          let ledgerList = body.DATA.COLLECTION.LEDGER;
          if (!Array.isArray(ledgerList)) {
            ledgerList = [ledgerList];
          }
          for (const ledger of ledgerList) {
            ledgers.push({
              name: ledger.NAME || ledger._ || String(ledger),
              parent: ledger.PARENT || null,
              openingBalance: ledger.OPENINGBALANCE || '0',
              closingBalance: ledger.CLOSINGBALANCE || '0',
              guid: ledger.GUID || null,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error parsing ledger list:', error);
    }
    return ledgers;
  }

  /**
   * Get vouchers from Tally for a company (last 30 days)
   */
  async getVouchersFromTally(companyName) {
    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: this.tallyPort,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
        },
        timeout: 60000,
      };

      // Get date range for last 30 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const formatDate = (date) => {
        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const y = date.getFullYear();
        return `${d}-${m}-${y}`;
      };

      const requestXml = `<ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <TALLYREQUEST>Export</TALLYREQUEST>
          <TYPE>Collection</TYPE>
          <ID>List of Vouchers</ID>
        </HEADER>
        <BODY>
          <DESC>
            <STATICVARIABLES>
              <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              <SVFROMDATE>${formatDate(startDate)}</SVFROMDATE>
              <SVTODATE>${formatDate(endDate)}</SVTODATE>
            </STATICVARIABLES>
            <TDL>
              <TDLMESSAGE>
                <COLLECTION NAME="List of Vouchers">
                  <TYPE>Voucher</TYPE>
                  <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
                  <NATIVEMETHOD>Date</NATIVEMETHOD>
                  <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
                  <NATIVEMETHOD>Amount</NATIVEMETHOD>
                  <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
                  <NATIVEMETHOD>GUID</NATIVEMETHOD>
                </COLLECTION>
              </TDLMESSAGE>
            </TDL>
          </DESC>
        </BODY>
      </ENVELOPE>`;

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(data);
            const vouchers = this.parseVoucherList(result);
            resolve({ success: true, data: vouchers });
          } catch (error) {
            resolve({ success: false, error: error.message, data: [] });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message, data: [] });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout', data: [] });
      });

      req.write(requestXml);
      req.end();
    });
  }

  /**
   * Parse voucher list from Tally XML response
   */
  parseVoucherList(result) {
    const vouchers = [];
    try {
      if (result.ENVELOPE && result.ENVELOPE.BODY) {
        const body = result.ENVELOPE.BODY;
        if (body.DATA && body.DATA.COLLECTION && body.DATA.COLLECTION.VOUCHER) {
          let voucherList = body.DATA.COLLECTION.VOUCHER;
          if (!Array.isArray(voucherList)) {
            voucherList = [voucherList];
          }
          for (const voucher of voucherList) {
            vouchers.push({
              voucherNumber: voucher.VOUCHERNUMBER || null,
              date: voucher.DATE || null,
              voucherType: voucher.VOUCHERTYPENAME || null,
              amount: voucher.AMOUNT || '0',
              partyName: voucher.PARTYLEDGERNAME || null,
              guid: voucher.GUID || null,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error parsing voucher list:', error);
    }
    return vouchers;
  }

  /**
   * Notify status change
   */
  notifyStatus(status, message) {
    console.log(`[Sync Status] ${status}: ${message}`);
    if (this.onStatusChange) {
      this.onStatusChange(status, message);
    }
  }
}

module.exports = TallySync;
