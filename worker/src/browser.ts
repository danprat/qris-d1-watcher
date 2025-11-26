import puppeteer, { type Page, type ElementHandle } from "@cloudflare/puppeteer";
import type {
  TransactionDetail,
  CapturedHeaders,
  FetchResult,
  TransactionApiResponse,
  Env,
} from "./types";

const URLS = {
  login: "https://qris.bankmandiri.co.id/",
  transactions: "https://qris.bankmandiri.co.id/riwayatTransaksi",
  transactionApi:
    "https://qris.bankmandiri.co.id/api/homeScreen/getDataTransaksi/auth/homeScreen",
  refreshApi: "https://qris.bankmandiri.co.id/api/loginCtl/refresh",
};

const CONFIG = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  usernameLabel: "Nomor Handphone",
  passwordLabel: "Password",
  loginCtaText: "Sudah Punya Akun? Login di Sini",
};

export async function fetchTransactions(
  browserBinding: Env["BROWSER"],
  username: string,
  password: string
): Promise<FetchResult> {
  // @ts-expect-error - Cloudflare types mismatch between workers-types and puppeteer
  const browser = await puppeteer.launch(browserBinding, {
    keep_alive: 60000,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    page.setDefaultTimeout(30000);

    await performLogin(page, username, password);
    await navigateToTransactions(page);

    const headers = await captureApiHeaders(page);
    const transactions = await fetchTransactionData(page, headers);

    return { transactions, headers };
  } finally {
    await browser.close();
  }
}

async function performLogin(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  console.log("[login] Navigating to homepage");
  
  // Navigate to homepage first (like local script)
  await page.goto(URLS.login, { waitUntil: "networkidle2", timeout: 60000 });
  console.log("[login] Homepage loaded, URL:", page.url());

  // Click "Sudah Punya Akun? Login di Sini" button
  await openLoginFormIfNeeded(page);

  // Wait for form
  await page.waitForSelector("form", { timeout: 20000 });
  console.log("[login] Form found");

  // Type username
  await typeIntoFieldByLabel(page, CONFIG.usernameLabel, username);
  await delay(1000);

  // Type password  
  await typeIntoFieldByLabel(page, CONFIG.passwordLabel, password);
  await delay(1000);

  // Click login button
  const navigationPromise = page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null);
  await clickLoginButton(page);
  await navigationPromise;

  // Wait for post-login signals
  await waitForPostLogin(page);
  console.log("[login] Login completed, URL:", page.url());
}

async function openLoginFormIfNeeded(page: Page): Promise<void> {
  // Check if already on login page
  if (page.url().includes("/login")) {
    console.log("[login] Already on login page");
    return;
  }

  // Wait for MUI button labels to appear
  await page.waitForSelector("span.MuiButton-label", { timeout: 5000 }).catch(() => null);

  // Check if login CTA exists
  const exists = await page.evaluate((targetText) => {
    const spans = Array.from(document.querySelectorAll("span.MuiButton-label"));
    return spans.some((span) => span.textContent?.trim() === targetText);
  }, CONFIG.loginCtaText);

  if (!exists) {
    console.log("[login] Login CTA button not found");
    return;
  }

  // Click the login CTA button
  const clicked = await page.evaluate((ctaText) => {
    const spans = Array.from(document.querySelectorAll("span.MuiButton-label"));
    const target = spans.find((span) => span.textContent?.trim() === ctaText);
    if (!target) return false;

    const button = target.closest("button");
    if (!button) return false;

    button.click();
    return true;
  }, CONFIG.loginCtaText);

  if (clicked) {
    console.log("[login] Clicked login CTA button");
    await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null);
    await page.waitForFunction(
      () => window.location.href.includes("/login"),
      { timeout: 20000 }
    ).catch(() => null);
    await delay(500);
  }
}

async function typeIntoFieldByLabel(
  page: Page,
  labelText: string,
  value: string
): Promise<void> {
  const input = await page.evaluateHandle((text) => {
    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find((l) => l.textContent?.trim() === text);
    if (!label) return null;

    if ((label as HTMLLabelElement).control) {
      return (label as HTMLLabelElement).control;
    }

    const findInput = (el: Element | null): HTMLInputElement | null => {
      if (!el) return null;
      if (el.tagName === "INPUT") return el as HTMLInputElement;
      return el.querySelector("input");
    };

    let sibling = label.nextElementSibling;
    while (sibling) {
      const input = findInput(sibling);
      if (input) return input;
      sibling = sibling.nextElementSibling;
    }

    sibling = label.previousElementSibling;
    while (sibling) {
      const input = findInput(sibling);
      if (input) return input;
      sibling = sibling.previousElementSibling;
    }

    return findInput(label.parentElement);
  }, labelText);

  const element = input.asElement() as ElementHandle<Element> | null;
  if (!element) {
    throw new Error(`Could not find input for label: ${labelText}`);
  }

  await element.click({ clickCount: 3 });
  await (element as ElementHandle<HTMLInputElement>).type(value, { delay: 40 });
}

