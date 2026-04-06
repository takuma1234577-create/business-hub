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
    const puppeteer = require('puppeteer-core');

    // Chromiumパスを検出
    let execPath: string;
    const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'darwin') {
      execPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      // Linux (Railway)
      execPath = '/usr/bin/google-chrome-stable';
    }

    this.browser = await puppeteer.launch({
      executablePath: execPath,
      headless: true,
      args,
      defaultViewport: { width: 1280, height: 800 },
    });

    this.page = await this.browser.newPage();

    // Bot検知回避
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
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
