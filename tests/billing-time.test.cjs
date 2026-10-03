"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
const START = Date.parse("2026-10-03T00:00:00Z");
const HOUR = 3_600_000;

function element() {
  const classes = new Set();
  return {
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    options: [{ value: "workspace-a" }, { value: "workspace-b" }],
    style: {},
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener() {},
    replaceChildren() {},
    append() {},
    select() {},
    remove() {},
  };
}

function harness(now = START) {
  let clock = now;
  const elements = new Map();
  const copied = [];
  const documentEvents = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  class TestDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() { return clock; }
  }
  const context = vm.createContext({
    Date: TestDate,
    Intl,
    URL,
    URLSearchParams,
    document: {
      addEventListener: (name, handler) => documentEvents.set(name, handler),
      getElementById: getElement,
      createElement: element,
      body: { append() {} },
      execCommand() { throw new Error("Unexpected legacy clipboard fallback"); },
    },
    window: {
      setTimeout() { return 1; },
      clearTimeout() {},
      setInterval() { return 2; },
      clearInterval() {},
      addEventListener() {},
    },
    navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    chrome: {
      tabs: { async query() { throw new Error("Unexpected browser access"); } },
      scripting: { async executeScript() { throw new Error("Unexpected injection"); } },
    },
    fetch() { throw new Error("Network requests are forbidden in these tests"); },
  });
  vm.runInContext(source + `
    globalThis.testApi = {
      parseBillingTimestamp, billingRemaining, billingTime, renderRemainingTime,
      enrichWithRmb, copyResult, quoteSelectedWorkspace, pageCommand, showError,
      setQuote(value) { currentQuote = value; },
      getQuote() { return currentQuote; },
      setBusy(value) { isBusy = value; },
      setInvoke(handler) { invokePageCommand = handler; },
      setUi(value) { Object.assign(ui, value); },
    };
  `, context, { filename: "popup.js" });
  const ids = [
    "statusBadge", "notice", "workspaceSelect", "workspaceId", "refreshButton",
    "loadingView", "loadingTitle", "loadingDetail", "resultView", "standardSeats",
    "premiumSeats", "standardPrice", "standardRmb", "premiumPrice", "premiumRmb",
    "premiumNote", "ratePanel", "rateText", "rateMeta", "wiseLink", "billingInterval",
    "renewalDate", "remainingHours", "checkedAt", "copyButton",
  ];
  context.testApi.setUi(Object.fromEntries(ids.map((id) => [id, getElement(id)])));
  return {
    api: context.testApi,
    getElement,
    copied,
    documentEvents,
    advance(hours) { clock += hours * HOUR; },
  };
}

function quote(id, deadline) {
  return {
    workspace: { id, name: `Workspace ${id}` },
    currentSeats: { standard: 3, premium: 0 },
    standard: { amount: 10, currency: "CNY", formatted: "¥10.00", rmbFormatted: "¥10.00" },
    premium: { ok: true, amount: 20, currency: "CNY", formatted: "¥20.00", rmbFormatted: "¥20.00" },
    exchange: { ok: true, source: "CNY", target: "CNY", rate: 1, formattedTime: "币种相同" },
    billingInterval: "月付",
    renewal: { raw: deadline, formatted: "2026/10/03 20:30:00（北京时间）" },
    checkedAt: "2026/10/03 08:00:00（北京时间）",
  };
}

test("returns 12.5 hours without rounding the numeric result", () => {
  const { api } = harness();
  const result = api.billingRemaining("2026-10-03T12:30:00Z", START);
  assert.equal(result.hours, 12.5);
  assert.equal(result.expired, false);
  assert.equal(result.label, "12.50 H");
});

test("equivalent ISO timezone offsets represent the same deadline", () => {
  const { api } = harness();
  for (const deadline of ["2026-10-03T12:30:00Z", "2026-10-03T20:30:00+08:00", "2026-10-03T05:30:00-07:00"]) {
    assert.equal(api.billingRemaining(deadline, START).hours, 12.5);
  }
});

test("accepts Unix seconds and milliseconds, including numeric strings", () => {
  const { api } = harness();
  const deadline = START + 12.5 * HOUR;
  for (const value of [deadline / 1000, deadline, String(deadline / 1000), String(deadline), `  ${deadline}  `]) {
    assert.equal(api.parseBillingTimestamp(value), deadline);
    assert.equal(api.billingRemaining(value, START).label, "12.50 H");
  }
});

