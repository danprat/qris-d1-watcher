#!/usr/bin/env node
'use strict';

/**
 * Long-running Mandiri QRIS transaction monitor.
 *
 * - Launches (Chrome) via Puppeteer, logs in once, keeps the session alive.
 * - Every 5 minutes (configurable) fetches the day's transactions from
 *   /riwayatTransaksi and stores the `detail` object in Cloudflare D1.
 */

const path = require('path');
const process = require('process');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const { setTimeout: delay } = require('timers/promises');

dotenv.config({ path: process.env.ENV_FILE || '.env' });

const TRANSACTION_API_URL =
  'https://qris.bankmandiri.co.id/api/homeScreen/getDataTransaksi/auth/homeScreen';
const REFRESH_API_URL = 'https://qris.bankmandiri.co.id/api/loginCtl/refresh';

const CONFIG = {
  loginUrl:
    process.env.MANDIRI_LOGIN_URL || 'https://qris.bankmandiri.co.id/',
  transactionsUrl:
    process.env.MANDIRI_TRANSACTIONS_URL ||
    'https://qris.bankmandiri.co.id/riwayatTransaksi',
  username: process.env.MANDIRI_USERNAME,
  password: process.env.MANDIRI_PASSWORD,
  usernameSelector: process.env.MANDIRI_USERNAME_SELECTOR || '',
  passwordSelector: process.env.MANDIRI_PASSWORD_SELECTOR || '',
  usernameLabel:
    process.env.MANDIRI_USERNAME_LABEL || 'Nomor Handphone',
  passwordLabel:
    process.env.MANDIRI_PASSWORD_LABEL || 'Password',
  submitSelector:
    process.env.MANDIRI_SUBMIT_SELECTOR ||
    'button[type="submit"], button.login-btn',
  submitText: process.env.MANDIRI_SUBMIT_TEXT || 'Login',
  loginCtaText:
    process.env.MANDIRI_LOGIN_CTA_TEXT ||
    'Sudah Punya Akun? Login di Sini',
  userAgent:
    process.env.MANDIRI_USER_AGENT ||
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  chromeExecutable: process.env.MANDIRI_CHROME_PATH || '',
  chromeUserDataDir: process.env.MANDIRI_CHROME_USER_DATA_DIR || '',
  headless:
    (process.env.PUPPETEER_HEADLESS || 'true').toLowerCase() !== 'false',
  pollIntervalMs:
    Number(process.env.MANDIRI_POLL_INTERVAL_MS || 5 * 60 * 1000),
};

const CLOUDFLARE = {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
};

/**
 * Entry point.
 */
