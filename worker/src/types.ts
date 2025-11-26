import type { D1Database, Fetcher } from "@cloudflare/workers-types";

export interface Env {
  BROWSER: Fetcher;
  DB: D1Database;
  MANDIRI_USERNAME: string;
  MANDIRI_PASSWORD: string;
  POLL_INTERVAL_MS?: string;
}

export interface TransactionDetail {
  reffNumber: string;
  number?: string;
  isTransferToRek?: boolean;
  transferAmount?: string;
  transferAmountNumber?: number;
  feeAmount?: string;
  feeAmountNumber?: number;
  authAmount?: string;
  authAmountNumber?: number;
  percentageFeeAmount?: string;
  percentageFeeAmountNumber?: number;
  issuerName?: string;
  customerName?: string;
  mpan?: string;
  tid?: string;
  cpan?: string;
  authDateTime?: string;
  timeDataChange?: string;
  settleDate?: string;
}

export interface TransactionApiResponse {
  result?: {
    data?: Array<{
      detail?: TransactionDetail;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CapturedHeaders {
  "secret-id"?: string;
  "secret-key"?: string;
  "secret-token"?: string;
  "session-item"?: string;
  [key: string]: string | undefined;
}

export interface FetchResult {
  transactions: TransactionDetail[];
  headers: CapturedHeaders;
}

export interface WorkerResult {
  success: boolean;
  message: string;
  transactionsStored?: number;
  error?: string;
}