test("retains fractional seconds and accepts Unix epoch zero", () => {
  const { api } = harness();
  assert.equal(api.parseBillingTimestamp("1790985600.125"), START + 125);
  assert.equal(api.parseBillingTimestamp(0), 0);
  assert.equal(api.parseBillingTimestamp("0"), 0);
  assert.equal(api.billingRemaining("1970-01-01T01:00:00Z", 0).hours, 1);
});

test("missing, malformed, unsupported and out-of-range deadlines stay unavailable", () => {
  const { api } = harness();
  for (const value of [undefined, null, "", "   ", "not-a-date", "2026-13-01T00:00:00Z", true, false, {}, [], NaN, Infinity, -Infinity, 8.64e15 + 1, -(8.64e15 + 1), "8640000000000001"]) {
    assert.equal(api.parseBillingTimestamp(value), null, `parse: ${String(value)}`);
    const result = api.billingRemaining(value, START);
    assert.equal(result.hours, null, `hours: ${String(value)}`);
    assert.equal(result.expired, false);
    assert.equal(result.label, "—");
  }
});

test("invalid current times do not produce NaN or misleading countdowns", () => {
  const { api } = harness();
  for (const now of [NaN, Infinity, -Infinity, null, "invalid"]) {
    assert.equal(api.billingRemaining("2026-10-03T12:30:00Z", now).label, "—");
  }
});

test("deadline and past deadlines show zero hours as expired", () => {
  const { api } = harness();
  for (const deadline of [START, START - 1, START - 48 * HOUR]) {
    const result = api.billingRemaining(deadline, START);
    assert.equal(result.hours, 0);
    assert.equal(result.expired, true);
    assert.equal(result.label, "0.00 H（已到期）");
  }
});

test("positive sub-0.01 hours remain visibly distinct from expiry", () => {
  const { api } = harness();
  for (const duration of [1, 18_000, 35_999]) {
    const result = api.billingRemaining(START + duration, START);
    assert.ok(result.hours > 0);
    assert.equal(result.expired, false);
    assert.equal(result.label, "< 0.01 H");
  }
  assert.equal(api.billingRemaining(START + 36_000, START).label, "0.01 H");
});

test("spans midnight, month boundaries, and durations longer than 24 hours", () => {
  const { api } = harness();
  assert.equal(api.billingRemaining("2026-11-02T01:30:00+08:00", Date.parse("2026-10-31T23:00:00+08:00")).hours, 26.5);
  assert.equal(api.billingRemaining("2026-10-04T00:30:00+08:00", Date.parse("2026-10-03T23:00:00+08:00")).hours, 1.5);
});

test("default current time is read again on every calculation", () => {
  const { api, advance } = harness();
  const deadline = "2026-10-03T12:30:00Z";
  assert.equal(api.billingRemaining(deadline).hours, 12.5);
  advance(2.25);
  assert.equal(api.billingRemaining(deadline).hours, 10.25);
  advance(10.25);
  assert.equal(api.billingRemaining(deadline).expired, true);
});

test("normalizes renewal data while keeping RMB enrichment intact", () => {
  const { api } = harness();
  const input = quote("workspace-a", (START + 12.5 * HOUR) / 1000);
  const result = api.enrichWithRmb(input, input.exchange);
  assert.equal(result.renewal.raw, "2026-10-03T12:30:00.000Z");
  assert.match(result.renewal.formatted, /20:30:00.*北京时间/);
  assert.match(result.standard.rmbFormatted, /10\.00/);
  assert.equal(result.workspace.id, "workspace-a");
  const unavailable = api.enrichWithRmb(quote("workspace-b", null), input.exchange);
  assert.equal(unavailable.renewal.raw, "");
  assert.equal(api.billingRemaining(unavailable.renewal.raw).hours, null);
});

test("rendering follows time changes and clears old expired styling", () => {
  const { api, getElement, advance } = harness();
  const display = getElement("remainingHours");
  api.setQuote(quote("workspace-a", "2026-10-03T12:30:00Z"));
  api.renderRemainingTime();
  assert.equal(display.textContent, "12.50 H");
  advance(13);
  api.renderRemainingTime();
  assert.equal(display.textContent, "0.00 H（已到期）");
  assert.equal(display.classList.contains("is-expired"), true);
  api.setQuote(null);
  api.renderRemainingTime();
  assert.equal(display.textContent, "—");
  assert.equal(display.classList.contains("is-expired"), false);
});