async function main() {
  validateEnv();

  const launchOptions = {
    headless: CONFIG.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
    ],
  };
  if (CONFIG.chromeExecutable) {
    launchOptions.executablePath = CONFIG.chromeExecutable;
  }
  if (CONFIG.chromeUserDataDir) {
    launchOptions.userDataDir = path.resolve(CONFIG.chromeUserDataDir);
  }

  const browser = await puppeteer.launch(launchOptions);
  console.log('[startup] Chrome launched');

  const [page] = await browser.pages();
  page.setDefaultTimeout(20000);
  if (CONFIG.userAgent) {
    await page.setUserAgent(CONFIG.userAgent);
  }

  const cleanup = async () => {
    console.log('\n[shutdown] Closing browser...');
    try {
      await browser.close();
    } catch (error) {
      console.error('[shutdown] Failed to close browser', error);
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await ensureLogin(page);
  await ensureTransactionsPage(page);

  await ensureSchema();

  let latestHeaders = await captureTransactionHeaders(page);
  console.log('[bootstrap] Captured initial API headers');

  let polling = false;
  let lastRun = 0;

  const poll = async () => {
    if (polling) {
      return;
    }
    const now = Date.now();
    if (now - lastRun < CONFIG.pollIntervalMs - 1000) {
      return;
    }
    polling = true;
    lastRun = now;
    try {
      latestHeaders = await refreshHeadersIfNeeded(page, latestHeaders);
      await fetchAndStore(page, latestHeaders);
    } catch (error) {
      console.error('[polling] Failed:', error);
      if (shouldRelogin(error)) {
        console.warn('[polling] Attempting re-login...');
        try {
          await ensureLogin(page, { force: true });
          await ensureTransactionsPage(page);
          latestHeaders = await captureTransactionHeaders(page);
        } catch (innerErr) {
          console.error('[polling] Re-login failed:', innerErr);
        }
      }
    } finally {
      polling = false;
    }
  };

  await poll();
  setInterval(poll, CONFIG.pollIntervalMs);
  console.log(
    `[watcher] Transaction polling scheduled every ${CONFIG.pollIntervalMs / 60000} minute(s)`
  );
}

function validateEnv() {
  if (!CONFIG.username || !CONFIG.password) {
    throw new Error('MANDIRI_USERNAME and MANDIRI_PASSWORD are required');
  }
  if (!CLOUDFLARE.accountId || !CLOUDFLARE.databaseId || !CLOUDFLARE.apiToken) {
    throw new Error(
      'Cloudflare D1 credentials missing. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN'
    );
  }
}

async function ensureLogin(page, options = {}) {
  const force = options.force || false;
  if (!force && page.url().includes('/homeScreen')) {
    return;
  }

  console.log('[login] Navigating to login page');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  await openLoginFormIfNeeded(page);

  if (CONFIG.usernameSelector === '' && CONFIG.passwordSelector === '') {
    await page.waitForSelector('form', { timeout: 20000 });
  }

  await typeIntoField(page, {
    kind: 'username',
    selector: CONFIG.usernameSelector,
    label: CONFIG.usernameLabel,
    value: CONFIG.username,
  });
  await delay(1000);
  await typeIntoField(page, {
    kind: 'password',
    selector: CONFIG.passwordSelector,
    label: CONFIG.passwordLabel,
    value: CONFIG.password,
  });
  await delay(1000);

  const navigationPromise = page
    .waitForNavigation({
      waitUntil: 'networkidle2',
    })
    .catch(() => null);

  await clickLoginButton(page, CONFIG.submitSelector, CONFIG.submitText);
  await navigationPromise;

  await waitForPostLoginSignals(page);
  console.log('[login] Login sequence completed');
}

async function waitForPostLoginSignals(page) {
  await page
    .waitForResponse(
      (response) =>
        response.url().includes(REFRESH_API_URL) &&
        response.request().method() === 'POST',
      { timeout: 15000 }
    )
    .catch(() => null);

  await page
    .waitForFunction(
      () =>
        window.location.href.includes('/homeScreen') ||
        window.location.href.includes('/riwayatTransaksi'),
      { timeout: 15000 }
    )
    .catch(() => null);

  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 15000 }
  );

  await delay(3000);
}

async function ensureTransactionsPage(page) {
  if (page.url().includes('/riwayatTransaksi')) {
    return;
  }
  console.log('[nav] Opening riwayatTransaksi');
  await page.goto(CONFIG.transactionsUrl, { waitUntil: 'networkidle2' });
  await delay(2000);
}

async function fetchAndStore(page, headers) {
  const { startDate, endDate } = todayRange();
  console.log(`[polling] Fetching transactions for ${startDate} - ${endDate}`);
  const payload = await fetchTransactions(page, headers, startDate, endDate);
  const details = collectDetailRecords(payload);
  if (!details.length) {
    console.log('[polling] No transaction details found');
    return;
  }

  const stored = await persistDetails(details);
  console.log(
    `[polling] Upserted ${stored} transaction detail(s) to Cloudflare D1`
  );
}

async function refreshHeadersIfNeeded(page, headers) {
  if (headers && headers['secret-token']) {
    return headers;
  }

  return await captureTransactionHeaders(page);
}

function todayRange() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const formatted = `${yyyy}${mm}${dd}`;
  return { startDate: formatted, endDate: formatted };
}

async function fetchTransactions(page, headers, startDate, endDate) {
  const filteredHeaders = filterHeaders(headers);
  const result = await page.evaluate(
    async ({ url, start, end, extraHeaders }) => {
      try {
        const params = new URLSearchParams({
          startDate: start,
          endDate: end,
          isLimitValidated: 'false',
        });
        const response = await fetch(`${url}?${params.toString()}`, {
          method: 'GET',
          headers: extraHeaders,
        });
        const text = await response.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = null;
        }
        return {
          ok: response.ok,
          status: response.status,
          data,
          text: text.slice(0, 5000),
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error.message || String(error),
        };
      }
    },
    {
      url: TRANSACTION_API_URL,
      start: startDate,
      end: endDate,
      extraHeaders: filteredHeaders,
    }
  );

  if (!result.ok) {
    const err = new Error(
      `Transaction fetch failed: HTTP ${result.status} ${result.error || ''}`
    );
    err.status = result.status;
    err.body = result.text;
    throw err;
  }

  if (!result.data) {
    throw new Error('Transaction response is not valid JSON');
  }

  return result.data;
}