async function clickLoginButton(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll("span.MuiButton-label"));
    const loginSpan = spans.find(
      (span) => span.textContent?.trim().toLowerCase() === "login"
    );
    if (loginSpan) {
      const button = loginSpan.closest("button");
      if (button) {
        button.click();
        return true;
      }
    }

    const submitBtn = document.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement;
    if (submitBtn) {
      submitBtn.click();
      return true;
    }

    return false;
  });

  if (!clicked) {
    throw new Error("Could not find login button");
  }
}

async function waitForPostLogin(page: Page): Promise<void> {
  await page
    .waitForResponse(
      (response) =>
        response.url().includes(URLS.refreshApi) &&
        response.request().method() === "POST",
      { timeout: 15000 }
    )
    .catch(() => {});

  await page
    .waitForFunction(
      () =>
        window.location.href.includes("/homeScreen") ||
        window.location.href.includes("/riwayatTransaksi"),
      { timeout: 15000 }
    )
    .catch(() => {});

  await delay(3000);
}

async function navigateToTransactions(page: Page): Promise<void> {
  if (page.url().includes("/riwayatTransaksi")) return;

  console.log("[nav] Navigating to transactions page");
  await page.goto(URLS.transactions, { waitUntil: "networkidle2" });
  await delay(2000);
}

async function captureApiHeaders(page: Page): Promise<CapturedHeaders> {
  let capturedHeaders: CapturedHeaders = {};

  const requestHandler = (request: { url: () => string; headers: () => Record<string, string> }) => {
    if (request.url().includes("/api/homeScreen/getDataTransaksi")) {
      capturedHeaders = request.headers() as CapturedHeaders;
    }
  };

  page.on("request", requestHandler);

  try {
    await page.waitForResponse(
      (response) =>
        response.url().includes("/api/homeScreen/getDataTransaksi") &&
        response.request().method() === "GET",
      { timeout: 20000 }
    );
  } finally {
    page.off("request", requestHandler);
  }

  if (!capturedHeaders["secret-token"]) {
    throw new Error("Failed to capture API headers");
  }

  return capturedHeaders;
}

async function fetchTransactionData(
  page: Page,
  headers: CapturedHeaders
): Promise<TransactionDetail[]> {
  const { startDate, endDate } = getTodayRange();

  console.log(`[fetch] Fetching transactions for ${startDate} - ${endDate}`);

  const filteredHeaders = filterHeaders(headers);

  const result = await page.evaluate(
    async ({ url, start, end, extraHeaders }) => {
      try {
        const params = new URLSearchParams({
          startDate: start,
          endDate: end,
          isLimitValidated: "false",
        });

        const response = await fetch(`${url}?${params.toString()}`, {
          method: "GET",
          headers: extraHeaders,
        });

        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      url: URLS.transactionApi,
      start: startDate,
      end: endDate,
      extraHeaders: filteredHeaders,
    }
  );

  if (!result.ok) {
    throw new Error(`API request failed: ${result.status} ${result.error || ""}`);
  }

  return extractTransactionDetails(result.data as TransactionApiResponse);
}

function filterHeaders(headers: CapturedHeaders): Record<string, string> {
  const allowed = new Set([
    "secret-id",
    "secret-key",
    "secret-token",
    "session-item",
    "accept",
    "accept-language",
    "referer",
  ]);

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (allowed.has(key.toLowerCase()) && value) {
      filtered[key.toLowerCase()] = value;
    }
  }
  return filtered;
}

function extractTransactionDetails(
  payload: TransactionApiResponse
): TransactionDetail[] {
  const details: TransactionDetail[] = [];
  const visited = new WeakSet();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (visited.has(node as object)) return;
    visited.add(node as object);

    const obj = node as Record<string, unknown>;

    if (obj.detail && typeof obj.detail === "object") {
      details.push(obj.detail as TransactionDetail);
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else {
      for (const value of Object.values(obj)) walk(value);
    }
  };

  walk(payload);
  return details;
}

function getTodayRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const formatted = `${yyyy}${mm}${dd}`;
  return { startDate: formatted, endDate: formatted };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
