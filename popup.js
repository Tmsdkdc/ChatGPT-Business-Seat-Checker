"use strict";

const ui = {};
let currentQuote = null;
let isBusy = false;
const wiseRateCache = new Map();
const WISE_RATE_CACHE_MS = 5 * 60 * 1000;

document.addEventListener("DOMContentLoaded", () => {
  Object.assign(ui, {
    statusBadge: document.getElementById("statusBadge"),
    notice: document.getElementById("notice"),
    workspaceSelect: document.getElementById("workspaceSelect"),
    workspaceId: document.getElementById("workspaceId"),
    refreshButton: document.getElementById("refreshButton"),
    loadingView: document.getElementById("loadingView"),
    loadingTitle: document.getElementById("loadingTitle"),
    loadingDetail: document.getElementById("loadingDetail"),
    resultView: document.getElementById("resultView"),
    standardSeats: document.getElementById("standardSeats"),
    premiumSeats: document.getElementById("premiumSeats"),
    standardPrice: document.getElementById("standardPrice"),
    standardRmb: document.getElementById("standardRmb"),
    premiumPrice: document.getElementById("premiumPrice"),
    premiumRmb: document.getElementById("premiumRmb"),
    premiumNote: document.getElementById("premiumNote"),
    ratePanel: document.getElementById("ratePanel"),
    rateText: document.getElementById("rateText"),
    rateMeta: document.getElementById("rateMeta"),
    wiseLink: document.getElementById("wiseLink"),
    billingInterval: document.getElementById("billingInterval"),
    renewalDate: document.getElementById("renewalDate"),
    checkedAt: document.getElementById("checkedAt"),
    copyButton: document.getElementById("copyButton"),
  });

  ui.refreshButton.addEventListener("click", () => {
    wiseRateCache.clear();
    discoverAndQuote();
  });
  ui.workspaceSelect.addEventListener("change", quoteSelectedWorkspace);
  ui.copyButton.addEventListener("click", copyResult);

  discoverAndQuote();
});

async function discoverAndQuote() {
  if (isBusy) return;

  clearNotice();
  currentQuote = null;
  setBusy(true, "正在读取登录状态", "正在查找你有权限的 Business Workspace…");
  ui.resultView.hidden = true;

  try {
    const data = await invokePageCommand({ action: "discover" });
    populateWorkspaces(data.workspaces, data.currentWorkspaceId);
    setBusy(false);
    await quoteSelectedWorkspace();
  } catch (error) {
    showError(error);
  }
}

function populateWorkspaces(workspaces, currentWorkspaceId) {
  ui.workspaceSelect.replaceChildren();

  for (const workspace of workspaces) {
    const option = document.createElement("option");
    option.value = workspace.id;
    option.textContent = workspace.name;
    option.dataset.structure = workspace.structure || "workspace";
    ui.workspaceSelect.append(option);
  }

  const preferred = workspaces.find((row) => row.id === currentWorkspaceId);
  ui.workspaceSelect.value = preferred?.id || workspaces[0]?.id || "";
  ui.workspaceSelect.disabled = workspaces.length < 2;
  updateWorkspaceId();
}

async function quoteSelectedWorkspace() {
  if (isBusy || !ui.workspaceSelect.value) return;

  clearNotice();
  updateWorkspaceId();
  setBusy(true, "正在计算实时费用", "正在分别预览 Standard +1 与 Premium +1…");
  ui.resultView.hidden = true;

  try {
    const quote = await invokePageCommand({
      action: "quote",
      workspaceId: ui.workspaceSelect.value,
    });

    let exchange;
    try {
      exchange = await fetchWiseRate(quote.standard.currency);
    } catch (error) {
      exchange = {
        ok: false,
        source: quote.standard.currency,
        target: "CNY",
        error: error instanceof Error ? error.message : String(error || "汇率获取失败"),
        url: wiseCurrencyUrl(quote.standard.currency),
      };
    }

    currentQuote = enrichWithRmb(quote, exchange);
    renderQuote(currentQuote);
    setBusy(false);
    setStatus("检测完成", "ready");
  } catch (error) {
    showError(error);
  }
}