function filterHeaders(headers = {}) {
  const allowed = new Set([
    'secret-id',
    'secret-key',
    'secret-token',
    'session-item',
    'accept',
    'accept-language',
    'referer',
  ]);
  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (allowed.has(lower)) {
      filtered[lower] = value;
    }
  }
  return filtered;
}

function collectDetailRecords(payload) {
  const details = [];
  const visited = new WeakSet();

  const walk = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    if (
      node.detail &&
      typeof node.detail === 'object' &&
      node.detail !== null
    ) {
      details.push(node.detail);
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
    } else {
      for (const value of Object.values(node)) {
        walk(value);
      }
    }
  };

  walk(payload);
  return details;
}

async function persistDetails(details) {
  let stored = 0;

  for (const detail of details) {
    if (!detail || !detail.reffNumber) {
      continue;
    }

    const params = mapDetailToColumns(detail);
    await executeD1(
      `
      INSERT INTO transactions (
        reff_number,
        number,
        is_transfer_to_rek,
        transfer_amount,
        transfer_amount_number,
        fee_amount,
        fee_amount_number,
        auth_amount,
        auth_amount_number,
        percentage_fee_amount,
        percentage_fee_amount_number,
        issuer_name,
        customer_name,
        mpan,
        tid,
        cpan,
        auth_date_time,
        time_data_change,
        settle_date,
        raw_json,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
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
      ;
    `,
      params
    );
    stored += 1;
  }

  return stored;
}