test("copy recalculates at click time even when the displayed value is stale", async () => {
  const { api, getElement, advance, copied } = harness();
  api.setQuote(quote("workspace-a", "2026-10-03T12:30:00Z"));
  api.renderRemainingTime();
  assert.equal(getElement("remainingHours").textContent, "12.50 H");
  advance(1.25);
  await api.copyResult();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /账期剩余时间：11\.25 H/);
  assert.match(copied[0], /Workspace ID：workspace-a/);
  advance(12);
  await api.copyResult();
  assert.match(copied[1], /账期剩余时间：0\.00 H（已到期）/);
});

test("workspace switches clear the old countdown while pending and copy only the new quote", async () => {
  const { api, getElement, copied } = harness();
  api.setQuote(quote("workspace-a", "2026-10-03T12:30:00Z"));
  api.renderRemainingTime();
  getElement("workspaceSelect").value = "workspace-b";
  let resolveQuote;
  const pending = new Promise((resolve) => { resolveQuote = resolve; });
  api.setInvoke((command) => {
    assert.equal(command.action, "quote");
    assert.equal(command.workspaceId, "workspace-b");
    return pending;
  });
  const switching = api.quoteSelectedWorkspace();
  assert.equal(api.getQuote(), null);
  assert.equal(getElement("remainingHours").textContent, "—");
  await api.copyResult();
  assert.equal(copied.length, 0);
  resolveQuote(quote("workspace-b", "2026-10-04T02:00:00Z"));
  await switching;
  assert.equal(getElement("remainingHours").textContent, "26.00 H");
  assert.equal(api.getQuote().workspace.id, "workspace-b");
  await api.copyResult();
  assert.match(copied[0], /Workspace ID：workspace-b/);
  assert.match(copied[0], /账期剩余时间：26\.00 H/);
  assert.doesNotMatch(copied[0], /workspace-a|12\.50 H/);
});

test("failed workspace queries cannot retain or copy the previous countdown", async () => {
  const { api, getElement, copied } = harness();
  api.setQuote(quote("workspace-a", "2026-10-03T12:30:00Z"));
  getElement("workspaceSelect").value = "workspace-b";
  api.setInvoke(async () => { throw new Error("Synthetic query failure"); });
  await api.quoteSelectedWorkspace();
  assert.equal(api.getQuote(), null);
  assert.equal(getElement("remainingHours").textContent, "—");
  assert.equal(getElement("resultView").hidden, true);
  await api.copyResult();
  assert.equal(copied.length, 0);
});

test("serialized page command runs independently with synthetic API responses", async () => {
  const { api } = harness();
  const requests = [];
  const deadline = (START + 12.5 * HOUR) / 1000;
  const page = vm.createContext({
    URLSearchParams,
    window: { location: { origin: "https://chatgpt.com" } },
    crypto: { randomUUID: () => "test-flow-id" },
    async fetch(url, options) {
      requests.push({ url, method: options.method || "GET" });
      let data;
      if (url === "/api/auth/session") {
        data = { accessToken: "synthetic-test-token", account_id: "workspace-a" };
      } else if (url === "/backend-api/accounts/check/v4-2023-04-27") {
        data = { accounts: { "workspace-a": { account: { id: "workspace-a", name: "Synthetic workspace", structure: "workspace" } } } };
      } else if (url === "/backend-api/subscriptions/update/preview" && options.method === "POST") {
        data = {
          currency: "CNY",
          amount_due: { amount: 1000 },
          current_recurring: { price_interval: "month", seat_quantities: [{ seat_type: "default", quantity: 3 }, { seat_type: "prolite", quantity: 0 }] },
        };
      } else if (url.startsWith("/backend-api/subscriptions/update/preview?") && !options.method) {
        data = { renewal_date: deadline };
      } else {
        throw new Error(`Unexpected request: ${url}`);
      }
      return { ok: true, status: 200, async text() { return JSON.stringify(data); } };
    },
  });
  const injected = vm.runInContext(`(${api.pageCommand.toString()})`, page);
  const result = await injected({ action: "quote", workspaceId: "workspace-a" });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.data.workspace.id, "workspace-a");
  assert.equal(result.data.renewal.raw, deadline);
  assert.equal(result.data.currentSeats.standard, 3);
  assert.equal(requests.length, 6);
  const enriched = api.enrichWithRmb(result.data, { ok: true, source: "CNY", target: "CNY", rate: 1 });
  assert.equal(api.billingRemaining(enriched.renewal.raw).label, "12.50 H");
});
