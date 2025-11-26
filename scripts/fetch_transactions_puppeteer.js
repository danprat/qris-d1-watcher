#!/usr/bin/env node
'use strict';

/**
 * Automate Mandiri QRIS login and transaction retrieval using Puppeteer.
 *
 * Flow:
 * 1. Load credentials + selectors from environment variables (.env supported).
 * 2. Launch Chromium (headless by default) and log into the portal.
 * 3. Navigate to the transaction history page and capture the API headers the site uses.
 * 4. Replay the transaction API for the requested date range and print/save the JSON payload.
 *
 * NOTE: Selectors and page behaviour may change. Adjust the selector env vars if the script fails
 * to find the login elements, or inspect the live site to confirm the flow.
 */

const path = require('path');
const fs = require('fs');
const process = require('process');

const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const { setTimeout: delay } = require('timers/promises');

const ENV_PATH = process.env.ENV_FILE || '.env';
dotenv.config({ path: ENV_PATH });

const TRANSACTION_API_URL =
  'https://qris.bankmandiri.co.id/api/homeScreen/getDataTransaksi/auth/homeScreen';

const CONFIG = {
  loginUrl:
    process.env.MANDIRI_LOGIN_URL ||
    'https://qris.bankmandiri.co.id/',
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
  headless:
    (process.env.PUPPETEER_HEADLESS || 'true').toLowerCase() !== 'false',
};

const DATE_DEFAULT = new Date();

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      args._ = args._ || [];
      args._.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      const [key, maybeValue] = token.split('=', 2);
      const normalizedKey = key.slice(2);
      if (maybeValue !== undefined) {
        args[normalizedKey] = maybeValue;
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[normalizedKey] = next;
        i += 1;
      } else {
        args[normalizedKey] = true;
      }
    } else if (token.startsWith('-')) {
      const normalizedKey = token.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[normalizedKey] = next;
        i += 1;
      } else {
        args[normalizedKey] = true;
      }
    }
  }
  return args;
}

function requireEnvValue(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function normalizeDateInput(raw, fallbackDate = DATE_DEFAULT) {
  if (!raw) {
    return formatDate(fallbackDate);
  }
  const cleaned = raw.replace(/-/g, '');
  if (!/^\d{8}$/.test(cleaned)) {
    throw new Error(`Invalid date format: ${raw} (expected YYYY-MM-DD or YYYYMMDD)`);
  }
  return cleaned;
}

function formatDate(inputDate) {
  const yyyy = inputDate.getFullYear();
  const mm = String(inputDate.getMonth() + 1).padStart(2, '0');
  const dd = String(inputDate.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function whitelistedHeaders(headerMap, keys) {
  const result = {};
  for (const key of keys) {
    if (headerMap[key]) {
      result[key] = headerMap[key];
    }
  }
  return result;
}

async function login(page) {
  const {
    loginUrl,
    username,
    password,
    usernameSelector,
    passwordSelector,
    usernameLabel,
    passwordLabel,
    submitSelector,
    submitText,
  } = CONFIG;

  requireEnvValue(username, 'MANDIRI_USERNAME is required');
  requireEnvValue(password, 'MANDIRI_PASSWORD is required');

  await page.goto(loginUrl, { waitUntil: 'networkidle2' });

  await openLoginFormIfNeeded(page);

  if (CONFIG.usernameSelector === '' && CONFIG.passwordSelector === '') {
    await page.waitForSelector('form', { timeout: 20000 });
  }
  await typeIntoField(page, {
    kind: 'username',
    selector: usernameSelector,
    label: usernameLabel,
    value: username,
  });
  await delay(1000);
  await typeIntoField(page, {
    kind: 'password',
    selector: passwordSelector,
    label: passwordLabel,
    value: password,
  });
  await delay(1000);

  const navigationPromise = page.waitForNavigation({
    waitUntil: 'networkidle2',
  }).catch(() => null);

  await clickLoginButton(page, submitSelector, submitText);
  await navigationPromise;

  try {
    await page.waitForResponse(
      (response) =>
        response.url().includes('/api/loginCtl/refresh') &&
        response.request().method() === 'POST',
      { timeout: 15000 }
    );
  } catch (_) {
    // continue even if refresh not observed, but still wait extra time below.
  }

  try {
    await page.waitForFunction(
      () =>
        window.location.href.includes('/homeScreen') ||
        window.location.href.includes('/riwayatTransaksi'),
      { timeout: 15000 }
    );
  } catch (error) {
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl === loginUrl) {
      await delay(3000);
    }
  }

  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 15000 }
  );
  await page.waitForResponse(
    (response) =>
      response.url().includes('/api/homeScreen/getDataTransaksi') ||
      response.url().includes('/api/homeScreen'),
    { timeout: 20000 }
  ).catch(() => null);
  await page.waitForSelector('body', { timeout: 15000 });
  await delay(3000);
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
      // Try next candidate
    }
  }

  throw new Error(
    `Unable to locate a usable login button. Tried selectors: ${candidates.join(', ')}`
  );
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