function mapDetailToColumns(detail) {
  const toNumber = (value) =>
    value === null || value === undefined || value === ''
      ? null
      : Number(value);

  const booleanToInt = (value) => (value ? 1 : 0);

  const params = [
    detail.reffNumber,
    detail.number ?? null,
    booleanToInt(detail.isTransferToRek),
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

  return params;
}

async function ensureSchema() {
  await executeD1(
    `
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
  `
  );

  await executeD1(
    `CREATE INDEX IF NOT EXISTS idx_transactions_auth_date ON transactions(auth_date_time);`
  );

  console.log('[cloudflare] Schema ensured');
}

async function executeD1(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE.accountId}/d1/database/${CLOUDFLARE.databaseId}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CLOUDFLARE.apiToken}`,
    },
    body: JSON.stringify({
      sql,
      params,
    }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(
      `Cloudflare D1 query failed: ${JSON.stringify(result.errors || result, null, 2)}`
    );
  }

  return result;
}

async function captureTransactionHeaders(page) {
  let capturedHeaders = null;
  const targetFragment = '/api/homeScreen/getDataTransaksi';

  const onRequest = (request) => {
    if (request.url().includes(targetFragment)) {
      capturedHeaders = request.headers();
    }
  };

  page.on('request', onRequest);

  try {
    await page.waitForResponse(
      (response) =>
        response.url().includes(targetFragment) &&
        response.request().method() === 'GET',
      { timeout: 20000 }
    );
  } catch (error) {
    throw new Error(
      'Timed out capturing transaction headers. Reload /riwayatTransaksi manually to refresh.'
    );
  } finally {
    page.off('request', onRequest);
  }

  if (!capturedHeaders) {
    throw new Error('Failed to capture transaction request headers');
  }

  return capturedHeaders;
}

async function typeIntoField(page, { selector, label, value, kind }) {
  if (selector) {
    try {
      await typeIntoSelector(page, selector, value);
      return;
    } catch (error) {
      console.warn(
        `Failed to type using ${kind || 'field'} selector "${selector}": ${error.message}`
      );
    }
  }

  if (!label) {
    throw new Error(
      `No selector or label provided for ${kind || 'field'}; cannot continue.`
    );
  }

  await typeIntoLabel(page, label, value);
}

async function typeIntoSelector(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 15000 });
  const handle = await page.$(selector);
  if (!handle) {
    throw new Error(`Selector matched no elements: ${selector}`);
  }
  await handle.click({ clickCount: 3 });
  await handle.type(value, { delay: 40 });
  await handle.dispose();
}

async function typeIntoLabel(page, labelText, value) {
  const handle = await waitForInputByLabel(page, labelText, 15000);
  await handle.click({ clickCount: 3 });
  await handle.type(value, { delay: 40 });
  await handle.dispose();
}

async function waitForInputByLabel(page, labelText, timeout = 15000) {
  await page.waitForFunction(
    (text) => {
      const labels = Array.from(document.querySelectorAll('label'));
      return labels.some((label) => label.textContent.trim() === text);
    },
    { timeout },
    labelText
  );

  const handle = await page.evaluateHandle((text) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const label = labels.find((node) => node.textContent.trim() === text);
    if (!label) {
      return null;
    }
    const control = label.control;
    if (control) {
      return control;
    }
    const withinParent = (element) => {
      if (!element) {
        return null;
      }
      if (element.tagName === 'INPUT') {
        return element;
      }
      const found = element.querySelector('input');
      return found || null;
    };

    let neighbor = label.previousElementSibling;
    while (neighbor) {
      const candidate = withinParent(neighbor);
      if (candidate) {
        return candidate;
      }
      neighbor = neighbor.previousElementSibling;
    }

    neighbor = label.nextElementSibling;
    while (neighbor) {
      const candidate = withinParent(neighbor);
      if (candidate) {
        return candidate;
      }
      neighbor = neighbor.nextElementSibling;
    }

    const parentCandidate = withinParent(label.parentElement);
    if (parentCandidate) {
      return parentCandidate;
    }

    return null;
  }, labelText);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new Error(`Label "${labelText}" did not resolve to an input element.`);
  }

  return element;
}

async function clickLoginButton(page, selector, labelText) {
  if (labelText) {
    const clicked = await clickButtonLabel(page, labelText);
    if (clicked) {
      return;
    }
  }

  if (selector) {
    try {
      const handle = await waitForClickable(page, selector, { timeout: 5000 });
      await handle.click();
      await handle.dispose();
      return;
    } catch (error) {
      console.warn(`Failed to click submit selector "${selector}": ${error.message}`);
    }
  }

  const candidates = [
    'button[type="submit"]',
    'button.login-btn',
    'button.MuiButton-root',
  ];

  for (const candidate of candidates) {
    try {
      const handle = await waitForClickable(page, candidate, { timeout: 5000 });
      const textContent = await handle.evaluate((node) =>
        node.textContent.trim().toLowerCase()
      );
      if (!labelText || textContent === labelText.trim().toLowerCase()) {
        await handle.click();
        await handle.dispose();
        return;
      }
      await handle.dispose();
    } catch (error) {
      // next candidate
    }
  }

  throw new Error(
    `Unable to locate a usable login button. Tried selectors: ${candidates.join(', ')}`
  );
}

async function waitForClickable(page, selector, options = {}) {
  await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
  const handle = await page.$(selector);
  if (!handle) {
    throw new Error(`No element found for selector: ${selector}`);
  }

  const isButtonLabel =
    selector.includes('MuiButton-label') || selector.includes('span');

  const element =
    isButtonLabel &&
    (await handle.evaluateHandle((node) => node.closest('button')));

  if (element) {
    await handle.dispose();
    return element.asElement();
  }

  return handle;
}

async function clickButtonLabel(page, text) {
  const trimmed = text.trim();
  const result = await page.evaluate(
    (targetText) => {
      const spans = Array.from(
        document.querySelectorAll('span.MuiButton-label')
      );
      const target = spans.find(
        (span) => span.textContent.trim() === targetText
      );
      if (!target) {
        return false;
      }
      const button = target.closest('button');
      if (!button) {
        return false;
      }
      button.click();
      return true;
    },
    trimmed
  );

  return result;
}

async function buttonLabelExists(page, text) {
  const trimmed = text.trim();
  return await page.evaluate((targetText) => {
    const spans = Array.from(document.querySelectorAll('span.MuiButton-label'));
    return spans.some((span) => span.textContent.trim() === targetText);
  }, trimmed);
}

async function openLoginFormIfNeeded(page) {
  const { loginCtaText } = CONFIG;
  if (!loginCtaText) {
    return;
  }
  if (page.url().includes('/login')) {
    return;
  }

  await page.waitForSelector('span.MuiButton-label', { timeout: 5000 }).catch(
    () => null
  );

  const exists = await buttonLabelExists(page, loginCtaText);
  if (!exists) {
    return;
  }

  const clicked = await clickButtonLabel(page, loginCtaText);
  if (!clicked) {
    return;
  }

  await page
    .waitForNavigation({ waitUntil: 'networkidle2' })
    .catch(() => null);
  await page
    .waitForFunction(
      () => window.location.href.includes('/login'),
      { timeout: 20000 }
    )
    .catch(() => null);
  await delay(500);
}

function shouldRelogin(error) {
  if (!error) {
    return false;
  }
  if (error.status === 401 || error.status === 403) {
    return true;
  }
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('login')
  );
}

main().catch((error) => {
  console.error('[fatal] Unhandled error:', error);
  process.exit(1);
});