function renderQuote(quote) {
  ui.standardSeats.textContent = String(quote.currentSeats.standard);
  ui.premiumSeats.textContent = String(quote.currentSeats.premium);
  ui.standardPrice.textContent = quote.standard.formatted;
  ui.standardPrice.classList.remove("is-error");
  renderRmb(ui.standardRmb, quote.standard.rmbFormatted);

  if (quote.premium.ok) {
    ui.premiumPrice.textContent = quote.premium.formatted;
    ui.premiumPrice.classList.remove("is-error");
    renderRmb(ui.premiumRmb, quote.premium.rmbFormatted);
    ui.premiumNote.textContent = "本账期立即应付";
  } else {
    ui.premiumPrice.textContent = "暂不可报价";
    ui.premiumPrice.classList.add("is-error");
    renderRmb(ui.premiumRmb, "");
    ui.premiumNote.textContent = quote.premium.error || "当前订阅未返回 Premium 报价";
  }

  renderExchange(quote.exchange);

  ui.billingInterval.textContent = quote.billingInterval;
  ui.renewalDate.textContent = quote.renewal.formatted;
  ui.checkedAt.textContent = quote.checkedAt;
  ui.workspaceId.textContent = quote.workspace.id;
  ui.resultView.hidden = false;
}

function renderRmb(element, value) {
  if (value) {
    element.textContent = `≈ ${value}`;
    element.classList.remove("is-unavailable");
  } else {
    element.textContent = "人民币换算暂不可用";
    element.classList.add("is-unavailable");
  }
}

function renderExchange(exchange) {
  ui.wiseLink.href = exchange.url || "https://wise.com/zh-cn/currency-converter/";

  if (exchange.ok) {
    ui.ratePanel.classList.remove("is-error");
    ui.rateText.textContent = `1 ${exchange.source} = ${formatRate(exchange.rate)} CNY`;
    ui.rateMeta.textContent = `Wise 中间市场汇率 · ${exchange.formattedTime} · 不含支付渠道汇差`;
  } else {
    ui.ratePanel.classList.add("is-error");
    ui.rateText.textContent = "Wise 汇率暂时不可用";
    ui.rateMeta.textContent = "原币报价仍然有效，可点击 Wise 手动核对";
  }
}

function wiseCurrencyUrl(sourceCurrency) {
  const source = String(sourceCurrency || "").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(source)) {
    return "https://wise.com/zh-cn/currency-converter/";
  }
  return `https://wise.com/zh-cn/currency-converter/${source}-to-cny-rate`;
}

