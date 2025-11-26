import type { D1Database } from "@cloudflare/workers-types";
import type { TransactionDetail } from "./types";

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.prepare(`
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
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_transactions_auth_date ON transactions(auth_date_time)
  `).run();
}

export async function upsertTransactions(
  db: D1Database,
  transactions: TransactionDetail[]
): Promise<number> {
  let stored = 0;

  for (const detail of transactions) {
    if (!detail?.reffNumber) continue;

    const params = mapDetailToParams(detail);

    await db
      .prepare(
        `
      INSERT INTO transactions (
        reff_number, number, is_transfer_to_rek,
        transfer_amount, transfer_amount_number,
        fee_amount, fee_amount_number,
        auth_amount, auth_amount_number,
        percentage_fee_amount, percentage_fee_amount_number,
        issuer_name, customer_name, mpan, tid, cpan,
        auth_date_time, time_data_change, settle_date,
        raw_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(reff_number) DO UPDATE SET
        number = excluded.number,
        is_transfer_to_rek = excluded.is_transfer_to_rek,
        transfer_amount = excluded.transfer_amount,
        transfer_amount_number = excluded.transfer_amount_number,
        fee_amount = excluded.fee_amount,
        fee_amount_number = excluded.fee_amount_number,
        auth_amount = excluded.auth_amount,
        auth_amount_number = excluded.auth_amount_number,
        percentage_fee_amount = excluded.percentage_fee_amount,
        percentage_fee_amount_number = excluded.percentage_fee_amount_number,
        issuer_name = excluded.issuer_name,
        customer_name = excluded.customer_name,
        mpan = excluded.mpan,
        tid = excluded.tid,
        cpan = excluded.cpan,
        auth_date_time = excluded.auth_date_time,
        time_data_change = excluded.time_data_change,
        settle_date = excluded.settle_date,
        raw_json = excluded.raw_json,
        updated_at = CURRENT_TIMESTAMP
    `
      )
      .bind(...params)
      .run();

    stored++;
  }

  return stored;
}

function mapDetailToParams(detail: TransactionDetail): unknown[] {
  const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    return Number(value);
  };

  return [
    detail.reffNumber,
    detail.number ?? null,
    detail.isTransferToRek ? 1 : 0,
    detail.transferAmount ?? null,
    toNumber(detail.transferAmountNumber),
    detail.feeAmount ?? null,
    toNumber(detail.feeAmountNumber),
    detail.authAmount ?? null,
    toNumber(detail.authAmountNumber),
    detail.percentageFeeAmount ?? null,
    toNumber(detail.percentageFeeAmountNumber),
    detail.issuerName ?? null,
    detail.customerName ?? null,
    detail.mpan ?? null,
    detail.tid ?? null,
    detail.cpan ?? null,
    detail.authDateTime ?? null,
    detail.timeDataChange ?? null,
    detail.settleDate ?? null,
    JSON.stringify(detail),
  ];
}

export async function getTransactionCount(db: D1Database): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM transactions")
    .first<{ count: number }>();
  return result?.count ?? 0;
}
