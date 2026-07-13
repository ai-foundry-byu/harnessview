#!/usr/bin/env node
// Step 1: Navigate blank Chrome tab to npmjs.com/signup and check if Cloudflare passes.
// This uses the REAL Chrome (not Playwright) — navigator.webdriver=false confirmed.

import { writeFileSync } from 'node:fs';

const BLANK_TAB_WS = 'ws://localhost:9222/devtools/page/2E98E38BFC615CF9B6D5F57E80D0E80A';
const NPM_SIGNUP_URL = 'https://www.npmjs.com/signup';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
    });

    const on = (event, handler) => {
      listeners.set(event, [...(listeners.get(event) || []), handler]);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
      if (msg.method) (listeners.get(msg.method) || []).forEach(h => h(msg.params));
    };

    ws.onerror = (e) => reject(e);
    ws.onopen = () => resolve({ send, on, ws });
  });
}

async function main() {
  console.log('Connecting to real Chrome via CDP...');
  const cdp = await makeCDP(BLANK_TAB_WS);
  console.log('Connected.');

  await cdp.send('Page.enable');

  console.log(`Navigating to ${NPM_SIGNUP_URL}...`);
  const navResult = await cdp.send('Page.navigate', { url: NPM_SIGNUP_URL });
  console.log('Nav result:', JSON.stringify(navResult));

  // Wait for page load
  await Promise.race([
    new Promise(r => cdp.on('Page.loadEventFired', r)),
    sleep(15000),
  ]);
  console.log('Page load event fired (or timeout).');

  // Extra wait for JS rendering
  await sleep(3000);

  // Check current URL
  const urlResult = await cdp.send('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  });
  console.log('Current URL:', urlResult?.result?.value);

  // Check page title
  const titleResult = await cdp.send('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  });
  console.log('Page title:', titleResult?.result?.value);

  // Check body text (first 500 chars)
  const bodyText = await cdp.send('Runtime.evaluate', {
    expression: 'document.body?.innerText?.slice(0, 500) || "NO BODY"',
    returnByValue: true,
  });
  console.log('Body text preview:\n', bodyText?.result?.value);

  // Check for signup form fields
  const formCheck = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      allInputs: Array.from(document.querySelectorAll('input')).map(i => ({name: i.name, type: i.type, id: i.id, placeholder: i.placeholder})).slice(0, 10),
      cloudflare: document.body?.innerText?.toLowerCase().includes('cloudflare') || false,
      forms: document.querySelectorAll('form').length,
    })`,
    returnByValue: true,
  });
  console.log('Form state:', formCheck?.result?.value);

  // Take screenshot
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
    writeFileSync('/Users/davenportmini/clawd/projects/harnessview/npm-signup-screenshot.jpg', Buffer.from(screenshot.data, 'base64'));
    console.log('Screenshot saved.');
  } catch (e) {
    console.log('Screenshot failed:', e.message);
  }

  cdp.ws.close();
  console.log('Done.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