async function fetchWiseRate(sourceCurrency) {
  const source = String(sourceCurrency || "").trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(source)) {
    throw new Error("报价币种无效");
  }

  if (source === "CNY") {
    return {
      ok: true,
      source,
      target: "CNY",
      rate: 1,
      providerTimestamp: Date.now(),
      formattedTime: "币种相同",
      url: wiseCurrencyUrl(source),
    };
  }

  const cached = wiseRateCache.get(source);
  if (cached && Date.now() - cached.fetchedAt < WISE_RATE_CACHE_MS) {
    return cached;
  }

  const url = wiseCurrencyUrl(source);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  let response;

  try {
    response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: {
        Accept: "text/html",
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Wise 汇率请求超时");
    }
    throw new Error("无法连接 Wise 汇率页面");
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Wise 汇率请求失败：HTTP ${response.status}`);
  }

  const html = await response.text();
  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );

  if (!nextDataMatch?.[1]) {
    throw new Error("Wise 页面未返回可解析的汇率数据");
  }

  let pageData;
  try {
    pageData = JSON.parse(nextDataMatch[1]);
  } catch (_) {
    throw new Error("Wise 汇率数据格式发生变化");
  }

  const rateData = pageData?.props?.pageProps?.model?.rate;
  const rate = Number(rateData?.value);
  const returnedSource = String(rateData?.sourceCurrency?.code || "").toUpperCase();
  const returnedTarget = String(rateData?.targetCurrency?.code || "").toUpperCase();

  if (
    !Number.isFinite(rate) || rate <= 0 ||
    returnedSource !== source || returnedTarget !== "CNY"
  ) {
    throw new Error("Wise 返回的币种或汇率不匹配");
  }

  const providerTimestamp = normalizeTimestamp(rateData?.providerTimestamp);
  const result = {
    ok: true,
    source,
    target: "CNY",
    rate,
    providerTimestamp,
    formattedTime: providerTimestamp ? formatBeijingTime(providerTimestamp) : "实时数据",
    fetchedAt: Date.now(),
    url,
  };

  wiseRateCache.set(source, result);
  return result;
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function formatBeijingTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "实时数据";

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatRate(rate) {
  return new Intl.NumberFormat("zh-CN", {
    minimumSignificantDigits: 6,
    maximumSignificantDigits: 6,
  }).format(rate);
}

function formatCny(amount) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function enrichWithRmb(quote, exchange) {
  const canConvert = exchange.ok && exchange.source === quote.standard.currency;
  const standardRmb = canConvert
    ? formatCny(quote.standard.amount * exchange.rate)
    : "";
  const premiumRmb = canConvert && quote.premium.ok && quote.premium.currency === exchange.source
    ? formatCny(quote.premium.amount * exchange.rate)
    : "";

  return {
    ...quote,
    standard: {
      ...quote.standard,
      rmbFormatted: standardRmb,
    },
    premium: {
      ...quote.premium,
      rmbFormatted: premiumRmb,
    },
    exchange,
  };
}

function updateWorkspaceId() {
  ui.workspaceId.textContent = ui.workspaceSelect.value || "未选择 Workspace";
}

function setBusy(busy, title = "", detail = "") {
  isBusy = busy;
  ui.refreshButton.disabled = busy;
  ui.workspaceSelect.disabled = busy || ui.workspaceSelect.options.length < 2;
  ui.copyButton.disabled = busy;
  ui.loadingView.hidden = !busy;

  if (busy) {
    ui.loadingTitle.textContent = title;
    ui.loadingDetail.textContent = detail;
    setStatus("检测中", "loading");
  }
}

function setStatus(text, tone) {
  ui.statusBadge.textContent = text;
  ui.statusBadge.className = `status-badge is-${tone}`;
}

function clearNotice() {
  ui.notice.hidden = true;
  ui.notice.textContent = "";
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  setBusy(false);
  setStatus("检测失败", "error");
  ui.resultView.hidden = true;
  ui.notice.textContent = message;
  ui.notice.hidden = false;
}

async function getActiveChatGptTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("没有找到当前浏览器标签页。");
  }

  let url;
  try {
    url = new URL(tab.url || "");
  } catch (_) {
    throw new Error("无法读取当前页面地址，请先打开 https://chatgpt.com/。");
  }

  if (url.origin !== "https://chatgpt.com") {
    throw new Error("请先在当前标签页打开 https://chatgpt.com/，登录后再点击插件。");
  }

  return tab;
}

async function invokePageCommand(command) {
  const tab = await getActiveChatGptTab();

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pageCommand,
      args: [command],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || "");
    throw new Error(`无法在 ChatGPT 页面执行检测：${detail || "浏览器拒绝了脚本注入"}`);
  }

  const envelope = results?.[0]?.result;

  if (!envelope || typeof envelope !== "object") {
    throw new Error("ChatGPT 页面没有返回检测结果，请刷新页面后重试。");
  }

  if (!envelope.ok) {
    throw new Error(envelope.error?.message || "检测失败。");
  }

  return envelope.data;
}

async function copyResult() {
  if (!currentQuote) return;

  const premium = currentQuote.premium.ok
    ? currentQuote.premium.formatted
    : `不可用（${currentQuote.premium.error || "未返回报价"}）`;
  const premiumRmb = currentQuote.premium.ok && currentQuote.premium.rmbFormatted
    ? currentQuote.premium.rmbFormatted
    : "不可用";
  const rateLine = currentQuote.exchange.ok
    ? `Wise 中间价：1 ${currentQuote.exchange.source} = ${formatRate(currentQuote.exchange.rate)} CNY（${currentQuote.exchange.formattedTime}）`
    : "Wise 中间价：暂不可用";

  const text = [
    "ChatGPT Business 席位报价",
    `Workspace：${currentQuote.workspace.name}`,
    `Workspace ID：${currentQuote.workspace.id}`,
    `当前席位：Standard ${currentQuote.currentSeats.standard} / Premium ${currentQuote.currentSeats.premium}`,
    `Standard +1（本账期）：${currentQuote.standard.formatted} ≈ ${currentQuote.standard.rmbFormatted || "人民币换算不可用"}`,
    `Premium +1（本账期）：${premium} ≈ ${premiumRmb}`,
    rateLine,
    `计费周期：${currentQuote.billingInterval}`,
    `当前账期截止：${currentQuote.renewal.formatted}`,
    `查询时间：${currentQuote.checkedAt}`,
    "注：人民币金额按中间市场汇率估算，不含支付渠道汇差或手续费。",
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    ui.copyButton.textContent = "已复制";
    window.setTimeout(() => {
      ui.copyButton.textContent = "复制查询结果";
    }, 1400);
  } catch (_) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    ui.copyButton.textContent = "已复制";
  }
}

/*
 * This function is serialized by chrome.scripting.executeScript and runs in
 * chatgpt.com's MAIN world. It is deliberately self-contained: credentials
 * never leave the page context, and only the sanitized quote is returned.
 */
async function pageCommand(command) {
  "use strict";

  const CHATGPT_ORIGIN = "https://chatgpt.com";
  const AUTH_CLAIM = "https://api.openai.com/auth";
  const ZERO_DECIMAL_CURRENCIES = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
    "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF",
  ]);
  const THREE_DECIMAL_CURRENCIES = new Set([
    "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
  ]);
  const FOUR_DECIMAL_CURRENCIES = new Set(["CLF", "UYW"]);

  function firstText(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  }

  function safeErrorMessage(error) {
    const message = firstText(error?.message, error, "未知错误");
    return message.slice(0, 500);
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = Math.random() * 16 | 0;
      const value = char === "x" ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function decodeJwtClaims(token) {
    const part = String(token || "").split(".")[1];
    if (!part) return {};

    try {
      const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const bytes = Uint8Array.from(atob(padded), (value) => value.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      return {};
    }
  }

  function authContext(session) {
    const account = session?.account && typeof session.account === "object"
      ? session.account
      : {};
    const claims = decodeJwtClaims(session?.accessToken || session?.access_token);
    const auth = claims?.[AUTH_CLAIM] && typeof claims[AUTH_CLAIM] === "object"
      ? claims[AUTH_CLAIM]
      : {};

    return {
      accessToken: firstText(session?.accessToken, session?.access_token),
      accountId: firstText(
        auth.chatgpt_account_id,
        auth.poid,
        session?.chatgpt_account_id,
        session?.account_id,
        session?.workspace_id,
        account.id,
        account.account_id,
      ),
    };
  }

  async function requestJson(url, options = {}, label = "请求") {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let data = {};

    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = {};
      }
    }

    if (!response.ok) {
      const apiError = data?.error && typeof data.error === "object" ? data.error : {};
      const detail = firstText(
        apiError.message,
        apiError.code,
        data?.message,
        data?.detail,
        text.slice(0, 220),
      );
      throw new Error(`${label}失败：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`${label}失败：响应不是 JSON 对象`);
    }

    return data;
  }

  function workspaceRows(payload) {
    const accounts = payload?.accounts && typeof payload.accounts === "object"
      ? payload.accounts
      : {};
    const ordering = Array.isArray(payload?.account_ordering)
      ? payload.account_ordering.map(String)
      : Object.keys(accounts);
    const ids = [...new Set([...ordering, ...Object.keys(accounts)])];

    return ids
      .map((key) => {
        const wrapper = accounts[key] && typeof accounts[key] === "object"
          ? accounts[key]
          : {};
        const account = wrapper.account && typeof wrapper.account === "object"
          ? wrapper.account
          : wrapper;

        return {
          id: firstText(account.account_id, account.id, wrapper.account_id, key),
          name: firstText(
            account.name,
            account.workspace_name,
            wrapper.name,
            wrapper.workspace_name,
            key,
          ),
          structure: firstText(account.structure, wrapper.structure).toLowerCase(),
          deactivated: account.is_deactivated === true || wrapper.is_deactivated === true,
        };
      })
      .filter((row) => row.id && !row.deactivated && row.structure !== "personal");
  }

  async function loadSessionAndWorkspaces() {
    const session = await requestJson("/api/auth/session", {}, "读取登录会话");
    const context = authContext(session);

    if (!context.accessToken) {
      throw new Error("当前页面没有有效登录会话，请重新登录 ChatGPT 后再试。");
    }

    const accounts = await requestJson(
      "/backend-api/accounts/check/v4-2023-04-27",
      {
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
        },
      },
      "读取 Workspace 列表",
    );
    const workspaces = workspaceRows(accounts);

    if (!workspaces.length) {
      throw new Error("当前登录账号没有可用的 Team / Business Workspace。");
    }

    return { session, context, workspaces };
  }

  function cookieState(name) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match
      ? { exists: true, value: decodeURIComponent(match[1]) }
      : { exists: false, value: "" };
  }

  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=Lax`;
  }

  function clearCookie(name) {
    document.cookie = `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  }

  async function workspaceSession(workspaceId, initialSession) {
    const initial = authContext(initialSession);

    if (initial.accountId === workspaceId && initial.accessToken) {
      return initial;
    }

    const query = new URLSearchParams({
      exchange_workspace_token: "true",
      workspace_id: workspaceId,
      reason: "setCurrentAccount",
    });
    const contextCookies = [
      ["_account", workspaceId],
      ["_account_is_fedramp", "false"],
      ["_account_residency_region", "no_constraint"],
    ];
    const previousCookies = new Map(
      contextCookies.map(([name]) => [name, cookieState(name)]),
    );

    let session;
    try {
      for (const [name, value] of contextCookies) {
        setCookie(name, value);
      }

      session = await requestJson(
        `/api/auth/session?${query}`,
        {
          headers: {
            "X-OpenAI-Target-Path": "/api/auth/session",
            "X-OpenAI-Target-Route": "/api/auth/session",
          },
        },
        "切换 Workspace 上下文",
      );
    } finally {
      for (const [name] of contextCookies) {
        const previous = previousCookies.get(name);
        if (previous?.exists) {
          setCookie(name, previous.value);
        } else {
          clearCookie(name);
        }
      }
    }

    const context = authContext(session);

    if (!context.accessToken) {
      throw new Error("Workspace 会话未返回有效 Access Token。");
    }

    if (context.accountId && context.accountId !== workspaceId) {
      throw new Error(`Workspace 切换结果不匹配：${context.accountId}`);
    }

    return { ...context, accountId: workspaceId };
  }

  async function previewSeatMix(
    accessToken,
    workspaceId,
    defaultQuantity,
    premiumQuantity,
    flowId,
    label,
  ) {
    if (
      !Number.isInteger(defaultQuantity) || defaultQuantity < 0 ||
      !Number.isInteger(premiumQuantity) || premiumQuantity < 0
    ) {
      throw new Error("席位数量无效。");
    }

    return requestJson(
      "/backend-api/subscriptions/update/preview",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": workspaceId,
          "Content-Type": "application/json",
          "X-OpenAI-Target-Path": "/backend-api/subscriptions/update/preview",
          "X-OpenAI-Target-Route": "/backend-api/subscriptions/update/preview",
        },
        body: JSON.stringify({
          account_id: workspaceId,
          flow_id: flowId,
          mutation_attempt_id: randomId(),
          updated_seat_quantities: [
            { seat_type: "default", quantity: defaultQuantity },
            { seat_type: "prolite", quantity: premiumQuantity },
          ],
        }),
      },
      label,
    );
  }

  async function legacyRenewalPreview(accessToken, workspaceId, updatedSeats) {
    const query = new URLSearchParams({
      account_id: workspaceId,
      updated_seats: String(updatedSeats),
    });

    return requestJson(
      `/backend-api/subscriptions/update/preview?${query}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": workspaceId,
        },
      },
      "读取账期截止时间",
    );
  }

  function seatQuantity(preview, seatType) {
    const rows = preview?.current_recurring?.seat_quantities;
    if (!Array.isArray(rows)) return null;

    const row = rows.find((item) => item?.seat_type === seatType);
    if (!row) return seatType === "prolite" ? 0 : null;

    const quantity = Number(row.quantity);
    return Number.isInteger(quantity) && quantity >= 0 ? quantity : null;
  }

  function currencyMinorUnit(currency) {
    if (ZERO_DECIMAL_CURRENCIES.has(currency)) return 0;
    if (THREE_DECIMAL_CURRENCIES.has(currency)) return 3;
    if (FOUR_DECIMAL_CURRENCIES.has(currency)) return 4;
    return 2;
  }

  function amountInfo(preview) {
    const amountDue = preview?.amount_due && typeof preview.amount_due === "object"
      ? preview.amount_due
      : {};
    const rawAmount = amountDue.amount ?? preview?.total_amount;
    const currency = firstText(preview?.currency, amountDue.currency).toUpperCase();

    if (rawAmount === undefined || rawAmount === null || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error("费用预览未返回有效的金额或币种。");
    }

    const minorUnit = currencyMinorUnit(currency);
    const amount = Number(rawAmount) / 10 ** minorUnit;

    if (!Number.isFinite(amount)) {
      throw new Error("费用预览金额无效。");
    }

    let formatted;
    try {
      formatted = new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency,
        minimumFractionDigits: minorUnit,
        maximumFractionDigits: minorUnit,
      }).format(amount);
    } catch (_) {
      formatted = `${currency} ${amount.toFixed(minorUnit)}`;
    }

    return { amount, currency, minorUnit, formatted };
  }

  function billingTime(value) {
    const raw = firstText(value);
    if (!raw) return { formatted: "未返回", raw: "" };

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return { formatted: raw, raw };

    return {
      formatted: new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date) + "（北京时间）",
      raw,
    };
  }

  function checkedTime() {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()) + "（北京时间）";
  }

  function billingInterval(preview) {
    const value = firstText(
      preview?.current_recurring?.price_interval,
      preview?.proposed_recurring?.price_interval,
    );
    if (value === "month") return "月付";
    if (value === "year") return "年付";
    return value || "未返回";
  }

  try {
    if (window.location.origin !== CHATGPT_ORIGIN) {
      throw new Error("请在 https://chatgpt.com/ 页面使用本插件。");
    }

    const { action } = command && typeof command === "object" ? command : {};
    const loaded = await loadSessionAndWorkspaces();

    if (action === "discover") {
      return {
        ok: true,
        data: {
          currentWorkspaceId: loaded.context.accountId,
          workspaces: loaded.workspaces.map((row) => ({
            id: row.id,
            name: row.name,
            structure: row.structure,
          })),
        },
      };
    }

    if (action !== "quote") {
      throw new Error("未知的插件操作。");
    }

    const workspaceId = firstText(command.workspaceId);
    const workspace = loaded.workspaces.find((row) => row.id === workspaceId);

    if (!workspace) {
      throw new Error("所选 Workspace 不在当前账号的可用列表中。");
    }

    const context = await workspaceSession(workspace.id, loaded.session);
    const flowId = randomId();

    /*
     * The preview response exposes current_recurring.seat_quantities. The
     * discovery request itself is preview-only and is never confirmed.
     */
    const discovery = await previewSeatMix(
      context.accessToken,
      workspace.id,
      3,
      0,
      flowId,
      "读取当前席位结构",
    );
    const currentStandard = seatQuantity(discovery, "default");
    const currentPremium = seatQuantity(discovery, "prolite");

    if (currentStandard === null || currentPremium === null) {
      throw new Error("后端未返回完整的 Standard / Premium 当前席位数量。");
    }

    const [standardResult, premiumResult, renewalResult] = await Promise.allSettled([
      previewSeatMix(
        context.accessToken,
        workspace.id,
        currentStandard + 1,
        currentPremium,
        flowId,
        "读取 Standard +1 费用",
      ),
      previewSeatMix(
        context.accessToken,
        workspace.id,
        currentStandard,
        currentPremium + 1,
        flowId,
        "读取 Premium +1 费用",
      ),
      legacyRenewalPreview(
        context.accessToken,
        workspace.id,
        currentStandard + 1,
      ),
    ]);

    if (standardResult.status !== "fulfilled") {
      throw standardResult.reason;
    }

    const standard = amountInfo(standardResult.value);
    let premium;

    if (premiumResult.status === "fulfilled") {
      try {
        premium = { ok: true, ...amountInfo(premiumResult.value) };
      } catch (error) {
        premium = { ok: false, error: safeErrorMessage(error) };
      }
    } else {
      premium = { ok: false, error: safeErrorMessage(premiumResult.reason) };
    }

    const renewal = renewalResult.status === "fulfilled"
      ? billingTime(renewalResult.value?.renewal_date)
      : { formatted: "未返回", raw: "" };

    return {
      ok: true,
      data: {
        workspace: {
          id: workspace.id,
          name: workspace.name,
        },
        currentSeats: {
          standard: currentStandard,
          premium: currentPremium,
        },
        standard,
        premium,
        billingInterval: billingInterval(standardResult.value),
        renewal,
        checkedAt: checkedTime(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: safeErrorMessage(error),
      },
    };
  }
}
