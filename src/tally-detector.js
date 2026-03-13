const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');

const execPromise = util.promisify(exec);

// Common Tally installation paths
const COMMON_TALLY_PATHS = [
  'C:\\Tally.ERP9',
  'C:\\TallyPrime',
  'C:\\Program Files\\Tally.ERP9',
  'C:\\Program Files\\TallyPrime',
  'C:\\Program Files (x86)\\Tally.ERP9',
  'C:\\Program Files (x86)\\TallyPrime',
  'D:\\Tally.ERP9',
  'D:\\TallyPrime',
  'E:\\Tally.ERP9',
  'E:\\TallyPrime',
];

// Registry keys where Tally might be registered
const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Tally Solutions Pvt. Ltd.\\TallyPrime',
  'HKLM\\SOFTWARE\\Tally Solutions Pvt. Ltd.\\Tally.ERP 9',
  'HKLM\\SOFTWARE\\WOW6432Node\\Tally Solutions Pvt. Ltd.\\TallyPrime',
  'HKLM\\SOFTWARE\\WOW6432Node\\Tally Solutions Pvt. Ltd.\\Tally.ERP 9',
  'HKCU\\SOFTWARE\\Tally Solutions Pvt. Ltd.\\TallyPrime',
  'HKCU\\SOFTWARE\\Tally Solutions Pvt. Ltd.\\Tally.ERP 9',
];

class TallyDetector {
  constructor() {
    this.tallyPath = null;
    this.tallyVersion = null;
    this.isRunning = false;
  }

  /**
   * Detect Tally installation using multiple methods
   */
  async detect() {
    console.log('Starting Tally detection...');

    // Method 1: Check registry
    const registryResult = await this.checkRegistry();
    if (registryResult) {
      console.log('Found Tally via registry:', registryResult);
      return registryResult;
    }

    // Method 2: Check common paths
    const pathResult = await this.checkCommonPaths();
    if (pathResult) {
      console.log('Found Tally via common paths:', pathResult);
      return pathResult;
    }

    // Method 3: Check running processes
    const processResult = await this.checkRunningProcess();
    if (processResult) {
      console.log('Found Tally via running process:', processResult);
      return processResult;
    }

    console.log('Tally not found');
    return null;
  }

  /**
   * Check Windows Registry for Tally installation
   */
  async checkRegistry() {
    for (const regKey of REGISTRY_KEYS) {
      try {
        const { stdout } = await execPromise(`reg query "${regKey}" /v InstallPath 2>nul`);
        const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
        if (match && match[1]) {
          const installPath = match[1].trim();
          if (fs.existsSync(installPath)) {
            const version = await this.detectVersion(installPath);
            this.tallyPath = installPath;
            this.tallyVersion = version;
            return {
              path: installPath,
              version: version,
              method: 'registry',
            };
          }
        }
      } catch (error) {
        // Registry key doesn't exist, continue to next
      }
    }
    return null;
  }

  /**
   * Check common installation paths
   */
  async checkCommonPaths() {
    for (const tallyPath of COMMON_TALLY_PATHS) {
      if (fs.existsSync(tallyPath)) {
        // Check for tally.exe or tallyprime.exe
        const exeFiles = ['tally.exe', 'tallyprime.exe', 'Tally.ERP9.exe'];
        for (const exe of exeFiles) {
          const exePath = path.join(tallyPath, exe);
          if (fs.existsSync(exePath)) {
            const version = await this.detectVersion(tallyPath);
            this.tallyPath = tallyPath;
            this.tallyVersion = version;
            return {
              path: tallyPath,
              version: version,
              method: 'common_path',
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * Check if Tally is running and get its path
   */
  async checkRunningProcess() {
    try {
      const { stdout } = await execPromise(
        'wmic process where "name like \'%tally%\'" get ExecutablePath /format:csv 2>nul'
      );

      const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('ExecutablePath'));
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const exePath = parts[parts.length - 1].trim();
          if (exePath && fs.existsSync(exePath)) {
            const tallyDir = path.dirname(exePath);
            const version = await this.detectVersion(tallyDir);
            this.tallyPath = tallyDir;
            this.tallyVersion = version;
            this.isRunning = true;
            return {
              path: tallyDir,
              version: version,
              method: 'running_process',
              isRunning: true,
            };
          }
        }
      }
    } catch (error) {
      console.error('Error checking running process:', error.message);
    }
    return null;
  }

  /**
   * Detect Tally version from installation path
   */
  async detectVersion(tallyPath) {
    // Check folder name for version hints
    const folderName = path.basename(tallyPath).toLowerCase();
    if (folderName.includes('prime')) {
      return 'TallyPrime';
    }
    if (folderName.includes('erp9') || folderName.includes('erp 9')) {
      return 'Tally.ERP9';
    }

    // Check for version file or exe properties
    const primeExe = path.join(tallyPath, 'tallyprime.exe');
    const erp9Exe = path.join(tallyPath, 'tally.exe');

    if (fs.existsSync(primeExe)) {
      return 'TallyPrime';
    }
    if (fs.existsSync(erp9Exe)) {
      return 'Tally.ERP9';
    }

    return 'Unknown';
  }

  /**
   * Check if Tally is currently running
   */
  async isTallyRunning() {
    try {
      const { stdout } = await execPromise(
        'tasklist /FI "IMAGENAME eq tally.exe" /FI "IMAGENAME eq tallyprime.exe" 2>nul'
      );
      const isRunning = stdout.toLowerCase().includes('tally');
      this.isRunning = isRunning;
      return isRunning;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Tally Gateway port (default 9000)
   */
  async getTallyPort() {
    // Default Tally Gateway port
    return 9000;
  }

  /**
   * Test connection to Tally Gateway
   */
  async testGatewayConnection(port = 9000) {
    const http = require('http');

    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
        },
        timeout: 5000,
      };

      const testXml = `<ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <TALLYREQUEST>Export</TALLYREQUEST>
          <TYPE>Data</TYPE>
          <ID>List of Companies</ID>
        </HEADER>
        <BODY>
          <DESC>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
          </DESC>
        </BODY>
      </ENVELOPE>`;

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            connected: true,
            statusCode: res.statusCode,
            response: data.substring(0, 500),
          });
        });
      });

      req.on('error', (error) => {
        resolve({
          connected: false,
          error: error.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          connected: false,
          error: 'Connection timeout',
        });
      });

      req.write(testXml);
      req.end();
    });
  }

  /**
   * Get list of companies from Tally
   */
  async getCompanies(port = 9000) {
    const http = require('http');
    const xml2js = require('xml2js');

    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
        },
        timeout: 10000,
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
            const companies = [];

            // Parse company list from response
            if (result.ENVELOPE && result.ENVELOPE.BODY) {
              const body = result.ENVELOPE.BODY;
              if (body.DATA && body.DATA.COLLECTION && body.DATA.COLLECTION.COMPANY) {
                let companyList = body.DATA.COLLECTION.COMPANY;
                if (!Array.isArray(companyList)) {
                  companyList = [companyList];
                }
                for (const company of companyList) {
                  companies.push({
                    name: company.NAME || company._ || company,
                    guid: company.GUID || null,
                  });
                }
              }
            }

            resolve({ success: true, companies });
          } catch (error) {
            resolve({ success: false, error: error.message, rawResponse: data.substring(0, 500) });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Connection timeout' });
      });

      req.write(requestXml);
      req.end();
    });
  }
}

module.exports = TallyDetector;
