# LexOrigin Tally Sync Plugin

This TDL plugin syncs vouchers and ledgers from TallyPrime to LexOrigin.

## Installation Steps

### Step 1: Copy the Plugin File

Copy `LexTallySync.tdl` to your Tally installation's TDL folder:

```
C:\TallyPrime\TDL\LexTallySync.tdl
```

Or if Tally is installed elsewhere:
```
[Your Tally Installation Path]\TDL\LexTallySync.tdl
```

### Step 2: Configure TallyPrime to Load TDL Files

1. Open **TallyPrime**
2. Go to **Gateway of Tally**
3. Press **F12** (Configure)
4. Select **Product & Features**
5. Select **TDL Configuration**
6. Set **Load TDL Files** to **Yes**
7. In the list, add the path to the TDL file:
   ```
   C:\TallyPrime\TDL\LexTallySync.tdl
   ```
8. Press **Ctrl+A** to save
9. **Restart TallyPrime**

### Step 3: Get Your API Credentials

1. Open **LexOrigin** web app
2. Go to **Connectors** page
3. Find **Tally Connector** and click **Activate Connector**
4. Copy the **API Key** and **API Secret** (shown only once!)

### Step 4: Configure the Plugin

1. In TallyPrime, go to **Gateway of Tally**
2. Select **Lex Connector** (new menu item)
3. Select **Configure**
4. Enter your credentials:
   - **API Key**: `ltk_xxxxx...` (from Step 3)
   - **API Secret**: `lts_xxxxx...` (from Step 3)
   - **Sync URL**: `http://localhost:3100/api/v1` (or your production URL)
   - **Enable Sync**: Yes
5. Press **Ctrl+A** to save

### Step 5: Test Connection

1. In TallyPrime, go to **Lex Connector**
2. Select **Test Connection**
3. You should see "Connection successful!" message

## Usage

### Manual Sync

1. Go to **Gateway of Tally** > **Lex Connector** > **Sync Now**
2. All vouchers and ledgers from the current month will be synced

### View Status

1. Go to **Gateway of Tally** > **Lex Connector** > **View Status**
2. Shows current configuration and connection status

### Auto Sync (Optional)

To enable automatic sync when vouchers are saved, edit the TDL file and uncomment the "AUTO SYNC ON VOUCHER SAVE" section at the bottom.

## Troubleshooting

### "Connection failed" error

1. Check that the Tally Connect service is running (`http://localhost:3100`)
2. Verify your API Key and API Secret are correct
3. Make sure "Enable Sync" is set to Yes

### Plugin not appearing in menu

1. Verify the TDL file is in the correct folder
2. Check that "Load TDL Files" is set to Yes in TDL Configuration
3. Restart TallyPrime

### Sync errors

Check the Tally Connect service logs:
```bash
cd C:\Lex Origin\tally-connect
npm run start:dev
```

Look for error messages in the console output.

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /tally/sync/connect` | Register company & device |
| `POST /tally/sync/voucher` | Sync a single voucher |
| `POST /tally/sync/ledgers` | Sync all ledgers |

## Support

For issues, contact support@lexorigin.com
