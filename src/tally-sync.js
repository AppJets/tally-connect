const axios = require('axios');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const xml2js = require('xml2js');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

class TallySync {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.syncUrl = config.syncUrl || 'http://localhost:3600/api/v1';
    this.tallyPort = config.tallyPort || 9000;
    this.syncInterval = config.syncInterval || 5; // minutes
    this.autoSync = config.autoSync !== false;
    this.intervalId = null;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.onStatusChange = null;
    this.requestQueue = Promise.resolve(); // Serialize all Tally requests
  }

  /**
   * process.nextTick-based delay that works in Electron
   * (setTimeout doesn't work reliably after HTTP requests in Electron)
   */
  immediateDelay(ms) {
    return new Promise((resolve) => {
      const start = Date.now();
      let iterations = 0;
      const check = () => {
        iterations++;
        if (iterations % 1000 === 0) {
          console.log(`[TallySync] delay check iteration ${iterations}, elapsed: ${Date.now() - start}ms`);
        }
        if (Date.now() - start >= ms) {
          console.log(`[TallySync] delay complete after ${iterations} iterations`);
          resolve();
        } else {
          // Use process.nextTick which seems more reliable in Electron
          process.nextTick(check);
        }
      };
      process.nextTick(check);
    });
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
   * Find Node.js executable path
   */
  getNodePath() {
    // Common Windows Node.js locations
    const possiblePaths = [
      'C:\\nvm4w\\nodejs\\node.exe',
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      process.env.NODE_PATH,
    ].filter(Boolean);

    for (const nodePath of possiblePaths) {
      try {
        if (fs.existsSync(nodePath)) {
          return nodePath;
        }
      } catch (e) {
        // ignore
      }
    }

    // Fallback: try to use 'node' from PATH
    return 'node';
  }

  /**
   * Send request to Tally using a synchronous child process
   * This avoids Electron's event loop issues with HTTP requests
   */
  sendTallyRequest(requestXml, label = 'Tally') {
    console.log(`[TallySync] Sending ${label} request via sync child process to port ${this.tallyPort}...`);

    return new Promise((resolve) => {
      // Use setImmediate to avoid blocking the promise chain
      setImmediate(() => {
        try {
          // Write XML to a temp file to avoid command line length issues
          const tempFile = path.join(os.tmpdir(), `tally-request-${Date.now()}.xml`);
          fs.writeFileSync(tempFile, requestXml);

          const scriptPath = path.join(__dirname, 'tally-request-file.js');
          const nodePath = this.getNodePath();

          console.log(`[TallySync] Using Node at: ${nodePath}`);
          console.log(`[TallySync] Executing sync child process...`);

          try {
            // Use execFileSync which is blocking but doesn't rely on event loop
            const result = execFileSync(nodePath, [scriptPath, String(this.tallyPort), tempFile], {
              encoding: 'utf8',
              timeout: 30000,
              windowsHide: true,
              maxBuffer: 10 * 1024 * 1024, // 10MB
            });

            console.log(`[TallySync] ${label} response complete, length:`, result.length);

            // Clean up temp file
            try {
              fs.unlinkSync(tempFile);
            } catch (e) {
              // ignore
            }

            resolve({ success: true, data: result });
          } catch (execError) {
            console.error(`[TallySync] ${label} exec error:`, execError.message);
            if (execError.stderr) {
              console.error(`[TallySync] ${label} stderr:`, execError.stderr);
            }

            // Clean up temp file
            try {
              fs.unlinkSync(tempFile);
            } catch (e) {
              // ignore
            }

            resolve({ success: false, error: execError.message });
          }
        } catch (error) {
          console.error(`[TallySync] ${label} error:`, error.message);
          resolve({ success: false, error: error.message });
        }
      });
    });
  }

  /**
   * Send data to server using a child process to avoid Electron event loop issues
   */
  sendToServerViaChildProcess(url, payload, headers) {
    console.log(`[TallySync] Sending to server via child process: ${url}`);

    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          // Write payload to temp file
          const tempFile = path.join(os.tmpdir(), `server-request-${Date.now()}.json`);
          fs.writeFileSync(tempFile, JSON.stringify({ url, payload, headers }));

          const scriptPath = path.join(__dirname, 'server-request.js');
          const nodePath = this.getNodePath();

          try {
            const result = execFileSync(nodePath, [scriptPath, tempFile], {
              encoding: 'utf8',
              timeout: 30000,
              windowsHide: true,
              maxBuffer: 10 * 1024 * 1024,
            });

            // Clean up temp file
            try {
              fs.unlinkSync(tempFile);
            } catch (e) {
              // ignore
            }

            const response = JSON.parse(result);
            resolve(response);
          } catch (execError) {
            console.error(`[TallySync] Server request exec error:`, execError.message);

            // Clean up temp file
            try {
              fs.unlinkSync(tempFile);
            } catch (e) {
              // ignore
            }

            resolve({ success: false, error: execError.message });
          }
        } catch (error) {
          console.error(`[TallySync] Server request error:`, error.message);
          resolve({ success: false, error: error.message });
        }
      });
    });
  }

  /**
   * Get companies from Tally Gateway
   */
  async getCompaniesFromTally() {
    // TallyPrime XML format - using Collection export
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

    console.log('[TallySync] Requesting companies from Tally on port', this.tallyPort);

    const response = await this.sendTallyRequest(requestXml, 'Companies');
    if (!response.success) {
      return { success: false, error: response.error };
    }

    const data = response.data;
    console.log('[TallySync] Raw Tally response length:', data.length);
    console.log('[TallySync] Response preview:', data.substring(0, 500));

    try {
      const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true
      });
      const result = await parser.parseStringPromise(data);
      console.log('[TallySync] Parsed result:', JSON.stringify(result, null, 2).substring(0, 1000));

      const companies = this.parseCompanyList(result);
      console.log('[TallySync] Found companies:', companies.length);

      if (companies.length === 0) {
        // Try alternative parsing for different Tally versions
        const altCompanies = this.parseCompanyListAlternative(data);
        if (altCompanies.length > 0) {
          console.log('[TallySync] Found companies via alt parser:', altCompanies.length);
          return { success: true, data: altCompanies };
        }
      }

      return { success: true, data: companies };
    } catch (error) {
      console.error('[TallySync] Parse error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse company list from Tally XML response
   */
  parseCompanyList(result) {
    const companies = [];
    try {
      // Try multiple paths where company data might be
      const paths = [
        result?.ENVELOPE?.BODY?.DATA?.COLLECTION?.COMPANY,
        result?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE?.COMPANY,
        result?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE?.COMPANY,
        result?.ENVELOPE?.BODY?.TALLYMESSAGE?.COMPANY,
        result?.ENVELOPE?.TALLYMESSAGE?.COMPANY,
      ];

      for (const path of paths) {
        if (path) {
          let companyList = Array.isArray(path) ? path : [path];
          for (const company of companyList) {
            if (company) {
              // Handle both nested NAME element and NAME attribute
              let name = null;
              let guid = null;

              // Helper to extract string value from various formats
              const extractString = (val) => {
                if (!val) return null;
                if (typeof val === 'string') return val;
                if (Array.isArray(val)) {
                  // Find first string in array
                  for (const item of val) {
                    if (typeof item === 'string') return item;
                    if (item && item._) return item._;
                  }
                }
                if (typeof val === 'object') {
                  return val._ || val['_'] || val['$']?._ || null;
                }
                return String(val);
              };

              // Extract NAME
              name = extractString(company.NAME) || extractString(company['$']?.NAME);

              // Extract GUID
              guid = extractString(company.GUID) || extractString(company['$']?.GUID);

              if (name) {
                companies.push({
                  name: name,
                  guid: guid || `gen-${Date.now()}`,
                  startDate: company.STARTINGFROM || null,
                  email: company.EMAIL || null,
                });
                console.log('[TallySync] Found company:', name, 'GUID:', guid);
              }
            }
          }
          if (companies.length > 0) break;
        }
      }

      console.log('[TallySync] parseCompanyList found:', companies.length, 'companies');
    } catch (error) {
      console.error('[TallySync] Error parsing company list:', error);
    }
    return companies;
  }

  /**
   * Alternative parsing using regex for different Tally XML formats
   */
  parseCompanyListAlternative(xmlData) {
    const companies = [];
    try {
      // Try to find company names using regex patterns
      const patterns = [
        /<COMPANY[^>]*>[\s\S]*?<NAME>([^<]+)<\/NAME>[\s\S]*?<GUID>([^<]*)<\/GUID>/gi,
        /<COMPANY[^>]*NAME="([^"]+)"[^>]*>/gi,
        /<NAME[^>]*>([^<]+)<\/NAME>/gi,
      ];

      // Pattern 1: Full COMPANY block with NAME and GUID
      let match;
      const pattern1 = /<COMPANY[^>]*>[\s\S]*?<NAME>([^<]+)<\/NAME>[\s\S]*?(?:<GUID>([^<]*)<\/GUID>)?/gi;
      while ((match = pattern1.exec(xmlData)) !== null) {
        if (match[1] && !companies.find(c => c.name === match[1])) {
          companies.push({
            name: match[1].trim(),
            guid: match[2] || `gen-${Date.now()}-${companies.length}`,
            startDate: null,
            email: null,
          });
        }
      }

      // Pattern 2: COMPANYNAME tag
      if (companies.length === 0) {
        const pattern2 = /<COMPANYNAME[^>]*>([^<]+)<\/COMPANYNAME>/gi;
        while ((match = pattern2.exec(xmlData)) !== null) {
          if (match[1] && !companies.find(c => c.name === match[1])) {
            companies.push({
              name: match[1].trim(),
              guid: `gen-${Date.now()}-${companies.length}`,
              startDate: null,
              email: null,
            });
          }
        }
      }

      // Pattern 3: SVCURRENTCOMPANY
      if (companies.length === 0) {
        const pattern3 = /<SVCURRENTCOMPANY[^>]*>([^<]+)<\/SVCURRENTCOMPANY>/gi;
        while ((match = pattern3.exec(xmlData)) !== null) {
          if (match[1] && !companies.find(c => c.name === match[1])) {
            companies.push({
              name: match[1].trim(),
              guid: `gen-${Date.now()}-${companies.length}`,
              startDate: null,
              email: null,
            });
          }
        }
      }

      console.log('[TallySync] parseCompanyListAlternative found:', companies.length, 'companies');
    } catch (error) {
      console.error('[TallySync] Error in alternative parsing:', error);
    }
    return companies;
  }

  /**
   * Sync a single company's data
   */
  async syncCompany(company) {
    console.log('[TallySync] Syncing company:', company.name);
    try {
      // Get ledgers for this company
      console.log('[TallySync] About to fetch ledgers...');
      const ledgers = await this.getLedgersFromTally(company.name);
      console.log('[TallySync] Ledgers result:', ledgers.success, 'count:', ledgers.data?.length || 0);

      // Get vouchers for this company
      const vouchers = await this.getVouchersFromTally(company.name);
      console.log('[TallySync] Vouchers result:', vouchers.success, 'count:', vouchers.data?.length || 0);

      // Send to LexOrigin server
      const payload = {
        company: {
          name: company.name,
          guid: company.guid,
        },
        ledgers: ledgers.success ? ledgers.data : [],
        vouchers: vouchers.success ? vouchers.data : [],
        syncedAt: new Date().toISOString(),
        deviceId: `electron-${Date.now()}`,
      };

      const signature = this.generateSignature(payload);

      console.log('[TallySync] Sending to server:', this.syncUrl);
      console.log('[TallySync] Payload:', JSON.stringify(payload).substring(0, 500));

      // Use the same child process approach for sending to server
      // since axios also has issues with Electron's event loop
      const serverResponse = await this.sendToServerViaChildProcess(
        `${this.syncUrl}/sync/data`,
        payload,
        {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'X-Signature': signature,
        }
      );

      if (!serverResponse.success) {
        throw new Error(serverResponse.error || 'Server sync failed');
      }

      console.log('[TallySync] Server response:', serverResponse.status, serverResponse.data);

      return {
        company: company.name,
        success: true,
        ledgersCount: payload.ledgers.length,
        vouchersCount: payload.vouchers.length,
      };
    } catch (error) {
      console.error('[TallySync] Sync error:', error.message);
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
    console.log('[TallySync] Fetching ledgers for company:', companyName);
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

    console.log('[TallySync] About to call sendTallyRequest for Ledgers...');
    const response = await this.sendTallyRequest(requestXml, 'Ledgers');
    console.log('[TallySync] sendTallyRequest for Ledgers returned:', response.success);
    if (!response.success) {
      return { success: false, error: response.error, data: [] };
    }

    try {
      const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true
      });
      const result = await parser.parseStringPromise(response.data);
      const ledgers = this.parseLedgerList(result);
      console.log('[TallySync] Parsed', ledgers.length, 'ledgers');
      return { success: true, data: ledgers };
    } catch (error) {
      console.error('[TallySync] Ledgers parse error:', error.message);
      return { success: false, error: error.message, data: [] };
    }
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
            // With mergeAttrs: true, NAME attribute is merged directly
            // NAME could be a string (from attribute) or object (from nested element)
            let name = null;
            if (typeof ledger.NAME === 'string') {
              name = ledger.NAME;
            } else if (ledger['LANGUAGENAME.LIST']) {
              // Fallback: extract from nested language name structure
              const langList = ledger['LANGUAGENAME.LIST'];
              const nameList = langList['NAME.LIST'];
              if (nameList && nameList.NAME) {
                name = Array.isArray(nameList.NAME) ? nameList.NAME[0] : nameList.NAME;
              }
            }

            // Extract parent
            let parent = null;
            if (ledger.PARENT) {
              parent = typeof ledger.PARENT === 'string' ? ledger.PARENT : null;
            }

            ledgers.push({
              name: name || 'Unknown',
              parent: parent,
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
<ID>ListOfVouchers</ID>
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
<COLLECTION NAME="ListOfVouchers">
<TYPE>Voucher</TYPE>
<FETCH>VoucherNumber,Date,VoucherTypeName,Amount,PartyLedgerName,GUID</FETCH>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;

    console.log('[TallySync] Fetching vouchers...');
    const response = await this.sendTallyRequest(requestXml, 'Vouchers');
    if (!response.success) {
      return { success: false, error: response.error, data: [] };
    }

    try {
      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(response.data);
      const vouchers = this.parseVoucherList(result);
      console.log('[TallySync] Parsed', vouchers.length, 'vouchers');
      return { success: true, data: vouchers };
    } catch (error) {
      console.error('[TallySync] Vouchers parse error:', error.message);
      return { success: false, error: error.message, data: [] };
    }
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
