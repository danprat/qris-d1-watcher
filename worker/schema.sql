-- QRIS Transactions Schema for Cloudflare D1

CREATE TABLE IF NOT EXISTS transactions (
  reff_number TEXT PRIMARY KEY,
  number TEXT,
  is_transfer_to_rek INTEGER NOT NULL DEFAULT 0,
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

CREATE INDEX IF NOT EXISTS idx_transactions_auth_date ON transactions(auth_date_time);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
