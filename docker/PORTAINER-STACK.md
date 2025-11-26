# Portainer Stack - QRIS Watcher

Copy YAML di bawah ini ke Portainer → Stacks → Add Stack → Web editor

## Stack YAML

```yaml
version: '3.8'

services:
  qris-watcher:
    image: node:20-slim
    container_name: qris-watcher
    restart: unless-stopped
    command: >
      bash -c "
        apt-get update && 
        apt-get install -y chromium git ca-certificates libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libasound2 libpangocairo-1.0-0 libgtk-3-0 --no-install-recommends &&
        rm -rf /var/lib/apt/lists/* &&
        git config --global http.sslVerify false &&
        if [ -d /home/node/app/.git ]; then
          cd /home/node/app && git pull;
        else
          git clone https://github.com/danprat/qris-d1-watcher.git /home/node/app;
        fi &&
        cd /home/node/app &&
        npm ci --only=production &&
        node scripts/watch_transactions.js
      "
    environment:
      - MANDIRI_USERNAME=08xxxxxxxxxx
      - MANDIRI_PASSWORD=your_password
      - CLOUDFLARE_ACCOUNT_ID=your_account_id
      - CLOUDFLARE_D1_DATABASE_ID=your_database_id
      - CLOUDFLARE_API_TOKEN=your_api_token
      - PUPPETEER_HEADLESS=true
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
      - MANDIRI_POLL_INTERVAL_MS=300000
    security_opt:
      - no-new-privileges:true
    shm_size: '1gb'
    deploy:
      resources:
        limits:
          memory: 2G
```

## Konfigurasi

Ganti nilai berikut sebelum deploy:

| Variable | Nilai | Contoh |
|----------|-------|--------|
| `MANDIRI_USERNAME` | Nomor HP Mandiri QRIS | `08974041777` |
| `MANDIRI_PASSWORD` | Password akun | `password123` |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID Cloudflare | `494d27de6a0a...` |
| `CLOUDFLARE_D1_DATABASE_ID` | Database ID D1 | `2fe59164-f002...` |
| `CLOUDFLARE_API_TOKEN` | API Token Cloudflare | `zR0FVgxltYKB...` |

## Cara Deploy

1. Buka Portainer → **Stacks**
2. Klik **Add Stack**
3. Nama: `qris-watcher`
4. Pilih **Web editor**
5. Paste YAML di atas
6. Ganti credentials
7. Klik **Deploy the stack**

## Monitoring

Lihat logs:
- Portainer → Containers → `qris-watcher` → Logs

Contoh log sukses:
```
[startup] Chrome launched
[login] Navigating to login page
[login] Login sequence completed
[watcher] Transaction polling scheduled every 5 minute(s)
[polling] Fetching transactions for 20251126 - 20251126
[polling] Upserted 3 transaction detail(s) to Cloudflare D1
```

## Troubleshooting

### Container restart terus
- Cek logs untuk error
- Pastikan credentials benar

### Login gagal
- Verifikasi username/password di portal Mandiri QRIS manual
- Cek apakah akun tidak di-block

### Memory error
- Naikkan memory limit di stack (default 2G)
