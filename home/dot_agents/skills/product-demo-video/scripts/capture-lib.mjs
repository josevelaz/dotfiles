// Playwright capture helpers for product demo videos.
// Records real app states as numbered DPR-2 JPEG frames plus a log and the
// bounding boxes the composition needs for its cursor overlay.
//
// Env (all optional):
//   BASE_URL     local app origin               (default http://127.0.0.1:3000)
//   STORAGE      Playwright storageState file   (signed-in local session)
//   CHROME       Chrome/Chromium executable     (default: Playwright's bundled browser)
//   CAPTURE_DIR  output root for frames + audit (default ./capture)
//   FORBIDDEN    regex of strings that must never be on screen
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
export const OUT = process.env.CAPTURE_DIR ?? './capture';
// Case-sensitive with word boundaries so words like "finance" or "maintenance" don't hit NaN.
export const FORBIDDEN = new RegExp(process.env.FORBIDDEN ?? '\\bseed-\\w+|\\b[Ll]orem ipsum\\b|\\bTODO\\b|\\bundefined\\b|\\bNaN\\b', 'g');

export async function open({ width = 1440, height = 900, signedIn = true } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ['--hide-scrollbars'],
  });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    storageState: signedIn && process.env.STORAGE ? process.env.STORAGE : undefined,
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return { browser, ctx, page };
}

// Capture-time cosmetics only: no app code changes. Extend HIDE_TEXT and
// extraCss per app (devtools buttons, floating launchers, setup warnings...).
const HIDE_TEXT = /Devtools|TanStack|Jump to latest/i;
export async function clean(page, extraCss = '') {
  await page.addStyleTag({ content: `
    *{caret-color:transparent!important}
    vite-error-overlay,nextjs-portal,[id*=devtools i],[class*=devtools i]{display:none!important}
    ${extraCss}` }).catch(() => {});
  await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    for (const el of document.querySelectorAll('button,a')) {
      if (re.test((el.getAttribute('aria-label') ?? '') + el.textContent)) el.style.visibility = 'hidden';
    }
  }, HIDE_TEXT.source).catch(() => {});
}

// Greps the visible text of the current state; one line per state in audit.log.
export async function audit(page, tag) {
  const text = await page.evaluate(() => document.body.innerText);
  const hits = text.match(FORBIDDEN);
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(path.join(OUT, 'audit.log'), `${tag}\t${hits ? [...new Set(hits)].join(',') : 'OK'}\n`);
  return text;
}

// Numbered frames f0000.jpg... with log.json ({f, t, ...extra}) for timing the edit.
export function recorder(page, scene) {
  const dir = path.join(OUT, scene);
  fs.mkdirSync(dir, { recursive: true });
  const log = [];
  const t0 = Date.now();
  let n = 0;
  const shot = async (extra = {}) => {
    const f = `f${String(n++).padStart(4, '0')}.jpg`;
    await page.screenshot({ path: path.join(dir, f), type: 'jpeg', quality: 90 });
    log.push({ f, t: (Date.now() - t0) / 1000, ...extra });
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log, null, 1));
    return f;
  };
  return { shot, dir, log };
}

// Centre + box of a locator in viewport CSS px (feed these to the cursor keys).
export async function box(locator) {
  const r = await locator.boundingBox();
  return r && { x: r.x + r.width / 2, y: r.y + r.height / 2, x0: r.x, y0: r.y, w: r.width, h: r.height };
}

// Real typing, one screenshot every `step` characters.
export async function typeShots(page, shot, text, step = 2) {
  for (let i = 0; i < text.length; i += step) {
    await page.keyboard.type(text.slice(i, i + step));
    await shot({ ph: 'type', n: Math.min(i + step, text.length) });
  }
}

// Wait for a real (e.g. AI) response: busy text gone and DOM text stable.
export async function waitSettled(page, shot, { busy = /Working|Thinking|Loading/i, timeout = 180_000, stableTicks = 6 } = {}) {
  const t0 = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeout) {
    await shot({ ph: 'wait' });
    await page.waitForTimeout(250);
    const text = await page.evaluate(() => document.body.innerText);
    stable = !busy.test(text.slice(-3000)) && text.length === last ? stable + 1 : 0;
    last = text.length;
    if (stable >= stableTicks) return true;
  }
  return false;
}

const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Page scroll to `toY`, one screenshot per video frame on a cubic in-out curve.
export async function easedScroll(page, shot, toY, frames = 60) {
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  // warm lazy images first
  for (let y = 0; y <= toY + 900; y += 300) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(200); }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(1200);
  for (let i = 0; i < frames; i++) {
    const y = Math.round(toY * eio(i / (frames - 1)));
    await page.evaluate((v) => scrollTo(0, v), y);
    await page.waitForTimeout(40);
    await shot({ ph: 'scroll', y });
  }
}

// Inner scroller (chat log) in small fixed steps; `scroller` is a locator inside it.
export async function stepScroll(page, shot, scroller, from, to, step = 8) {
  const h = await scroller.elementHandle();
  for (let v = from; v <= to + step - 1; v += step) {
    await h.evaluate((el, y) => {
      let c = el;
      while (c && !(c.scrollHeight > c.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
      if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = y; }
    }, Math.min(v, to));
    await page.waitForTimeout(60);
    await shot({ ph: 'inner', v: Math.min(v, to) });
  }
}
