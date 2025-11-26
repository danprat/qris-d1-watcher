# Panduan Integrasi QRIS Watcher

Dokumentasi lengkap untuk mengintegrasikan QRIS Watcher ke aplikasi pembayaran kamu.

---

## Daftar Isi

1. [Konsep Dasar](#konsep-dasar)
2. [Alur Pembayaran QRIS](#alur-pembayaran-qris)
3. [Mengakses Data Transaksi](#mengakses-data-transaksi)
4. [Integrasi via REST API](#integrasi-via-rest-api)
5. [Integrasi via Database D1](#integrasi-via-database-d1)
6. [Webhook Notifikasi](#webhook-notifikasi)
7. [Contoh Implementasi](#contoh-implementasi)
8. [Best Practices](#best-practices)

---

## Konsep Dasar

### Apa itu QRIS Watcher?

QRIS Watcher adalah service yang:
1. **Polling** transaksi dari portal Mandiri QRIS setiap 5 menit
2. **Menyimpan** data transaksi ke database Cloudflare D1
3. **Menyediakan API** untuk mengakses data transaksi

### Kapan Data Tersedia?

- Transaksi **real-time** di portal Mandiri QRIS
- Data masuk ke database QRIS Watcher **setiap 5 menit**
- Delay maksimal: **5 menit** dari waktu transaksi

### Data yang Tersedia

Setiap transaksi memiliki informasi:

| Field | Deskripsi | Contoh |
|-------|-----------|--------|
| `reff_number` | Nomor referensi unik | `"123456789012"` |
| `auth_amount_number` | Nominal pembayaran | `50000` |
| `customer_name` | Nama pembayar | `"JOHN DOE"` |
| `issuer_name` | Bank pembayar | `"BCA"` |
| `auth_date_time` | Waktu transaksi | `"2025-11-26 10:30:00"` |

---

## Alur Pembayaran QRIS

```
┌─────────────────────────────────────────────────────────────────┐
│                      ALUR PEMBAYARAN QRIS                       │
└─────────────────────────────────────────────────────────────────┘

    Customer                    Aplikasi Kamu              QRIS Watcher
        │                            │                          │
        │  1. Request Pembayaran     │                          │
        │ ─────────────────────────> │                          │
        │                            │                          │
        │  2. Tampilkan QR Code      │                          │
        │ <───────────────────────── │                          │
        │                            │                          │
        │  3. Scan & Bayar via       │                          │
        │     Mobile Banking         │                          │
        │ ─────────────────────────> │                          │
        │                            │                          │
        │                            │  4. Polling Status       │
        │                            │     (setiap 5-10 detik)  │
        │                            │ ───────────────────────> │
        │                            │                          │
        │                            │  5. Return: belum ada    │
        │                            │ <─────────────────────── │
        │                            │                          │
        │                            │  ... (tunggu QRIS        │
        │                            │       Watcher polling)   │
        │                            │                          │
        │                            │  6. Polling Status       │
        │                            │ ───────────────────────> │
        │                            │                          │
        │                            │  7. Return: PAID ✓       │
        │                            │ <─────────────────────── │
        │                            │                          │
        │  8. Konfirmasi Pembayaran  │                          │
        │ <───────────────────────── │                          │
        │                            │                          │
        ▼                            ▼                          ▼
```

---

## Mengakses Data Transaksi

### Metode 1: REST API (Recommended)

Akses data melalui endpoint Worker yang sudah ada.

**Base URL:**
```
https://qris-watcher.<username>.workers.dev
```

### Metode 2: Direct D1 Query

Akses langsung ke database D1 via Cloudflare API.

### Metode 3: Custom Worker Endpoint

Buat endpoint custom di Worker untuk kebutuhan spesifik.

---

## Integrasi via REST API

### Endpoint yang Tersedia

#### 1. Cek Status Pembayaran by Nominal & Waktu

Untuk verifikasi pembayaran, kamu perlu membuat endpoint custom. Tambahkan ke `src/index.ts`:

```typescript
// Tambahkan di dalam fetch handler

if (url.pathname === "/api/check-payment") {
  const amount = url.searchParams.get("amount");
  const since = url.searchParams.get("since"); // timestamp ISO
  
  if (!amount) {
    return Response.json({ error: "amount is required" }, { status: 400 });
  }

  const sinceTime = since || new Date(Date.now() - 10 * 60 * 1000).toISOString();
  
  const result = await env.DB.prepare(`
    SELECT * FROM transactions 
    WHERE auth_amount_number = ? 
    AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(parseFloat(amount), sinceTime).first();

  if (result) {
    return Response.json({
      found: true,
      transaction: result
    });
  }

  return Response.json({ found: false });
}
```

**Penggunaan:**
```bash
curl "https://qris-watcher.xxx.workers.dev/api/check-payment?amount=50000&since=2025-11-26T10:00:00Z"
```

**Response jika ditemukan:**
```json
{
  "found": true,
  "transaction": {
    "reff_number": "123456789012",
    "auth_amount_number": 50000,
    "customer_name": "JOHN DOE",
    "issuer_name": "BCA",
    "auth_date_time": "2025-11-26 10:30:00"
  }
}
```

#### 2. Cek Status by Referensi Unik

Jika kamu menggunakan nominal unik (misal: Rp 50.123), tambahkan endpoint:

```typescript
if (url.pathname === "/api/verify-payment") {
  const uniqueAmount = url.searchParams.get("unique_amount");
  const orderId = url.searchParams.get("order_id");
  
  const result = await env.DB.prepare(`
    SELECT * FROM transactions 
    WHERE auth_amount_number = ?
    AND created_at >= datetime('now', '-30 minutes')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(parseFloat(uniqueAmount!)).first();

  return Response.json({
    order_id: orderId,
    status: result ? "PAID" : "PENDING",
    transaction: result || null
  });
}
```

#### 3. List Transaksi dengan Filter

```typescript
if (url.pathname === "/api/transactions") {
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const date = url.searchParams.get("date"); // format: YYYY-MM-DD

  let query = "SELECT * FROM transactions";
  const params: any[] = [];

  if (date) {
    query += " WHERE DATE(auth_date_time) = ?";
    params.push(date);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const results = await env.DB.prepare(query).bind(...params).all();

  return Response.json({
    transactions: results.results,
    count: results.results?.length || 0
  });
}
```

---

## Integrasi via Database D1

### Mengakses D1 dari Worker Lain

Jika kamu punya Worker lain yang perlu akses data transaksi:

**1. Tambahkan D1 binding di wrangler.toml Worker lain:**

```toml
[[d1_databases]]
binding = "QRIS_DB"
database_name = "qris-transactions"
database_id = "your-database-id"
```

**2. Query dari Worker:**

```typescript
export default {
  async fetch(request: Request, env: Env) {
    // Cek pembayaran
    const payment = await env.QRIS_DB.prepare(`
      SELECT * FROM transactions 
      WHERE auth_amount_number = ?
      AND created_at >= datetime('now', '-10 minutes')
    `).bind(50000).first();

    if (payment) {
      // Pembayaran ditemukan!
      return Response.json({ status: "PAID", data: payment });
    }

    return Response.json({ status: "PENDING" });
  }
};
```

### Mengakses D1 via Cloudflare API

Untuk aplikasi di luar Cloudflare Workers:

**1. Buat API Token:**
- Buka https://dash.cloudflare.com/profile/api-tokens
- Create Token → Custom Token
- Permissions: `Account` → `D1` → `Edit`

**2. Query via REST API:**

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT * FROM transactions WHERE auth_amount_number = ? LIMIT 1",
    "params": [50000]
  }'
```

---

## Webhook Notifikasi

Untuk mendapatkan notifikasi real-time saat ada transaksi baru, tambahkan webhook ke Worker.

### Setup Webhook

**1. Tambahkan konfigurasi webhook di wrangler.toml:**

```toml
[vars]
WEBHOOK_URL = "https://your-app.com/webhook/qris"
WEBHOOK_SECRET = "your-secret-key"
```

**2. Update index.ts untuk kirim webhook:**

```typescript
async function runFetchJob(env: Env): Promise<WorkerResult> {
  // ... existing code ...

  const stored = await upsertTransactions(env.DB, transactions);
  
  // Kirim webhook untuk transaksi baru
  if (stored > 0 && env.WEBHOOK_URL) {
    await sendWebhook(env, transactions);
  }

  // ... rest of code ...
}

async function sendWebhook(env: Env, transactions: TransactionDetail[]) {
  const payload = {
    event: "new_transactions",
    timestamp: new Date().toISOString(),
    transactions: transactions.map(t => ({
      reff_number: t.reffNumber,
      amount: t.authAmountNumber,
      customer_name: t.customerName,
      issuer_name: t.issuerName,
      datetime: t.authDateTime
    }))
  };

  const signature = await generateSignature(JSON.stringify(payload), env.WEBHOOK_SECRET);

  try {
    await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Webhook failed:", error);
  }
}

async function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
```

### Menerima Webhook di Aplikasi Kamu

**Node.js/Express:**

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = 'your-secret-key';

app.post('/webhook/qris', (req, res) => {
  // Verifikasi signature
  const signature = req.headers['x-webhook-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('base64');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Proses transaksi
  const { transactions } = req.body;
  
  for (const tx of transactions) {
    console.log(`New payment: ${tx.amount} from ${tx.customer_name}`);
    
    // Update order status di database kamu
    // updateOrderStatus(tx.amount, 'PAID');
  }

  res.json({ received: true });
});

app.listen(3000);
```

**PHP/Laravel:**

```php
// routes/web.php
Route::post('/webhook/qris', function (Request $request) {
    $signature = $request->header('X-Webhook-Signature');
    $payload = $request->getContent();
    $secret = config('services.qris.webhook_secret');
    
    $expectedSignature = base64_encode(
        hash_hmac('sha256', $payload, $secret, true)
    );
    
    if (!hash_equals($expectedSignature, $signature)) {
        return response()->json(['error' => 'Invalid signature'], 401);
    }
    
    $data = json_decode($payload, true);
    
    foreach ($data['transactions'] as $tx) {
        // Update order
        Order::where('unique_amount', $tx['amount'])
             ->where('status', 'PENDING')
             ->update(['status' => 'PAID']);
    }
    
    return response()->json(['received' => true]);
});
```

---

## Contoh Implementasi

### 1. E-Commerce dengan Nominal Unik

Strategi: Generate nominal unik untuk setiap order.

**Backend (Node.js):**

```javascript
const QRIS_API = 'https://qris-watcher.xxx.workers.dev';

// Generate nominal unik
function generateUniqueAmount(baseAmount) {
  const random = Math.floor(Math.random() * 999) + 1;
  return baseAmount + random; // Contoh: 50000 -> 50123
}

// Buat order
app.post('/api/create-order', async (req, res) => {
  const { items, total } = req.body;
  
  const uniqueAmount = generateUniqueAmount(total);
  
  const order = await Order.create({
    items,
    base_amount: total,
    unique_amount: uniqueAmount,
    status: 'PENDING',
    expires_at: new Date(Date.now() + 30 * 60 * 1000) // 30 menit
  });

  res.json({
    order_id: order.id,
    amount: uniqueAmount,
    qr_code_url: 'https://your-qris-image.png', // QR Code QRIS kamu
    expires_at: order.expires_at
  });
});

// Cek status pembayaran
app.get('/api/order/:id/status', async (req, res) => {
  const order = await Order.findById(req.params.id);
  
  if (order.status === 'PAID') {
    return res.json({ status: 'PAID' });
  }

  // Cek di QRIS Watcher
  const response = await fetch(
    `${QRIS_API}/api/check-payment?amount=${order.unique_amount}&since=${order.created_at}`
  );
  const data = await response.json();

  if (data.found) {
    // Update order status
    await Order.update(order.id, { 
      status: 'PAID',
      paid_at: new Date(),
      payment_ref: data.transaction.reff_number
    });
    
    return res.json({ status: 'PAID', transaction: data.transaction });
  }

  // Cek expired
  if (new Date() > new Date(order.expires_at)) {
    await Order.update(order.id, { status: 'EXPIRED' });
    return res.json({ status: 'EXPIRED' });
  }

  res.json({ status: 'PENDING' });
});
```

**Frontend (React):**

```jsx
function PaymentPage({ orderId, amount, qrCodeUrl }) {
  const [status, setStatus] = useState('PENDING');
  const [transaction, setTransaction] = useState(null);

  useEffect(() => {
    const checkPayment = async () => {
      const res = await fetch(`/api/order/${orderId}/status`);
      const data = await res.json();
      
      setStatus(data.status);
      if (data.transaction) {
        setTransaction(data.transaction);
      }
    };

    // Polling setiap 5 detik
    const interval = setInterval(() => {
      if (status === 'PENDING') {
        checkPayment();
      }
    }, 5000);

    // Check immediately
    checkPayment();

    return () => clearInterval(interval);
  }, [orderId, status]);

  if (status === 'PAID') {
    return (
      <div className="success">
        <h1>✓ Pembayaran Berhasil!</h1>
        <p>Ref: {transaction?.reff_number}</p>
        <p>Dari: {transaction?.customer_name}</p>
      </div>
    );
  }

  if (status === 'EXPIRED') {
    return <div className="expired">Pembayaran expired. Silakan buat order baru.</div>;
  }

  return (
    <div className="payment">
      <h1>Scan QR Code untuk Bayar</h1>
      <img src={qrCodeUrl} alt="QRIS" />
      <p>Total: Rp {amount.toLocaleString()}</p>
      <p className="loading">Menunggu pembayaran...</p>
    </div>
  );
}
```

### 2. Donasi/Top-up dengan Nominal Bebas

**Backend:**

```javascript
// Cek donasi berdasarkan nama dan nominal
app.get('/api/check-donation', async (req, res) => {
  const { name, amount, since } = req.query;

  const response = await fetch(`${QRIS_API}/api/transactions?date=${today}`);
  const data = await response.json();

  // Cari transaksi yang match
  const donation = data.transactions.find(tx => 
    tx.auth_amount_number === parseFloat(amount) &&
    tx.customer_name.toLowerCase().includes(name.toLowerCase()) &&
    new Date(tx.created_at) >= new Date(since)
  );

  if (donation) {
    // Simpan donasi
    await Donation.create({
      donor_name: donation.customer_name,
      amount: donation.auth_amount_number,
      ref_number: donation.reff_number,
      bank: donation.issuer_name
    });

    return res.json({ found: true, donation });
  }

  res.json({ found: false });
});
```

### 3. POS/Kasir Sederhana

**Frontend (HTML + JS):**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Kasir QRIS</title>
  <style>
    body { font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px; }
    .amount { font-size: 48px; text-align: center; margin: 20px 0; }
    .keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .keypad button { padding: 20px; font-size: 24px; }
    .status { text-align: center; margin: 20px 0; padding: 20px; }
    .status.pending { background: #fff3cd; }
    .status.paid { background: #d4edda; }
    #qrcode { text-align: center; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>Kasir QRIS</h1>
  
  <div class="amount">Rp <span id="display">0</span></div>
  
  <div class="keypad">
    <button onclick="addDigit(1)">1</button>
    <button onclick="addDigit(2)">2</button>
    <button onclick="addDigit(3)">3</button>
    <button onclick="addDigit(4)">4</button>
    <button onclick="addDigit(5)">5</button>
    <button onclick="addDigit(6)">6</button>
    <button onclick="addDigit(7)">7</button>
    <button onclick="addDigit(8)">8</button>
    <button onclick="addDigit(9)">9</button>
    <button onclick="clear()">C</button>
    <button onclick="addDigit(0)">0</button>
    <button onclick="startPayment()">OK</button>
  </div>

  <div id="qrcode"></div>
  <div id="status" class="status" style="display:none;"></div>

  <script>
    const QRIS_API = 'https://qris-watcher.xxx.workers.dev';
    let amount = 0;
    let checkInterval = null;
    let paymentStartTime = null;

    function addDigit(d) {
      amount = amount * 10 + d;
      document.getElementById('display').textContent = amount.toLocaleString();
    }

    function clear() {
      amount = 0;
      document.getElementById('display').textContent = '0';
      document.getElementById('status').style.display = 'none';
      if (checkInterval) clearInterval(checkInterval);
    }

    async function startPayment() {
      if (amount === 0) return;

      // Generate unique amount
      const uniqueAmount = amount + Math.floor(Math.random() * 99) + 1;
      document.getElementById('display').textContent = uniqueAmount.toLocaleString();

      // Show QR Code (ganti dengan QR code QRIS kamu)
      document.getElementById('qrcode').innerHTML = `
        <img src="YOUR_QRIS_IMAGE.png" width="200">
        <p>Scan untuk bayar Rp ${uniqueAmount.toLocaleString()}</p>
      `;

      // Show status
      const statusEl = document.getElementById('status');
      statusEl.style.display = 'block';
      statusEl.className = 'status pending';
      statusEl.textContent = 'Menunggu pembayaran...';

      paymentStartTime = new Date().toISOString();

      // Start polling
      checkInterval = setInterval(() => checkPayment(uniqueAmount), 5000);
    }

    async function checkPayment(uniqueAmount) {
      try {
        const res = await fetch(
          `${QRIS_API}/api/check-payment?amount=${uniqueAmount}&since=${paymentStartTime}`
        );
        const data = await res.json();

        if (data.found) {
          clearInterval(checkInterval);
          
          const statusEl = document.getElementById('status');
          statusEl.className = 'status paid';
          statusEl.innerHTML = `
            <h2>✓ LUNAS</h2>
            <p>Ref: ${data.transaction.reff_number}</p>
            <p>Dari: ${data.transaction.customer_name} (${data.transaction.issuer_name})</p>
          `;

          // Play sound
          new Audio('success.mp3').play().catch(() => {});

          // Auto reset after 5 seconds
          setTimeout(clear, 5000);
        }
      } catch (error) {
        console.error('Check payment error:', error);
      }
    }
  </script>
</body>
</html>
```

---

## Best Practices

### 1. Gunakan Nominal Unik

Untuk menghindari konflik, selalu gunakan nominal unik per transaksi:

```javascript
// ❌ Buruk - nominal sama bisa konflik
const amount = 50000;

// ✓ Baik - tambahkan angka random
const amount = 50000 + Math.floor(Math.random() * 999) + 1;
// Hasil: 50001 - 50999
```

### 2. Set Timeout Pembayaran

```javascript
const PAYMENT_TIMEOUT = 30 * 60 * 1000; // 30 menit

if (Date.now() - order.created_at > PAYMENT_TIMEOUT) {
  order.status = 'EXPIRED';
}
```

### 3. Verifikasi Signature Webhook

Selalu verifikasi signature untuk keamanan:

```javascript
const isValid = verifySignature(payload, signature, secret);
if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

### 4. Idempotency

Pastikan pembayaran tidak diproses dua kali:

```javascript
// Cek apakah transaksi sudah diproses
const existing = await Payment.findOne({ ref_number: tx.reff_number });
if (existing) {
  return; // Skip, sudah diproses
}

// Proses pembayaran baru
await Payment.create({ ... });
```

### 5. Logging

Log semua aktivitas untuk debugging:

```javascript
console.log(`[${new Date().toISOString()}] Payment received:`, {
  order_id: order.id,
  amount: tx.auth_amount_number,
  ref: tx.reff_number
});
```

### 6. Handle Rate Limit

QRIS Watcher memiliki rate limit. Implementasi retry dengan backoff:

```javascript
async function checkPaymentWithRetry(amount, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${QRIS_API}/api/check-payment?amount=${amount}`);
      if (res.status === 429) {
        // Rate limited, tunggu sebelum retry
        await sleep(1000 * (i + 1));
        continue;
      }
      return await res.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}
```

---

## FAQ

### Q: Berapa lama delay pembayaran terdeteksi?

**A:** Maksimal 5 menit (interval polling QRIS Watcher).

### Q: Apakah bisa real-time?

**A:** Tidak 100% real-time karena Mandiri QRIS tidak menyediakan webhook. Delay 5 menit adalah kompromi terbaik.

### Q: Bagaimana jika ada 2 pembayaran dengan nominal sama?

**A:** Gunakan nominal unik untuk setiap transaksi. Contoh: Rp 50.000 → Rp 50.123.

### Q: Apakah aman menyimpan credentials di Cloudflare?

**A:** Ya, Cloudflare Secrets dienkripsi dan tidak bisa dibaca setelah di-set.

### Q: Bagaimana scale untuk traffic tinggi?

**A:** Cloudflare Workers auto-scale. Untuk traffic sangat tinggi, pertimbangkan upgrade ke paid plan.

---

## Support

Butuh bantuan? Buka issue di repository atau hubungi developer.
