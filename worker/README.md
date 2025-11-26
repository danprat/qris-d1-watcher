# QRIS Watcher - Cloudflare Worker

Cloudflare Worker untuk monitoring transaksi Mandiri QRIS secara otomatis. Worker ini akan login ke portal Mandiri QRIS, mengambil data transaksi, dan menyimpannya ke database Cloudflare D1.

## Fitur

- **Full Automation**: Login otomatis ke portal Mandiri QRIS menggunakan Browser Rendering API
- **Scheduled Polling**: Mengambil transaksi setiap 5 menit secara otomatis
- **Cloud Database**: Menyimpan data transaksi ke Cloudflare D1 (SQLite)
- **Deduplication**: Tidak ada duplikasi data (menggunakan `reff_number` sebagai primary key)
- **REST API**: Endpoint untuk health check, statistik, dan trigger manual

---

## Daftar Isi

1. [Prasyarat](#prasyarat)
2. [Instalasi](#instalasi)
3. [Konfigurasi](#konfigurasi)
4. [Deployment](#deployment)
5. [Penggunaan](#penggunaan)
6. [API Endpoints](#api-endpoints)
7. [Monitoring & Logs](#monitoring--logs)
8. [Troubleshooting](#troubleshooting)
9. [Struktur Database](#struktur-database)
10. [Batasan & Limitasi](#batasan--limitasi)

---

## Prasyarat

Sebelum memulai, pastikan kamu memiliki:

1. **Akun Cloudflare** - Daftar gratis di [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Node.js** - Versi 18 atau lebih baru
3. **npm** - Biasanya sudah terinstal bersama Node.js
4. **Akun Mandiri QRIS** - Username (nomor HP) dan password

### Mengecek Versi Node.js

```bash
node --version
# Output: v18.x.x atau lebih tinggi

npm --version
# Output: 9.x.x atau lebih tinggi
```

---

## Instalasi

### 1. Clone atau Download Repository

```bash
git clone <repository-url>
cd qris-d1-watcher-master/worker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Login ke Cloudflare

```bash
npx wrangler login
```

Browser akan terbuka untuk proses autentikasi OAuth. Ikuti instruksi di layar untuk login ke akun Cloudflare kamu.

---

## Konfigurasi

### 1. Buat Database D1

```bash
npx wrangler d1 create qris-transactions
```

Output akan menampilkan informasi database:

```
✅ Successfully created DB 'qris-transactions' in region APAC

[[d1_databases]]
binding = "DB"
database_name = "qris-transactions"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. Update wrangler.toml

Buka file `wrangler.toml` dan update `database_id` dengan ID yang didapat dari langkah sebelumnya:

```toml
[[d1_databases]]
binding = "DB"
database_name = "qris-transactions"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Ganti dengan ID kamu
```

### 3. Jalankan Migration Database

```bash
npx wrangler d1 execute qris-transactions --remote --file=./schema.sql
```

Ini akan membuat tabel `transactions` di database D1.

### 4. Set Credentials sebagai Secrets

**PENTING**: Jangan pernah menyimpan credentials di file konfigurasi!

```bash
# Set username (nomor HP Mandiri QRIS)
npx wrangler secret put MANDIRI_USERNAME
# Masukkan: 08xxxxxxxxxx

# Set password
npx wrangler secret put MANDIRI_PASSWORD
# Masukkan: password_kamu
```

---

## Deployment

### Deploy ke Cloudflare

```bash
npx wrangler deploy
```

Output sukses:

```
Uploaded qris-watcher (10.25 sec)
Deployed qris-watcher triggers (3.83 sec)
  https://qris-watcher.<username>.workers.dev
  schedule: */5 * * * *
```

Catat URL worker kamu untuk digunakan nanti.

---

## Penggunaan

### Akses Worker

Setelah deployment, worker dapat diakses melalui URL:

```
https://qris-watcher.<username>.workers.dev
```

### Scheduled Trigger (Otomatis)

Worker akan otomatis berjalan setiap **5 menit** untuk:
1. Login ke portal Mandiri QRIS
2. Mengambil transaksi hari ini
3. Menyimpan ke database D1

Kamu tidak perlu melakukan apa-apa - semuanya berjalan otomatis!

### Manual Trigger

Jika ingin mengambil transaksi secara manual:

```bash
curl -X POST https://qris-watcher.<username>.workers.dev/trigger
```

Response sukses:
```json
{
  "success": true,
  "message": "Successfully processed 5 transactions",
  "transactionsStored": 5
}
```

---

## API Endpoints

### 1. GET / - Informasi Endpoint

Menampilkan daftar endpoint yang tersedia.

```bash
curl https://qris-watcher.<username>.workers.dev/
```

Response:
```json
{
  "endpoints": {
    "GET /health": "Health check",
    "GET /stats": "Get transaction count",
    "POST /trigger": "Manually trigger transaction fetch"
  }
}
```

### 2. GET /health - Health Check

Mengecek apakah worker berjalan dengan baik.

```bash
curl https://qris-watcher.<username>.workers.dev/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-26T09:43:28.280Z"
}
```

### 3. GET /stats - Statistik Transaksi

Menampilkan jumlah total transaksi yang tersimpan.

```bash
curl https://qris-watcher.<username>.workers.dev/stats
```

Response:
```json
{
  "totalTransactions": 150
}
```

### 4. POST /trigger - Trigger Manual

Memicu pengambilan transaksi secara manual.

```bash
curl -X POST https://qris-watcher.<username>.workers.dev/trigger
```

Response sukses:
```json
{
  "success": true,
  "message": "Successfully processed 5 transactions",
  "transactionsStored": 5
}
```

Response jika tidak ada transaksi:
```json
{
  "success": true,
  "message": "No transactions found for today",
  "transactionsStored": 0
}
```

Response error:
```json
{
  "success": false,
  "message": "Failed to fetch transactions",
  "error": "Error message here"
}
```

---

## Monitoring & Logs

### Melihat Logs Real-time

```bash
cd worker
npx wrangler tail
```

Atau dengan format yang lebih mudah dibaca:

```bash
npx wrangler tail --format=pretty
```

Tekan `Ctrl+C` untuk keluar.

### Contoh Output Logs

```
[job] Starting transaction fetch job
[job] Database schema ensured
[login] Navigating to login page
[login] Login completed
[nav] Navigating to transactions page
[fetch] Fetching transactions for 20251126 - 20251126
[job] Fetched 5 transactions
[job] Stored 5 transactions to D1
```

### Melihat Data di Dashboard Cloudflare

1. Buka [dash.cloudflare.com](https://dash.cloudflare.com)
2. Pilih akun kamu
3. Navigasi ke **Workers & Pages** → **D1**
4. Klik database `qris-transactions`
5. Gunakan **Console** untuk query data:

```sql
-- Melihat 10 transaksi terbaru
SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;

-- Menghitung total transaksi per hari
SELECT DATE(auth_date_time) as tanggal, COUNT(*) as jumlah 
FROM transactions 
GROUP BY DATE(auth_date_time)
ORDER BY tanggal DESC;

-- Menghitung total nominal transaksi hari ini
SELECT SUM(auth_amount_number) as total 
FROM transactions 
WHERE DATE(auth_date_time) = DATE('now');
```

---

## Troubleshooting

### Error: "Rate limit exceeded"

```json
{"error": "Unable to create new browser: code: 429: message: Rate limit exceeded"}
```

**Penyebab**: Cloudflare Browser Rendering API memiliki rate limit.

**Solusi**: Tunggu beberapa menit sebelum mencoba lagi. Worker akan otomatis retry pada scheduled trigger berikutnya.

### Error: "Waiting for selector `form` failed"

```json
{"error": "Waiting for selector `form` failed: Waiting failed: 20000ms exceeded"}
```

**Penyebab**: 
- Portal Mandiri QRIS lambat merespon
- Struktur halaman berubah

**Solusi**:
1. Coba trigger manual lagi
2. Jika masih gagal, cek apakah portal bisa diakses manual di browser
3. Periksa apakah credentials masih valid

### Error: "Missing credentials"

```json
{"error": "MANDIRI_USERNAME and MANDIRI_PASSWORD secrets are required"}
```

**Solusi**: Set ulang secrets:

```bash
npx wrangler secret put MANDIRI_USERNAME
npx wrangler secret put MANDIRI_PASSWORD
```

### Melihat Secret yang Sudah Di-set

```bash
npx wrangler secret list
```

### Menghapus Secret

```bash
npx wrangler secret delete MANDIRI_USERNAME
npx wrangler secret delete MANDIRI_PASSWORD
```

### Re-deploy Worker

Jika ada perubahan kode:

```bash
npx wrangler deploy
```

---

## Struktur Database

### Tabel: transactions

| Kolom | Tipe | Deskripsi |
|-------|------|-----------|
| `reff_number` | TEXT | Primary key, nomor referensi transaksi |
| `number` | TEXT | Nomor urut |
| `is_transfer_to_rek` | INTEGER | Flag transfer ke rekening (0/1) |
| `transfer_amount` | TEXT | Nominal transfer (format string) |
| `transfer_amount_number` | REAL | Nominal transfer (format angka) |
| `fee_amount` | TEXT | Biaya (format string) |
| `fee_amount_number` | REAL | Biaya (format angka) |
| `auth_amount` | TEXT | Nominal transaksi (format string) |
| `auth_amount_number` | REAL | Nominal transaksi (format angka) |
| `percentage_fee_amount` | TEXT | Persentase biaya |
| `percentage_fee_amount_number` | REAL | Persentase biaya (angka) |
| `issuer_name` | TEXT | Nama bank/issuer pembayar |
| `customer_name` | TEXT | Nama customer |
| `mpan` | TEXT | Merchant PAN |
| `tid` | TEXT | Terminal ID |
| `cpan` | TEXT | Customer PAN |
| `auth_date_time` | TEXT | Waktu transaksi |
| `time_data_change` | TEXT | Waktu perubahan data |
| `settle_date` | TEXT | Tanggal settlement |
| `raw_json` | TEXT | Data mentah JSON |
| `created_at` | TEXT | Waktu record dibuat |
| `updated_at` | TEXT | Waktu record diupdate |

---

## Batasan & Limitasi

### Cloudflare Browser Rendering (Free Tier)

- **Concurrent sessions**: Maksimal 2 browser session bersamaan
- **Rate limiting**: Ada batasan request per menit
- **Execution time**: Maksimal 30 detik CPU time per request

### Cloudflare D1 (Free Tier)

- **Storage**: 5 GB
- **Reads**: 5 juta rows/hari
- **Writes**: 100.000 rows/hari

### Cloudflare Workers (Free Tier)

- **Requests**: 100.000 requests/hari
- **CPU time**: 10ms per request (50ms untuk scheduled)

### Tips Optimasi

1. **Jangan trigger manual terlalu sering** - Biarkan scheduled trigger bekerja
2. **Monitor usage** - Cek dashboard Cloudflare untuk melihat usage
3. **Upgrade jika perlu** - Paid plan memiliki limit lebih tinggi

---

## Mengubah Jadwal Polling

Edit file `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]  # Setiap 5 menit
```

Contoh jadwal lain:

```toml
# Setiap 15 menit
crons = ["*/15 * * * *"]

# Setiap jam
crons = ["0 * * * *"]

# Setiap hari jam 8 pagi
crons = ["0 8 * * *"]

# Setiap hari jam 8 pagi dan 8 malam
crons = ["0 8,20 * * *"]
```

Setelah mengubah, deploy ulang:

```bash
npx wrangler deploy
```

---

## Struktur File

```
worker/
├── src/
│   ├── index.ts      # Entry point Worker
│   ├── browser.ts    # Logic Puppeteer untuk login & fetch
│   ├── database.ts   # Operasi database D1
│   └── types.ts      # TypeScript interfaces
├── schema.sql        # SQL schema untuk database
├── wrangler.toml     # Konfigurasi Wrangler
├── package.json      # Dependencies
├── tsconfig.json     # TypeScript config
└── README.md         # Dokumentasi ini
```

---

## Keamanan

⚠️ **PENTING**:

1. **Jangan commit credentials** - Selalu gunakan `wrangler secret`
2. **Jangan share URL worker** - URL worker bisa diakses publik
3. **Gunakan API token minimal** - Jika perlu API token, buat dengan permission minimal
4. **Monitor aktivitas** - Cek logs secara berkala untuk aktivitas mencurigakan

---

## Support

Jika mengalami masalah:

1. Cek bagian [Troubleshooting](#troubleshooting)
2. Lihat logs dengan `npx wrangler tail`
3. Buka issue di repository

---

## Lisensi

MIT License
