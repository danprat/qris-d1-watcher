# QRIS D1 Watcher

Automation tools for monitoring and extracting transaction data from the Mandiri QRIS merchant portal using Puppeteer and storing it in Cloudflare D1.

## Support This Project

<p>
  <a href="https://saweria.co/HiddenCyber">
    <img src="https://asset.hiddencyber.online/donate-buttons/saweria.svg" alt="Donasi via Saweria" height="56">
  </a>

  <a href="https://support.hiddencyber.online">
    <img src="https://asset.hiddencyber.online/donate-buttons/qris.svg" alt="Dukungan via QRIS" height="56">
  </a>

  <a href="https://ko-fi.com/hiddencyber">
    <img src="https://asset.hiddencyber.online/donate-buttons/ko-fi.svg" alt="Ko-fi untuk HiddenCyber" height="56">
  </a>

  <a href="https://paypal.me/wimboro">
    <img src="https://asset.hiddencyber.online/donate-buttons/paypal.svg" alt="Donasi via PayPal" height="56">
  </a>
</p>

## Features

- **Automated Login**: Handles Mandiri QRIS portal authentication
- **Session Management**: Maintains persistent browser sessions to avoid repeated logins
- **Transaction Monitoring**: Continuously polls for new QRIS transactions
- **Cloud Storage**: Automatically stores transaction data in Cloudflare D1 database
- **Configurable**: Extensive configuration options via environment variables
- **Headless Mode**: Can run in headless or visible browser mode for debugging

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Google Chrome or Chromium browser
- Cloudflare account with D1 database access
- Mandiri QRIS merchant account

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd qriscodex
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` file with your credentials (see Configuration section)

## Configuration

Edit the `.env` file with your credentials and settings:

### Required Variables

```env
# Your Mandiri QRIS portal credentials
MANDIRI_USERNAME=your-phone-number
MANDIRI_PASSWORD=your-password

# Cloudflare D1 credentials
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_D1_DATABASE_ID=your-d1-database-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
```

### Optional Variables

```env
# Browser settings
PUPPETEER_HEADLESS=true                    # Set to false for debugging
MANDIRI_CHROME_PATH=/usr/bin/google-chrome # Custom Chrome path

# Polling interval (in milliseconds)
MANDIRI_POLL_INTERVAL_MS=300000            # Default: 5 minutes

# Form selectors (if portal UI changes)
MANDIRI_USERNAME_LABEL=Nomor Handphone
MANDIRI_PASSWORD_LABEL=Password
MANDIRI_LOGIN_CTA_TEXT=Sudah Punya Akun? Login di Sini
```

### Getting Cloudflare D1 Credentials

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages** → **D1**
3. Create a new D1 database or use an existing one
4. Get your Account ID from the URL or dashboard
5. Copy the Database ID from the D1 database details
6. Create an API token with D1 permissions in **My Profile** → **API Tokens**

## Usage

### Watch Transactions (Long-Running Monitor)

Continuously monitors the Mandiri QRIS portal for new transactions:

```bash
npm run watch:transactions
```

This script will:
1. Launch Chrome and log into the Mandiri QRIS portal
2. Keep the session alive
3. Poll for transactions every 5 minutes (configurable)
4. Store transaction details in Cloudflare D1
5. Handle session refreshes and re-login if needed

Press `Ctrl+C` to stop the monitor.

### Fetch Transactions (One-time Fetch)

Fetch transactions once without continuous monitoring:

```bash
npm run fetch:puppeteer
```

### Python Alternative

There's also a Python-based fetcher (requires session cookies):

```bash
python3 fetch_transactions.py
```

## Database Schema

The script automatically creates a `transactions` table in your D1 database:

```sql
CREATE TABLE transactions (
  reff_number TEXT PRIMARY KEY,
  number TEXT,
  is_transfer_to_rek INTEGER,
  transfer_amount TEXT,
  transfer_amount_number REAL,
  fee_amount TEXT,
  fee_amount_number REAL,
  auth_amount TEXT,
  auth_amount_number REAL,
  percentage_fee_amount TEXT,
  percentage_fee_amount_number REAL,
  issuer_name TEXT,
  customer_name TEXT,
  mpan TEXT,
  tid TEXT,
  cpan TEXT,
  auth_date_time TEXT,
  time_data_change TEXT,
  settle_date TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Troubleshooting

### "Route not found" error from Cloudflare D1

- Verify your `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID` are correct
- Ensure your API token has D1 permissions
- Check that the D1 database exists in your Cloudflare account

### Login fails or times out

- Set `PUPPETEER_HEADLESS=false` to watch the browser
- Verify your credentials are correct
- Check if the portal UI has changed (may need to update selectors)
- Ensure you have a stable internet connection

### "No transactions found"

- Make sure you have transactions for the current day
- The script only fetches today's transactions by default
- Check the Mandiri QRIS portal manually to confirm transactions exist

### Chrome/Chromium not found

```bash
# Ubuntu/Debian
sudo apt-get install chromium-browser

# Or specify custom path in .env
MANDIRI_CHROME_PATH=/path/to/your/chrome
```

## Security Notes

⚠️ **Important Security Considerations:**

- Never commit your `.env` file to version control
- Keep your Cloudflare API tokens secure
- Use API tokens with minimal required permissions
- Consider using environment-specific credentials for development/production
- The browser runs in non-sandbox mode - ensure you trust the scripts you run

## Development

To modify form selectors or add new features, key files:

- `scripts/watch_transactions.js` - Main transaction monitor
- `scripts/fetch_transactions_puppeteer.js` - One-time fetch script
- `.env.example` - Environment variable template

## License

MIT

## Disclaimer

This tool is for personal use with your own Mandiri QRIS merchant account. Ensure you comply with Mandiri's terms of service and only access your own account data.
