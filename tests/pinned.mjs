// The older walk-through scripts (flow.mjs, polls.mjs, …) print what they see rather than checking it. Imported in
// place of 'playwright', this pins each one to the same Saturday evening so what they print is the same every run,
// and tests/run.mjs compares it with tests/golden/<name>.txt.
import { chromium as real } from 'playwright';
import fs from 'fs';
const local = '/opt/pw-browsers/chromium';
export const PIN = Date.parse('2026-10-10T17:00:00Z');
export const chromium = {
  launch: async (o) => {
    const b = await real.launch(Object.assign({}, o, { executablePath: process.env.CHROMIUM || (fs.existsSync(local) ? local : undefined) }));
    const newContext = b.newContext.bind(b);
    b.newContext = async (opts) => { const c = await newContext(Object.assign({ timezoneId: 'Europe/London', locale: 'en-GB' }, opts)); await c.clock.install({ time: PIN }); return c; };
    b.newPage = async (opts) => (await b.newContext(opts)).newPage();
    return b;
  },
};
