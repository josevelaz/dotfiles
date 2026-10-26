// Example scene: dashboard -> open the assistant -> type a question -> real answer -> next page.
// Selectors and copy are placeholders; adapt them to the app. Run against the LOCAL app only:
//   BASE_URL=http://127.0.0.1:3000 STORAGE=./state.json node capture-example.mjs
import fs from 'node:fs';
import path from 'node:path';
import { open, clean, audit, recorder, box, typeShots, waitSettled, BASE } from './capture-lib.mjs';

const { browser, page } = await open();
const B = {}; // boxes for the cursor overlay, viewport CSS px

await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' });
await page.waitForTimeout(4000);
await clean(page);
const { shot, dir } = recorder(page, 'assistant');

await audit(page, 'dashboard');
const launcher = page.getByRole('button', { name: /assistant|ask/i }).first();
B.launcher = await box(launcher);
await shot({ ph: 'dashboard' });

await launcher.click();
await page.waitForTimeout(1500);
await clean(page);
await shot({ ph: 'open' });

const input = page.getByRole('textbox').last();
B.input = await box(input);
await input.click();
await typeShots(page, shot, 'Which customers have an open balance?');
await page.keyboard.press('Enter');
await waitSettled(page, shot);
await clean(page);
await audit(page, 'answer');
await shot({ ph: 'done' });

const nav = page.getByRole('link', { name: /customers/i }).first();
B.nav = await box(nav);
await nav.click();
await page.waitForTimeout(3000);
await clean(page);
await audit(page, 'customers');
await shot({ ph: 'customers' });

fs.writeFileSync(path.join(dir, 'boxes.json'), JSON.stringify(B, null, 1));
await browser.close();
