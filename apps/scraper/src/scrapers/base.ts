import type { Page, Browser } from 'puppeteer-core';

export interface RawTransaction {
  date: string;
  amount: number;
  description: string;
  balance?: number;
}

export interface LoginResult {
  status: 'waiting_2fa' | 'logged_in' | 'error';
  message?: string;
}

export interface TwoFactorResult {
  status: 'logged_in' | 'error';
  message?: string;
}

export interface FetchOptions {
  fromDate: Date;
  toDate: Date;
}

export interface BankScraper {
  readonly bankId: string;
  readonly bankName: string;

  login(credentials: { userId: string; password: string }): Promise<LoginResult>;
  submitTwoFactor(code: string): Promise<TwoFactorResult>;
  fetchTransactions(options: FetchOptions): Promise<RawTransaction[]>;
  close(): Promise<void>;
}

export abstract class BaseScraper implements BankScraper {
  abstract readonly bankId: string;
  abstract readonly bankName: string;
  protected abstract readonly SELECTORS: Record<string, string>;

  protected page!: Page;
  protected browser!: Browser;

  protected async randomDelay(min = 800, max = 2000): Promise<void> {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(r => setTimeout(r, ms));
  }

  protected async initBrowser(): Promise<void> {
    let puppeteer: any;

    // puppeteer-extra + stealth plugin でbot検知回避
    try {
      puppeteer = require('puppeteer-extra');
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());
      console.log('[Browser] puppeteer-extra + stealth plugin loaded');
    } catch {
      puppeteer = require('puppeteer-core');
      console.log('[Browser] puppeteer-core (no stealth)');
    }

    let execPath: string;
    const args = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ];

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'darwin') {
      execPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      execPath = '/usr/bin/chromium';
    }

    this.browser = await puppeteer.launch({
      executablePath: execPath,
      headless: 'new',
      args,
      defaultViewport: { width: 1280, height: 800 },
    });

    this.page = await this.browser.newPage();

    // Bot検知回避: User-Agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Bot検知回避: webdriver フラグを除去
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // JavaScript有効を明示
    await this.page.setJavaScriptEnabled(true);
  }

  protected async safeContent(): Promise<string> {
    try { return await this.page.content(); } catch { return ''; }
  }

  protected async captureScreenshot(jobId: string): Promise<void> {
    try {
      const { getSupabase } = require('../supabase');
      const screenshot = await this.page.screenshot({ fullPage: true });
      await getSupabase().storage
        .from('documents')
        .upload(`error-screenshots/${jobId}-${Date.now()}.png`, screenshot);
    } catch { /* best effort */ }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
  }

  abstract login(credentials: { userId: string; password: string }): Promise<LoginResult>;
  abstract submitTwoFactor(code: string): Promise<TwoFactorResult>;
  abstract fetchTransactions(options: FetchOptions): Promise<RawTransaction[]>;
}
