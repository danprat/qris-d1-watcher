import type { Env, WorkerResult } from "./types";
import { fetchTransactions } from "./browser";
import { ensureSchema, upsertTransactions, getTransactionCount } from "./database";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/health") {
      return Response.json(
        { status: "ok", timestamp: new Date().toISOString() },
        { headers: corsHeaders }
      );
    }

    if (url.pathname === "/stats") {
      try {
        const count = await getTransactionCount(env.DB);
        return Response.json({ totalTransactions: count }, { headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      const result = await runFetchJob(env);
      return Response.json(result, { 
        status: result.success ? 200 : 500,
        headers: corsHeaders 
      });
    }

    // API: Cek pembayaran berdasarkan nominal
    if (url.pathname === "/api/check-payment") {
      return handleCheckPayment(url, env, corsHeaders);
    }

    // API: Verifikasi pembayaran dengan nominal unik
    if (url.pathname === "/api/verify-payment") {
      return handleVerifyPayment(url, env, corsHeaders);
    }

    // API: List transaksi dengan filter
    if (url.pathname === "/api/transactions") {
      return handleListTransactions(url, env, corsHeaders);
    }

    // API: Detail transaksi by reff_number
    if (url.pathname.startsWith("/api/transaction/")) {
      const reffNumber = url.pathname.replace("/api/transaction/", "");
      return handleGetTransaction(reffNumber, env, corsHeaders);
    }

    return Response.json(
      {
        endpoints: {
          "GET /health": "Health check",
          "GET /stats": "Get transaction count",
          "POST /trigger": "Manually trigger transaction fetch",
          "GET /api/check-payment?amount=50000&since=ISO_DATE": "Check payment by amount",
          "GET /api/verify-payment?unique_amount=50123&timeout_minutes=30": "Verify payment with unique amount",
          "GET /api/transactions?limit=10&offset=0&date=YYYY-MM-DD": "List transactions",
          "GET /api/transaction/:reff_number": "Get transaction detail",
        },
      },
      { status: 200, headers: corsHeaders }
    );
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runFetchJob(env));
  },
};

// Handler: Cek pembayaran berdasarkan nominal
async function handleCheckPayment(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const amount = url.searchParams.get("amount");
  const since = url.searchParams.get("since");

  if (!amount) {
    return Response.json(
      { error: "Parameter 'amount' is required" },
      { status: 400, headers }
    );
  }

  const sinceTime = since || new Date(Date.now() - 10 * 60 * 1000).toISOString();

  try {
    const result = await env.DB.prepare(`
      SELECT * FROM transactions 
      WHERE auth_amount_number = ? 
      AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
      .bind(parseFloat(amount), sinceTime)
      .first();

    if (result) {
      return Response.json({ found: true, transaction: result }, { headers });
    }

    return Response.json({ found: false }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Database error" },
      { status: 500, headers }
    );
  }
}

// Handler: Verifikasi pembayaran dengan nominal unik
async function handleVerifyPayment(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const uniqueAmount = url.searchParams.get("unique_amount");
  const orderId = url.searchParams.get("order_id");
  const timeoutMinutes = parseInt(url.searchParams.get("timeout_minutes") || "30");

  if (!uniqueAmount) {
    return Response.json(
      { error: "Parameter 'unique_amount' is required" },
      { status: 400, headers }
    );
  }

  try {
    const result = await env.DB.prepare(`
      SELECT * FROM transactions 
      WHERE auth_amount_number = ?
      AND created_at >= datetime('now', '-' || ? || ' minutes')
      ORDER BY created_at DESC
      LIMIT 1
    `)
      .bind(parseFloat(uniqueAmount), timeoutMinutes)
      .first();

    return Response.json(
      {
        order_id: orderId,
        status: result ? "PAID" : "PENDING",
        transaction: result || null,
      },
      { headers }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Database error" },
      { status: 500, headers }
    );
  }
}

// Handler: List transaksi dengan filter
async function handleListTransactions(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const date = url.searchParams.get("date");
  const customerName = url.searchParams.get("customer_name");

  try {
    let query = "SELECT * FROM transactions WHERE 1=1";
    const params: (string | number)[] = [];

    if (date) {
      query += " AND DATE(auth_date_time) = ?";
      params.push(date);
    }

    if (customerName) {
      query += " AND customer_name LIKE ?";
      params.push(`%${customerName}%`);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const results = await env.DB.prepare(query).bind(...params).all();

    // Get total count
    let countQuery = "SELECT COUNT(*) as total FROM transactions WHERE 1=1";
    const countParams: string[] = [];
    if (date) {
      countQuery += " AND DATE(auth_date_time) = ?";
      countParams.push(date);
    }
    if (customerName) {
      countQuery += " AND customer_name LIKE ?";
      countParams.push(`%${customerName}%`);
    }

    const countResult = await env.DB.prepare(countQuery)
      .bind(...countParams)
      .first<{ total: number }>();

    return Response.json(
      {
        transactions: results.results,
        count: results.results?.length || 0,
        total: countResult?.total || 0,
        limit,
        offset,
      },
      { headers }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Database error" },
      { status: 500, headers }
    );
  }
}

// Handler: Get transaction by reff_number
async function handleGetTransaction(
  reffNumber: string,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  if (!reffNumber) {
    return Response.json(
      { error: "reff_number is required" },
      { status: 400, headers }
    );
  }

  try {
    const result = await env.DB.prepare(
      "SELECT * FROM transactions WHERE reff_number = ?"
    )
      .bind(reffNumber)
      .first();

    if (!result) {
      return Response.json(
        { error: "Transaction not found" },
        { status: 404, headers }
      );
    }

    return Response.json({ transaction: result }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Database error" },
      { status: 500, headers }
    );
  }
}

async function runFetchJob(env: Env): Promise<WorkerResult> {
  console.log("[job] Starting transaction fetch job");

  if (!env.MANDIRI_USERNAME || !env.MANDIRI_PASSWORD) {
    return {
      success: false,
      message: "Missing credentials",
      error: "MANDIRI_USERNAME and MANDIRI_PASSWORD secrets are required",
    };
  }

  try {
    await ensureSchema(env.DB);
    console.log("[job] Database schema ensured");

    const { transactions } = await fetchTransactions(
      env.BROWSER,
      env.MANDIRI_USERNAME,
      env.MANDIRI_PASSWORD
    );

    console.log(`[job] Fetched ${transactions.length} transactions`);

    if (transactions.length === 0) {
      return {
        success: true,
        message: "No transactions found for today",
        transactionsStored: 0,
      };
    }

    const stored = await upsertTransactions(env.DB, transactions);
    console.log(`[job] Stored ${stored} transactions to D1`);

    return {
      success: true,
      message: `Successfully processed ${stored} transactions`,
      transactionsStored: stored,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[job] Error:", errorMessage);

    return {
      success: false,
      message: "Failed to fetch transactions",
      error: errorMessage,
    };
  }
}