async function waitForClickable(page, selector, options = {}) {
  await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
  const handle = await page.$(selector);
  if (!handle) {
    throw new Error(`No element found for selector: ${selector}`);
  }

  const isButtonLabel =
    selector.includes('MuiButton-label') || selector.includes('span');

  const element =
    isButtonLabel && (await handle.evaluateHandle((node) => node.closest('button')));

  if (element) {
    await handle.dispose();
    return element.asElement();
  }

  return handle;
}

async function clickButtonByText(page, text) {
  const normalized = text.trim().toLowerCase();
  return await page.evaluate((targetText) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find(
      (btn) => btn.textContent.trim().toLowerCase() === targetText
    );
    if (!target) {
      return false;
    }
    target.click();
    return true;
  }, normalized);
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
    return spans.some(
      (span) => span.textContent.trim() === targetText
    );
  }, trimmed);
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

async function captureTransactionHeaders(page) {
  let capturedHeaders = null;

  const targetUrlFragment = '/api/homeScreen/getDataTransaksi';

  const requestListener = (request) => {
    if (request.url().includes(targetUrlFragment)) {
      capturedHeaders = request.headers();
    }
  };

  page.on('request', requestListener);

  try {
    await page.waitForResponse(
      (response) =>
        response.url().includes(targetUrlFragment) &&
        response.request().method() === 'GET',
      { timeout: 20000 }
    );
  } catch (error) {
    throw new Error(
      'Timed out waiting for the transaction API call. Navigate manually to the history page or update selectors.'
    );
  } finally {
    page.off('request', requestListener);
  }

  if (!capturedHeaders) {
    throw new Error('Failed to capture transaction API headers.');
  }

  return capturedHeaders;
}

async function fetchTransactionsFromPage(page, headers, startDate, endDate) {
  const apiUrl = TRANSACTION_API_URL;
  const headerKeys = [
    'secret-id',
    'secret-key',
    'secret-token',
    'session-item',
    'accept',
  ];
  const filteredHeaders = whitelistedHeaders(headers, headerKeys);
  if (!filteredHeaders['secret-id'] || !filteredHeaders['secret-key']) {
    throw new Error('Captured headers did not include required secret fields.');
  }

  const payload = await page.evaluate(
    async ({ url, start, end, replayHeaders }) => {
      const params = new URLSearchParams({
        startDate: start,
        endDate: end,
        isLimitValidated: 'false',
      });

      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: replayHeaders,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Transaction API returned ${response.status}: ${text.slice(0, 200)}`
        );
      }

      return response.json();
    },
    {
      url: apiUrl,
      start: startDate,
      end: endDate,
      replayHeaders: filteredHeaders,
    }
  );

  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  const startDate = normalizeDateInput(args['start-date']);
  const endDate = normalizeDateInput(args['end-date'], DATE_DEFAULT);
  const outputPath = args.output
    ? path.resolve(process.cwd(), args.output)
    : null;

  const headlessFlag =
    args.headless !== undefined
      ? String(args.headless).toLowerCase() !== 'false'
      : CONFIG.headless;

  const launchOptions = {
    headless: headlessFlag,
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

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    if (CONFIG.userAgent) {
      await page.setUserAgent(CONFIG.userAgent);
    }

    await login(page);
    await page.goto(CONFIG.transactionsUrl, { waitUntil: 'networkidle2' });

    const capturedHeaders = await captureTransactionHeaders(page);
    const data = await fetchTransactionsFromPage(
      page,
      capturedHeaders,
      startDate,
      endDate
    );

    const formatted = JSON.stringify(data, null, 2);
    if (outputPath) {
      fs.writeFileSync(outputPath, formatted, { encoding: 'utf8' });
      console.log(`Saved transactions to ${outputPath}`);
    } else {
      console.log(formatted);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Failed to fetch transactions via Puppeteer.');
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
