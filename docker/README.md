# QRIS Watcher - Docker Deployment

Deploy QRIS Watcher di VPS menggunakan Docker.

## Prasyarat

- VPS dengan minimal 1GB RAM
- Docker & Docker Compose terinstall
- Akun Mandiri QRIS

## Quick Start

### 1. Clone Repository

```bash
git clone <repository-url>
cd qris-d1-watcher-master/docker
```

### 2. Setup Environment

```bash
# Copy template
cp .env.example .env

# Edit dengan credentials kamu
nano .env
```

Isi file `.env`:
```env
MANDIRI_USERNAME=08xxxxxxxxxx
MANDIRI_PASSWORD=your_password

# Opsional: Cloudflare D1
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_D1_DATABASE_ID=your-database-id
CLOUDFLARE_API_TOKEN=your-api-token
```

### 3. Build & Run

```bash
# Build image
docker-compose build

# Jalankan
docker-compose up -d

# Lihat logs
docker-compose logs -f
```

## Perintah Berguna

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart

# Lihat logs
docker-compose logs -f

# Lihat logs 100 baris terakhir
docker-compose logs --tail=100

# Masuk ke container
docker-compose exec qris-watcher bash

# Rebuild setelah update
docker-compose build --no-cache
docker-compose up -d
```

## Konfigurasi

### Environment Variables

| Variable | Wajib | Deskripsi |
|----------|-------|-----------|
| `MANDIRI_USERNAME` | Ya | Nomor HP untuk login |
| `MANDIRI_PASSWORD` | Ya | Password akun |
| `MANDIRI_POLL_INTERVAL_MS` | Tidak | Interval polling (default: 300000 = 5 menit) |
| `CLOUDFLARE_ACCOUNT_ID` | Tidak | Untuk simpan ke D1 |
| `CLOUDFLARE_D1_DATABASE_ID` | Tidak | Database ID D1 |
| `CLOUDFLARE_API_TOKEN` | Tidak | API Token Cloudflare |

### Mengubah Interval Polling

Edit `.env`:
```env
# Setiap 1 menit
MANDIRI_POLL_INTERVAL_MS=60000

# Setiap 5 menit (default)
MANDIRI_POLL_INTERVAL_MS=300000

# Setiap 10 menit
MANDIRI_POLL_INTERVAL_MS=600000
```

Lalu restart:
```bash
docker-compose restart
```

## Monitoring

### Lihat Status

```bash
# Status container
docker-compose ps

# Resource usage
docker stats qris-watcher
```

### Contoh Output Logs

```
[startup] Chrome launched
[login] Navigating to login page
[login] Login sequence completed
[nav] Opening riwayatTransaksi
[bootstrap] Captured initial API headers
[watcher] Transaction polling scheduled every 5 minute(s)
[polling] Fetching transactions for 20251126 - 20251126
[polling] Upserted 3 transaction detail(s) to Cloudflare D1
```

## Troubleshooting

### Container tidak start

```bash
# Cek logs
docker-compose logs

# Cek apakah port bentrok
docker ps -a
```

### Login gagal

1. Pastikan credentials benar di `.env`
2. Cek apakah akun tidak di-block
3. Lihat logs untuk detail error

### Memory tinggi

Chromium membutuhkan RAM. Jika VPS kecil:

```bash
# Tambahkan swap
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Rebuild image

```bash
docker-compose build --no-cache
docker-compose up -d
```

## Security

1. **Jangan commit file `.env`** - sudah ada di `.gitignore`
2. **Gunakan VPS dengan firewall** - hanya buka port yang diperlukan
3. **Update berkala** - `docker-compose pull && docker-compose up -d`

## Struktur File

```
docker/
├── Dockerfile          # Docker image definition
├── docker-compose.yml  # Container orchestration
├── .env.example        # Template environment
├── .env                # Credentials (jangan commit!)
└── README.md           # Dokumentasi ini
```
