# LexOrigin Tally Connector

Desktop application for syncing TallyPrime/Tally.ERP9 data with LexOrigin cloud.

## Features

- **Auto-detect Tally**: Automatically finds Tally installation via Windows Registry and common paths
- **TDL Plugin**: One-click installation of required TDL plugin
- **Real-time Sync**: Syncs companies, ledgers, and vouchers to LexOrigin
- **System Tray**: Runs in background with system tray icon
- **Auto-sync**: Configurable sync intervals (1-60 minutes)

## Prerequisites

- Windows 10/11
- TallyPrime or Tally.ERP9 installed
- Node.js 18+ (for development)
- LexOrigin account with API credentials

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run in development mode:
   ```bash
   npm start
   ```

## Building

### Create Windows Installer

```bash
npm run build:win
```

This creates:
- `dist/LexOrigin Tally Connector Setup.exe` - Windows installer

### Create Portable Package

```bash
npm run pack
```

## Project Structure

```
lex-tally-connector/
├── src/
│   ├── main.js          # Electron main process
│   ├── index.html       # UI
│   ├── tally-detector.js # Tally installation detection
│   └── tally-sync.js    # Sync logic
├── tdl/
│   └── LexTallySync.tdl # Tally TDL plugin
├── assets/
│   ├── icon.svg         # App icon (convert to PNG/ICO)
│   ├── icon.png         # App icon (256x256)
│   └── icon.ico         # Windows icon
└── package.json
```

## Icon Generation

Convert the SVG icon to PNG and ICO formats:

Using ImageMagick:
```bash
convert assets/icon.svg -resize 256x256 assets/icon.png
convert assets/icon.svg -resize 256x256 assets/tray-icon.png
convert assets/icon.svg -resize 256x256 assets/icon.ico
```

Or use online converters like https://cloudconvert.com/svg-to-ico

## Configuration

The app stores configuration in:
- Windows: `%APPDATA%/lex-tally-connector/config.json`

### API Credentials

Get your API credentials from LexOrigin:
1. Log in to LexOrigin dashboard
2. Go to Settings > Connectors
3. Activate Tally Connector
4. Copy the API Key and API Secret

## TDL Plugin

The TDL plugin (`tdl/LexTallySync.tdl`) adds:
- Menu item in Gateway of Tally
- Export collections for Companies, Ledgers, Vouchers
- HTTP sync functionality

### Manual TDL Installation

If auto-install fails:
1. Copy `LexTallySync.tdl` to `[Tally Install Path]/TDL/`
2. Restart Tally

## Tally Gateway

Ensure Tally Gateway is enabled:
1. Open Tally
2. Press F12 (Configure)
3. Go to Connectivity
4. Enable "Act as Server" on port 9000

## Troubleshooting

### Tally Not Detected

1. Check if Tally is installed
2. Try "Detect Tally Installation" button
3. Check common paths: C:\TallyPrime, C:\Tally.ERP9

### Connection Failed

1. Verify API Key and Secret
2. Check Server URL is correct
3. Ensure internet connectivity
4. Check if Tally Gateway is enabled (port 9000)

### Sync Errors

1. Ensure Tally is running
2. Check TDL plugin is installed
3. Verify at least one company is loaded in Tally

## License

MIT License - LexOrigin
