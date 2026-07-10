const SHEET_URL = "https://docs.google.com/spreadsheets/d/1yUfreitpLB9QSbUnygiqAfQhk4HYUCF0HWf_tEO-Vw4/edit?usp=sharing";
const DEFAULT_SCRIPT_ENDPOINT = "https://script.google.com/macros/s/AKfycbznl7KQLWVlJjrtoeBzY3ILIRc2xvz4VE0v6Uhbp3FeapRmw5YDtjBoBpUl_NEaqSLv/exec";
const BANNER_CHUNK_SIZE = 45000;
const MAX_BANNER_CHUNKS = 12;
const SUBSCRIPTION_PRICE_CENTS = 799;
const TRIAL_DAYS = 15;
const STORE_KEYS = {
  users: "expolead.users",
  campaigns: "expolead.campaigns",
  leads: "expolead.leads",
  session: "expolead.session",
  settings: "expolead.settings",
};

const state = {
  user: null,
  selectedCampaign: null,
  leadSearch: "",
  leadPage: 1,
  accountQrSearch: "",
  accountQrPage: 1,
  adminSearch: "",
  adminPage: 1,
  adminData: {
    accounts: [],
    campaigns: [],
    leads: [],
  },
};

const LEADS_PER_PAGE = 20;
const ACCOUNT_QR_PER_PAGE = 12;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function getSettings() {
  return {
    endpoint: DEFAULT_SCRIPT_ENDPOINT,
    sheetUrl: SHEET_URL,
  };
}

async function syncToSheet(action, payload, options = {}) {
  const { endpoint } = getSettings();
  if (!endpoint) return { ok: false, skipped: true };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      keepalive: Boolean(options.keepalive),
      body: JSON.stringify({ action, payload }),
    });
    const text = await response.text();
    if (!text) return { ok: true };
    try {
      return JSON.parse(text);
    } catch (error) {
      return {
        ok: false,
        message: "Apps Script returned a non-JSON error. Check the Apps Script deployment logs.",
        error: text.slice(0, 500),
      };
    }
  } catch (error) {
    console.warn("Sheet sync failed", error);
    return { ok: false, message: String(error), error: String(error) };
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncLeadToSheet(lead) {
  const firstAttempt = await syncToSheet("saveLead", lead, { keepalive: true });
  if (firstAttempt.ok) return firstAttempt;

  await wait(450);
  const secondAttempt = await syncToSheet("saveLead", lead, { keepalive: true });
  if (secondAttempt.ok) return secondAttempt;

  const { endpoint } = getSettings();
  if (!endpoint) return secondAttempt;

  try {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "saveLead", payload: lead }),
    });
    return { ok: true, fallback: true };
  } catch (error) {
    return {
      ok: false,
      message: secondAttempt.message || "Lead could not be synced to Google Sheets.",
      error: String(error),
    };
  }
}

function chunkText(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function normalizeDestinationUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function prepareBanner(file) {
  if (!file) return null;
  const dataUrl = await readImageFile(file);
  const image = await loadImage(dataUrl);
  const maxWidth = 1400;
  const maxHeight = 520;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  const bannerDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const bannerChunks = chunkText(bannerDataUrl, BANNER_CHUNK_SIZE);
  if (bannerChunks.length > MAX_BANNER_CHUNKS) {
    throw new Error("Banner image is too large. Please choose a smaller image.");
  }
  return {
    bannerDataUrl,
    bannerMime: "image/jpeg",
    bannerChunkCount: bannerChunks.length,
    bannerChunks,
  };
}

function applyCaptureBanner(campaign) {
  const hero = document.querySelector(".capture-hero");
  if (!hero) return;
  if (campaign?.bannerDataUrl) {
    hero.style.backgroundImage = `linear-gradient(90deg, rgba(16, 38, 38, 0.88), rgba(16, 38, 38, 0.42)), url("${campaign.bannerDataUrl}")`;
  } else {
    hero.style.backgroundImage = "";
  }
}

function trialDaysRemaining(user) {
  if (!user?.createdAt) return TRIAL_DAYS;
  const createdAt = new Date(user.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return TRIAL_DAYS;
  const trialEndsAt = createdAt + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const remainingMs = trialEndsAt - Date.now();
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

function hasSubscriptionAccess(user) {
  if (isAdmin(user)) return true;
  return trialDaysRemaining(user) > 0 || Boolean(user?.subscriptionActive);
}

function accountStatusMessage(user) {
  if (!user) return "";
  if (isAdmin(user)) return "Admin account. Full access is enabled.";
  if (user.subscriptionActive) {
    return `Subscription active${user.subscriptionStatus ? `: ${user.subscriptionStatus}` : ""}. QR Dashboard access is enabled.`;
  }
  const remainingDays = trialDaysRemaining(user);
  if (remainingDays > 0) {
    return `Trial active: ${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining. QR Dashboard access is enabled.`;
  }
  return "Trial ended. Subscribe to access QR Dashboard.";
}

function accountStatusLabel(user) {
  if (!user) return "15-day trial from account creation, then $7.99 per month.";
  if (isAdmin(user)) return "Admin access";
  if (user.subscriptionActive) return "Monthly subscription active";
  return trialDaysRemaining(user) > 0 ? "Free trial active" : "Subscription required";
}

function isAdmin(user = state.user) {
  return user?.role === "admin";
}

function roleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "organizer") return "Expo Organiser";
  return "Exhibitor";
}

function accountReturnUrl() {
  const url = new URL(window.location.href);
  url.hash = "auth";
  return url.toString();
}

function setMobileMenu(open) {
  const panel = document.querySelector(".side-panel");
  const button = $("#menuToggleButton");
  if (!panel || !button) return;
  panel.classList.toggle("menu-open", open);
  button.setAttribute("aria-expanded", open ? "true" : "false");
  button.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
}

function setView(name) {
  const isCustomerScanRoute = name === "capture" && window.location.hash.replace(/^#/, "").startsWith("capture/");
  if (name === "capture" && !isCustomerScanRoute) {
    name = "auth";
  }
  if ((name === "dashboard" || name === "capture") && !isCustomerScanRoute && state.user && !hasSubscriptionAccess(state.user)) {
    toast("Your trial has ended. Subscribe to access QR Dashboard.");
    name = "auth";
  }
  if ((name === "dashboard" || name === "capture") && !isCustomerScanRoute && isAdmin()) {
    name = "admin";
  }
  if (name === "admin" && !isAdmin()) {
    toast("Admin access is required.");
    name = "auth";
  }
  $$(".view").forEach((view) => view.classList.remove("active"));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.viewButton === name));
  $(`#${name}View`).classList.add("active");
}

function scanUrl(campaignId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `capture/${campaignId}`;
  return url.toString();
}

function updateAuthUi() {
  const label = $("#currentUser");
  const logout = $("#logoutButton");
  const navButtons = $$("[data-view-button]");
  const authTitle = $("#authTitle");
  const accountManagement = $("#accountManagement");
  const accountUserSummary = $("#accountUserSummary");
  const trialStatusText = $("#trialStatusText");
  const subscriptionStatus = $("#subscriptionStatus");
  const subscribeButton = $("#subscribeButton");
  if (!state.user) {
    document.querySelector(".app-shell").classList.add("public-mode");
    authTitle.textContent = "Create or open an account";
    label.textContent = "No account signed in";
    logout.classList.add("hidden");
    $("#signupForm").classList.remove("hidden");
    $("#loginForm").classList.remove("hidden");
    accountManagement.classList.add("hidden");
    navButtons.forEach((button) => button.classList.add("hidden"));
    renderAccountQrList();
    return;
  }
  document.querySelector(".app-shell").classList.remove("public-mode");
  const hasAccess = hasSubscriptionAccess(state.user);
  navButtons.forEach((button) => {
    const captureView = button.dataset.viewButton === "capture";
    const gatedView = button.dataset.viewButton === "dashboard";
    const adminView = button.dataset.viewButton === "admin";
    button.classList.toggle("hidden", captureView || (gatedView && (!hasAccess || isAdmin())) || (adminView && !isAdmin()));
  });
  const activeView = document.querySelector(".view.active")?.id;
  if ((!hasAccess || isAdmin()) && (activeView === "dashboardView" || activeView === "captureView")) {
    setView(isAdmin() ? "admin" : "auth");
  }
  label.textContent = `${state.user.name} signed in as ${roleLabel(state.user.role)}`;
  authTitle.textContent = "Account settings";
  accountUserSummary.textContent = `${state.user.name} - ${state.user.email}`;
  subscriptionStatus.textContent = accountStatusLabel(state.user);
  trialStatusText.textContent = accountStatusMessage(state.user);
  subscribeButton.disabled = Boolean(state.user.subscriptionActive) || isAdmin();
  subscribeButton.textContent = state.user.subscriptionActive
    ? "Subscription active"
    : isAdmin()
    ? "Admin access enabled"
    : "Start subscription";
  $("#signupForm").classList.add("hidden");
  $("#loginForm").classList.add("hidden");
  accountManagement.classList.remove("hidden");
  logout.classList.remove("hidden");
  $("#destinationField").classList.toggle("hidden", state.user.role !== "presenter");
  $("#verifyPanel").classList.toggle("hidden", state.user.role !== "organizer");
  renderAccountQrList();
}

async function refreshAccountFromSheet() {
  if (!state.user) return { ok: false };
  const result = await syncToSheet("getAccount", {
    userId: state.user.id,
    email: state.user.email,
  });
  if (!result.ok || !result.user) return result;

  state.user = saveLocalUser({
    ...state.user,
    ...result.user,
    passwordHash: state.user.passwordHash,
  });
  updateAuthUi();
  return { ok: true, user: state.user };
}

function campaignsForUser() {
  if (!state.user) return [];
  return readStore(STORE_KEYS.campaigns, []).filter((campaign) => campaign.ownerId === state.user.id);
}

function leadsForUser() {
  if (!state.user) return [];
  const campaignIds = new Set(campaignsForUser().map((campaign) => campaign.id));
  return readStore(STORE_KEYS.leads, []).filter((lead) => campaignIds.has(lead.campaignId));
}

function adminCampaigns() {
  return state.adminData.campaigns || [];
}

function adminLeads() {
  return state.adminData.leads || [];
}

function adminAccounts() {
  return state.adminData.accounts || [];
}

function leadMatchesSearch(lead, campaign, query) {
  if (!query) return true;
  const haystack = [
    lead.customerName,
    lead.phone,
    lead.email,
    lead.salesPerson,
    lead.notes,
    lead.badgeNumber,
    campaign?.title,
    campaign?.eventName,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function saveLocalCampaign(campaign) {
  if (!campaign?.id) return null;
  const { bannerChunks, ...campaignForStorage } = campaign;
  const campaigns = readStore(STORE_KEYS.campaigns, []);
  const existingIndex = campaigns.findIndex((item) => item.id === campaignForStorage.id);
  if (existingIndex >= 0) {
    campaigns[existingIndex] = { ...campaigns[existingIndex], ...campaignForStorage };
  } else {
    campaigns.push(campaignForStorage);
  }
  writeStore(STORE_KEYS.campaigns, campaigns);
  return campaigns.find((item) => item.id === campaignForStorage.id);
}

function replaceLocalUserData(campaigns, leads) {
  const incomingCampaigns = Array.isArray(campaigns) ? campaigns : [];
  const incomingLeads = Array.isArray(leads) ? leads : [];
  incomingCampaigns.forEach(saveLocalCampaign);

  const campaignIds = new Set(incomingCampaigns.map((campaign) => campaign.id));
  if (!campaignIds.size) return;

  const existingLeads = readStore(STORE_KEYS.leads, []);
  const otherLeads = existingLeads.filter((lead) => !campaignIds.has(lead.campaignId));
  writeStore(STORE_KEYS.leads, [...otherLeads, ...incomingLeads]);
}

async function getCampaignById(campaignId, options = {}) {
  const localCampaign = readStore(STORE_KEYS.campaigns, []).find((item) => item.id === campaignId);
  if (localCampaign && !options.preferSheet) return localCampaign;

  const result = await syncToSheet("getCampaign", { campaignId });
  if (result.ok && result.campaign) {
    return saveLocalCampaign(result.campaign);
  }

  if (options.requireSheet) return null;
  return localCampaign || null;
}

function populateCampaignSelect(select, allLabel) {
  if (!select) return;

  const selectedValue = select.value || "all";
  const campaigns = campaignsForUser().sort((a, b) => {
    const first = `${a.eventName || ""} ${a.title || ""}`;
    const second = `${b.eventName || ""} ${b.title || ""}`;
    return first.localeCompare(second);
  });

  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  campaigns.forEach((campaign) => {
    const option = document.createElement("option");
    option.value = campaign.id;
    option.textContent = `${campaign.eventName || campaign.title} - ${campaign.title}`;
    select.appendChild(option);
  });

  select.value = campaigns.some((campaign) => campaign.id === selectedValue) ? selectedValue : "all";
}

function updateCampaignSelectors() {
  populateCampaignSelect($("#csvCampaignSelect"), "All expo batches");
  populateCampaignSelect($("#verifyCampaignSelect"), "All campaigns");
}

function accountCampaigns() {
  if (!state.user) return [];
  return isAdmin()
    ? adminCampaigns()
    : campaignsForUser();
}

function populateAdminCampaignSelect() {
  const select = $("#adminCampaignSelect");
  if (!select) return;

  const selectedValue = select.value || "all";
  const campaigns = adminCampaigns().slice().sort((a, b) => {
    const first = `${a.eventName || ""} ${a.title || ""} ${a.ownerName || ""}`;
    const second = `${b.eventName || ""} ${b.title || ""} ${b.ownerName || ""}`;
    return first.localeCompare(second);
  });

  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All events";
  select.appendChild(allOption);

  campaigns.forEach((campaign) => {
    const option = document.createElement("option");
    option.value = campaign.id;
    option.textContent = `${campaign.eventName || campaign.title} - ${campaign.title} (${campaign.ownerName || "Unknown"})`;
    select.appendChild(option);
  });

  select.value = campaigns.some((campaign) => campaign.id === selectedValue) ? selectedValue : "all";
}

function populateAdminManagementForms() {
  populateAdminUserSelect();
  populateAdminEventSelects();
}

function populateAdminUserSelect() {
  const select = $("#adminUserSelect");
  if (!select) return;

  const selectedValue = select.value;
  select.innerHTML = `<option value="">Choose user</option>`;
  adminAccounts()
    .slice()
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")))
    .forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.name || account.email} - ${roleLabel(account.role)}`;
      select.appendChild(option);
    });
  select.value = adminAccounts().some((account) => account.id === selectedValue) ? selectedValue : "";
  fillAdminUserForm(select.value);
}

function populateAdminEventSelects() {
  const eventSelect = $("#adminEventSelect");
  const ownerSelect = $("#adminEventOwnerSelect");
  if (!eventSelect || !ownerSelect) return;

  const selectedEvent = eventSelect.value;
  const selectedOwner = ownerSelect.value;

  eventSelect.innerHTML = `<option value="">Choose event</option>`;
  adminCampaigns()
    .slice()
    .sort((a, b) => `${a.eventName || ""} ${a.title || ""}`.localeCompare(`${b.eventName || ""} ${b.title || ""}`))
    .forEach((campaign) => {
      const option = document.createElement("option");
      option.value = campaign.id;
      option.textContent = `${campaign.eventName || campaign.title} - ${campaign.title}`;
      eventSelect.appendChild(option);
    });
  eventSelect.value = adminCampaigns().some((campaign) => campaign.id === selectedEvent) ? selectedEvent : "";

  ownerSelect.innerHTML = `<option value="">Choose owner</option>`;
  adminAccounts()
    .filter((account) => account.role !== "admin")
    .slice()
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")))
    .forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.name || account.email} - ${roleLabel(account.role)}`;
      ownerSelect.appendChild(option);
    });
  ownerSelect.value = adminAccounts().some((account) => account.id === selectedOwner) ? selectedOwner : "";
  fillAdminEventForm(eventSelect.value);
}

function fillAdminUserForm(userId) {
  const form = $("#adminUserForm");
  if (!form) return;
  const account = adminAccounts().find((item) => item.id === userId);
  form.name.value = account?.name || "";
  form.email.value = account?.email || "";
  form.role.value = account?.role || "presenter";
  form.subscriptionStatus.value = account?.subscriptionStatus || "";
  form.temporaryPassword.value = "";
}

function fillAdminEventForm(campaignId) {
  const form = $("#adminEventForm");
  if (!form) return;
  const campaign = adminCampaigns().find((item) => item.id === campaignId);
  form.ownerId.value = campaign?.ownerId || "";
  form.type.value = campaign?.type === "organizer" ? "organizer" : "presenter";
  form.title.value = campaign?.title || "";
  form.eventName.value = campaign?.eventName || "";
  form.destinationUrl.value = campaign?.destinationUrl || "";
  form.banner.value = "";
  form.clearBanner.checked = false;
  $("#adminBannerPreview").classList.add("hidden");
  $("#adminBannerPreview").style.backgroundImage = "";
}

function renderQr(campaign) {
  state.selectedCampaign = campaign;
  const target = scanUrl(campaign.id);
  const holder = $("#qrCode");
  $("#qrEmpty").classList.add("hidden");
  $("#scanLinkText").textContent = target;
  drawQrInto(holder, target, 240);
}

function renderAccountQrList() {
  const list = $("#accountQrList");
  if (!list) return;
  if (!state.user) {
    list.innerHTML = "";
    updateAccountQrPagination(0, 1);
    return;
  }

  const query = state.accountQrSearch.trim().toLowerCase();
  const campaigns = accountCampaigns().slice().sort((a, b) => {
    const firstDate = String(b.createdAt || "");
    const secondDate = String(a.createdAt || "");
    return firstDate.localeCompare(secondDate);
  }).filter((campaign) => accountQrMatchesSearch(campaign, query));
  const pageCount = Math.max(1, Math.ceil(campaigns.length / ACCOUNT_QR_PER_PAGE));
  state.accountQrPage = Math.min(Math.max(state.accountQrPage, 1), pageCount);
  const pageStart = (state.accountQrPage - 1) * ACCOUNT_QR_PER_PAGE;
  const visibleCampaigns = campaigns.slice(pageStart, pageStart + ACCOUNT_QR_PER_PAGE);

  if (!campaigns.length) {
    list.innerHTML = `<p class="current-user">${query ? "No QR events match your search." : isAdmin() ? "No event QR codes found yet." : "No event QR codes created yet."}</p>`;
    updateAccountQrPagination(0, 1);
    return;
  }

  list.innerHTML = "";
  visibleCampaigns.forEach((campaign) => {
    const card = document.createElement("article");
    card.className = "account-qr-card";
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(campaign.eventName || campaign.title || "Untitled event")}</h3>
        <p>${escapeHtml(campaign.title || "")}</p>
        <p>${escapeHtml(isAdmin() ? `${campaign.ownerName || "Unknown owner"} - ${roleLabel(campaign.type)}` : roleLabel(campaign.type))}</p>
      </div>
      <div class="account-qr-code" data-account-qr-code="${escapeHtml(campaign.id)}"></div>
      <div class="qr-actions">
        <button class="secondary-button" type="button" data-account-download-qr="${escapeHtml(campaign.id)}">Download QR</button>
        <button class="ghost-button" type="button" data-account-copy-link="${escapeHtml(campaign.id)}">Copy link</button>
      </div>
    `;
    list.appendChild(card);
    drawQrInto(card.querySelector("[data-account-qr-code]"), scanUrl(campaign.id), 132);
  });
  updateAccountQrPagination(campaigns.length, pageCount);
}

function accountQrMatchesSearch(campaign, query) {
  if (!query) return true;
  const haystack = [
    campaign.title,
    campaign.eventName,
    campaign.ownerName,
    roleLabel(campaign.type),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function updateAccountQrPagination(totalRows, pageCount) {
  const pageInfo = $("#accountQrPageInfo");
  const prevButton = $("#accountQrPrevButton");
  const nextButton = $("#accountQrNextButton");
  if (!pageInfo || !prevButton || !nextButton) return;

  pageInfo.textContent = totalRows
    ? `Page ${state.accountQrPage} of ${pageCount}`
    : "Page 1 of 1";
  prevButton.disabled = state.accountQrPage <= 1 || !totalRows;
  nextButton.disabled = state.accountQrPage >= pageCount || !totalRows;
}

function drawQrInto(holder, text, size) {
  if (!holder) return;
  holder.innerHTML = "";
  if (window.QRCode) {
    new QRCode(holder, {
      text,
      width: size,
      height: size,
      colorDark: "#152123",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
  } else {
    holder.textContent = text;
  }
}

function renderLeads() {
  const tbody = $("#leadTable");
  updateCampaignSelectors();
  const campaigns = readStore(STORE_KEYS.campaigns, []);
  const campaignLookup = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const query = state.leadSearch.trim().toLowerCase();
  const rows = leadsForUser()
    .filter((lead) => leadMatchesSearch(lead, campaignLookup.get(lead.campaignId), query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pageCount = Math.max(1, Math.ceil(rows.length / LEADS_PER_PAGE));
  state.leadPage = Math.min(Math.max(state.leadPage, 1), pageCount);
  const pageStart = (state.leadPage - 1) * LEADS_PER_PAGE;
  const visibleRows = rows.slice(pageStart, pageStart + LEADS_PER_PAGE);
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">${query ? "No leads match your search." : "No leads captured yet."}</td></tr>`;
    updateLeadPagination(0, 1);
    return;
  }

  for (const lead of visibleRows) {
    const campaign = campaignLookup.get(lead.campaignId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(lead.customerName)}</td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${escapeHtml(lead.email)}</td>
      <td>${escapeHtml(lead.salesPerson || "")}</td>
      <td>${escapeHtml(lead.notes || "")}</td>
      <td>${escapeHtml(campaign?.title || "Unknown")}</td>
      <td>${escapeHtml(lead.badgeNumber || "")}</td>
      <td>${new Date(lead.createdAt).toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  }
  updateLeadPagination(rows.length, pageCount);
}

function adminLeadMatchesSearch(lead, campaign, query) {
  if (!query) return true;
  const haystack = [
    lead.customerName,
    lead.phone,
    lead.email,
    lead.salesPerson,
    lead.notes,
    lead.badgeNumber,
    campaign?.title,
    campaign?.eventName,
    campaign?.ownerName,
    roleLabel(campaign?.type),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function renderAdminLeads() {
  const tbody = $("#adminLeadTable");
  if (!tbody) return;

  populateAdminCampaignSelect();
  const selectedCampaignId = $("#adminCampaignSelect")?.value || "all";
  const campaignLookup = new Map(adminCampaigns().map((campaign) => [campaign.id, campaign]));
  const query = state.adminSearch.trim().toLowerCase();
  const rows = adminLeads()
    .filter((lead) => selectedCampaignId === "all" || lead.campaignId === selectedCampaignId)
    .filter((lead) => adminLeadMatchesSearch(lead, campaignLookup.get(lead.campaignId), query))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const pageCount = Math.max(1, Math.ceil(rows.length / LEADS_PER_PAGE));
  state.adminPage = Math.min(Math.max(state.adminPage, 1), pageCount);
  const pageStart = (state.adminPage - 1) * LEADS_PER_PAGE;
  const visibleRows = rows.slice(pageStart, pageStart + LEADS_PER_PAGE);
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">${query ? "No records match your search." : "No records found for this event."}</td></tr>`;
    updateAdminPagination(0, 1);
    return;
  }

  visibleRows.forEach((lead) => {
    const campaign = campaignLookup.get(lead.campaignId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(campaign?.ownerName || lead.ownerId || "Unknown")}</td>
      <td>${escapeHtml(roleLabel(campaign?.type))}</td>
      <td>${escapeHtml(campaign?.title || lead.campaignTitle || "Unknown")}</td>
      <td>${escapeHtml(lead.customerName)}</td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${escapeHtml(lead.email)}</td>
      <td>${escapeHtml(lead.salesPerson || "")}</td>
      <td>${escapeHtml(lead.notes || "")}</td>
      <td>${escapeHtml(lead.badgeNumber || "")}</td>
      <td>${lead.createdAt ? new Date(lead.createdAt).toLocaleString() : ""}</td>
    `;
    tbody.appendChild(tr);
  });
  updateAdminPagination(rows.length, pageCount);
}

function updateAdminPagination(totalRows, pageCount) {
  const pageInfo = $("#adminPageInfo");
  const prevButton = $("#adminPrevButton");
  const nextButton = $("#adminNextButton");
  if (!pageInfo || !prevButton || !nextButton) return;

  pageInfo.textContent = totalRows
    ? `Page ${state.adminPage} of ${pageCount}`
    : "Page 1 of 1";
  prevButton.disabled = state.adminPage <= 1 || !totalRows;
  nextButton.disabled = state.adminPage >= pageCount || !totalRows;
}

async function loadAdminData() {
  if (!isAdmin()) return;
  const result = await syncToSheet("getAdminData", {
    adminUserId: state.user.id,
    adminEmail: state.user.email,
  });
  if (!result.ok) {
    toast(result.message || "Admin records could not be loaded.");
    return;
  }
  state.adminData = {
    accounts: result.accounts || [],
    campaigns: result.campaigns || [],
    leads: result.leads || [],
  };
  populateAdminManagementForms();
  renderAdminLeads();
  renderAccountQrList();
}

async function loadAccountQrData() {
  if (!state.user) return;
  if (isAdmin()) {
    await loadAdminData();
    return;
  }

  const result = await syncToSheet("getUserCampaigns", {
    userId: state.user.id,
    email: state.user.email,
  });
  if (result.ok && Array.isArray(result.campaigns)) {
    result.campaigns.forEach(saveLocalCampaign);
  }
  renderAccountQrList();
}

async function refreshRecordsFromSheet() {
  if (!state.user) return { ok: false, message: "Create an account or log in first." };

  if (isAdmin()) {
    await loadAdminData();
    return { ok: true };
  }

  const result = await syncToSheet("getUserData", {
    userId: state.user.id,
    email: state.user.email,
  });
  if (!result.ok) {
    return { ok: false, message: result.message || "Records could not be loaded from Google Sheets." };
  }

  replaceLocalUserData(result.campaigns, result.leads);
  renderAccountQrList();
  renderLeads();
  updateCampaignSelectors();
  return { ok: true };
}

async function openDashboardFromSheet() {
  if (!requireSubscriptionAccess()) return;
  setView("dashboard");
  const result = await refreshRecordsFromSheet();
  if (!result.ok) {
    renderLeads();
    toast(result.message || "Dashboard records could not be loaded from Google Sheets.");
  }
}

async function saveAdminUser(form) {
  const data = Object.fromEntries(new FormData(form));
  if (!data.userId) {
    toast("Choose a user to update.");
    return;
  }

  const result = await syncToSheet("adminUpdateAccount", {
    adminUserId: state.user.id,
    adminEmail: state.user.email,
    userId: data.userId,
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    role: data.role,
    subscriptionStatus: data.subscriptionStatus,
    temporaryPassword: data.temporaryPassword.trim(),
    updatedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    toast(result.message || "User could not be updated.");
    return;
  }

  form.temporaryPassword.value = "";
  await loadAdminData();
  toast("User account updated.");
}

async function saveAdminEvent(form) {
  const data = Object.fromEntries(new FormData(form));
  if (!data.campaignId) {
    toast("Choose an event to update.");
    return;
  }
  const owner = adminAccounts().find((account) => account.id === data.ownerId);
  if (!owner) {
    toast("Choose a valid event owner.");
    return;
  }

  const destinationUrl = data.type === "presenter" ? normalizeDestinationUrl(data.destinationUrl) : "";
  if (data.type === "presenter" && destinationUrl) {
    try {
      new URL(destinationUrl);
    } catch {
      toast("Enter a valid destination link, like example.com or https://example.com.");
      return;
    }
  }

  let banner = null;
  try {
    banner = await prepareBanner(form.elements.banner.files?.[0]);
  } catch (error) {
    toast(error.message || "Banner image could not be prepared.");
    return;
  }

  const result = await syncToSheet("adminUpdateCampaign", {
    adminUserId: state.user.id,
    adminEmail: state.user.email,
    campaignId: data.campaignId,
    ownerId: owner.id,
    ownerName: owner.name,
    type: data.type,
    title: data.title.trim(),
    eventName: data.eventName.trim(),
    destinationUrl,
    clearBanner: Boolean(data.clearBanner),
    hasBannerUpdate: Boolean(banner),
    bannerMime: banner?.bannerMime || "",
    bannerChunkCount: banner?.bannerChunkCount || 0,
    bannerChunks: banner?.bannerChunks || [],
    updatedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    toast(result.message || "Event could not be updated.");
    return;
  }

  await loadAdminData();
  form.banner.value = "";
  form.clearBanner.checked = false;
  $("#adminBannerPreview").classList.add("hidden");
  $("#adminBannerPreview").style.backgroundImage = "";
  toast("Event updated.");
}

function updateLeadPagination(totalRows, pageCount) {
  const pageInfo = $("#leadPageInfo");
  const prevButton = $("#leadPrevButton");
  const nextButton = $("#leadNextButton");
  if (!pageInfo || !prevButton || !nextButton) return;

  pageInfo.textContent = totalRows
    ? `Page ${state.leadPage} of ${pageCount}`
    : "Page 1 of 1";
  prevButton.disabled = state.leadPage <= 1 || !totalRows;
  nextButton.disabled = state.leadPage >= pageCount || !totalRows;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function loadSession() {
  const session = readStore(STORE_KEYS.session, null);
  if (!session?.userId) return;
  state.user = readStore(STORE_KEYS.users, []).find((user) => user.id === session.userId) || null;
}

function saveLocalUser(user) {
  const users = readStore(STORE_KEYS.users, []);
  const existingIndex = users.findIndex((item) => item.id === user.id || item.email === user.email);
  if (existingIndex >= 0) {
    users[existingIndex] = { ...users[existingIndex], ...user };
  } else {
    users.push(user);
  }
  writeStore(STORE_KEYS.users, users);
  return users.find((item) => item.id === user.id || item.email === user.email);
}

function requireUser() {
  if (state.user) return true;
  toast("Create an account or log in first.");
  setView("auth");
  return false;
}

function requireSubscriptionAccess() {
  if (!requireUser()) return false;
  if (hasSubscriptionAccess(state.user)) return true;
  toast("Your trial has ended. Subscribe to access QR Dashboard.");
  setView("auth");
  return false;
}

function signOut() {
  localStorage.removeItem(STORE_KEYS.session);
  state.user = null;
  setMobileMenu(false);
  updateAuthUi();
  setView("auth");
}

async function openCapture(campaignId) {
  setView("capture");
  $("#leadForm").classList.add("hidden");
  $("#badgeOutput").classList.add("hidden");
  applyCaptureBanner(null);
  $("#captureTitle").textContent = "Loading QR details";
  $("#captureSubtitle").textContent = "Checking this QR code against the event record.";

  const campaign = await getCampaignById(campaignId, { preferSheet: true, requireSheet: true });
  if (!campaign) {
    $("#captureTitle").textContent = "QR campaign not found";
    $("#captureSubtitle").textContent = "This QR code could not load its expo or exhibitor record from the database.";
    return;
  }

  $("#leadForm").campaignId.value = campaign.id;
  $("#captureTitle").textContent = campaign.eventName || campaign.title;
  applyCaptureBanner(campaign);
  $("#captureSubtitle").textContent = campaign.type === "organizer"
    ? `Submit your details for ${campaign.title} and receive your badge number.`
    : `Submit your details for ${campaign.ownerName || "this exhibitor"} to continue.`;
  $("#leadForm").classList.remove("hidden");
}

function csvDownload(rows, campaignId = "all") {
  const headers = ["Name", "Phone", "Email", "Sales Person", "Notes", "Campaign", "Badge", "Created At"];
  const campaigns = new Map(readStore(STORE_KEYS.campaigns, []).map((campaign) => [campaign.id, campaign]));
  const filteredRows = campaignId === "all" ? rows : rows.filter((lead) => lead.campaignId === campaignId);
  const body = filteredRows.map((lead) => [
    lead.customerName,
    lead.phone,
    lead.email,
    lead.salesPerson || "",
    lead.notes || "",
    campaigns.get(lead.campaignId)?.title || "",
    lead.badgeNumber || "",
    lead.createdAt,
  ]);
  const csv = [headers, ...body].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const campaign = campaigns.get(campaignId);
  const batchName = campaign ? `${campaign.eventName || campaign.title}-${campaign.title}` : "all-batches";
  const safeBatchName = batchName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "expo-batch";
  anchor.download = `expo-lead-generator-${safeBatchName}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function adminCsvDownload() {
  const campaignId = $("#adminCampaignSelect").value;
  const campaigns = new Map(adminCampaigns().map((campaign) => [campaign.id, campaign]));
  const rows = adminLeads().filter((lead) => campaignId === "all" || lead.campaignId === campaignId);
  if (!rows.length) {
    toast("No records found for the selected event.");
    return;
  }

  const headers = ["Owner", "Account Type", "Event", "Campaign", "Name", "Phone", "Email", "Sales Person", "Notes", "Badge", "Created At"];
  const body = rows.map((lead) => {
    const campaign = campaigns.get(lead.campaignId);
    return [
      campaign?.ownerName || lead.ownerId || "",
      roleLabel(campaign?.type),
      campaign?.eventName || "",
      campaign?.title || lead.campaignTitle || "",
      lead.customerName,
      lead.phone,
      lead.email,
      lead.salesPerson || "",
      lead.notes || "",
      lead.badgeNumber || "",
      lead.createdAt,
    ];
  });
  const csv = [headers, ...body].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const campaign = campaigns.get(campaignId);
  const batchName = campaign ? `${campaign.eventName || campaign.title}-${campaign.title}` : "all-events";
  const safeBatchName = batchName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "admin-export";
  anchor.href = url;
  anchor.download = `expo-lead-generator-admin-${safeBatchName}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function handleHashRoute() {
  const route = window.location.hash.replace(/^#/, "");
  if (route === "dashboard") {
    if (isAdmin()) {
      setView("admin");
      loadAdminData();
      return;
    }
    await openDashboardFromSheet();
    return;
  }
  if (route === "auth") {
    setView("auth");
    if (state.user) {
      refreshAccountFromSheet();
      loadAccountQrData();
    }
    return;
  }
  if (route === "admin") {
    if (!requireUser() || !isAdmin()) {
      toast("Admin access is required.");
      setView("auth");
      return;
    }
    setView("admin");
    loadAdminData();
    return;
  }
  if (route.startsWith("capture/")) {
    openCapture(route.split("/")[1]);
  }
}

$("#signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const users = readStore(STORE_KEYS.users, []);
  if (users.some((user) => user.email.toLowerCase() === data.email.toLowerCase())) {
    toast("An account already exists for this email.");
    return;
  }
  const user = {
    id: uid("user"),
    role: data.role,
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    passwordHash: await digest(data.password),
    createdAt: new Date().toISOString(),
  };
  saveLocalUser(user);
  writeStore(STORE_KEYS.session, { userId: user.id });
  state.user = user;
  form.reset();
  updateAuthUi();
  await syncToSheet("saveAccount", user);
  toast("Account created.");
  setView("auth");
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const passwordHash = await digest(data.password);
  const email = data.email.trim().toLowerCase();
  const sheetLogin = await syncToSheet("login", {
    email,
    password: data.password,
    passwordHash,
    loggedInAt: new Date().toISOString(),
  });
  const user = sheetLogin.ok
    ? saveLocalUser(sheetLogin.user)
    : readStore(STORE_KEYS.users, []).find((item) => item.email === email && item.passwordHash === passwordHash);

  if (!sheetLogin.ok && !sheetLogin.error && !sheetLogin.skipped && sheetLogin.message !== "Unsupported action.") {
    toast(sheetLogin.message || "Email or password is incorrect.");
    return;
  }

  if (!user) {
    toast("Email or password is incorrect.");
    return;
  }
  writeStore(STORE_KEYS.session, { userId: user.id });
  state.user = user;
  form.reset();
  updateAuthUi();
  await refreshAccountFromSheet();
  renderLeads();
  loadAccountQrData();
  toast(accountStatusMessage(state.user) || "Logged in.");
  setView("auth");
});

$("#logoutButton").addEventListener("click", signOut);
$("#accountSignOutButton").addEventListener("click", signOut);

$("#menuToggleButton").addEventListener("click", (event) => {
  event.stopPropagation();
  const panel = document.querySelector(".side-panel");
  setMobileMenu(!panel?.classList.contains("menu-open"));
});

document.addEventListener("click", (event) => {
  const panel = document.querySelector(".side-panel");
  if (!panel?.classList.contains("menu-open")) return;
  if (panel.contains(event.target)) return;
  setMobileMenu(false);
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 900) setMobileMenu(false);
});

$("#changePasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireUser()) return;

  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (data.newPassword !== data.confirmPassword) {
    toast("New passwords do not match.");
    return;
  }

  const currentPasswordHash = await digest(data.currentPassword);
  const newPasswordHash = await digest(data.newPassword);
  const result = await syncToSheet("changePassword", {
    userId: state.user.id,
    email: state.user.email,
    currentPassword: data.currentPassword,
    currentPasswordHash,
    newPasswordHash,
    changedAt: new Date().toISOString(),
  });

  if (!result.ok) {
    toast(result.message || "Current password could not be verified.");
    return;
  }

  const users = readStore(STORE_KEYS.users, []);
  const userIndex = users.findIndex((user) => user.id === state.user.id || user.email === state.user.email);
  if (userIndex >= 0) {
    users[userIndex].passwordHash = newPasswordHash;
    writeStore(STORE_KEYS.users, users);
    state.user = users[userIndex];
  }

  form.reset();
  toast("Password updated.");
});

$("#subscribeButton").addEventListener("click", async () => {
  if (!requireUser()) return;
  const button = $("#subscribeButton");
  button.disabled = true;
  button.textContent = "Opening Stripe...";

  const result = await syncToSheet("createStripeCheckout", {
    userId: state.user.id,
    name: state.user.name,
    email: state.user.email,
    role: state.user.role,
    createdAt: state.user.createdAt,
    trialDaysRemaining: trialDaysRemaining(state.user),
    amountCents: SUBSCRIPTION_PRICE_CENTS,
    currency: "usd",
    successUrl: accountReturnUrl(),
    cancelUrl: accountReturnUrl(),
  });

  button.disabled = false;
  button.textContent = "Start subscription";

  if (!result.ok || !result.url) {
    toast(result.message || result.error || "Stripe checkout could not be created.");
    return;
  }

  window.location.assign(result.url);
});

$("#campaignForm input[name=\"banner\"]").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  const preview = $("#bannerPreview");
  if (!file) {
    preview.classList.add("hidden");
    preview.style.backgroundImage = "";
    return;
  }
  const dataUrl = await readImageFile(file);
  preview.style.backgroundImage = `url("${dataUrl}")`;
  preview.classList.remove("hidden");
});

$("#campaignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireSubscriptionAccess()) return;

  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const destinationUrl = state.user.role === "presenter" ? normalizeDestinationUrl(data.destinationUrl) : "";
  if (state.user.role === "presenter" && !destinationUrl) {
    toast("Exhibitor QR codes need a destination link.");
    return;
  }
  if (state.user.role === "presenter") {
    try {
      new URL(destinationUrl);
    } catch {
      toast("Enter a valid destination link, like example.com or https://example.com.");
      return;
    }
  }

  let banner = null;
  try {
    banner = await prepareBanner(form.elements.banner.files?.[0]);
  } catch (error) {
    toast(error.message || "Banner image could not be prepared.");
    return;
  }

  const campaign = {
    id: uid("qr"),
    ownerId: state.user.id,
    ownerName: state.user.name,
    type: state.user.role,
    title: data.title.trim(),
    destinationUrl,
    eventName: data.eventName.trim(),
    bannerDataUrl: banner?.bannerDataUrl || "",
    bannerMime: banner?.bannerMime || "",
    bannerChunkCount: banner?.bannerChunkCount || 0,
    bannerChunks: banner?.bannerChunks || [],
    createdAt: new Date().toISOString(),
  };
  form.reset();
  $("#bannerPreview").classList.add("hidden");
  $("#bannerPreview").style.backgroundImage = "";
  saveLocalCampaign(campaign);
  renderQr(campaign);
  updateCampaignSelectors();
  renderAccountQrList();
  await syncToSheet("saveCampaign", campaign);
  toast("QR campaign created.");
});

$("#leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type=\"submit\"]");
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
  }
  const data = Object.fromEntries(new FormData(form));
  const campaign = await getCampaignById(data.campaignId);
  if (!campaign) {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit";
    }
    toast("Campaign not found.");
    return;
  }

  const badgeNumber = campaign.type === "organizer" ? `EXPO-${Math.floor(100000 + Math.random() * 900000)}` : "";
  const lead = {
    id: uid("lead"),
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    ownerId: campaign.ownerId,
    customerName: data.customerName.trim(),
    phone: data.phone.trim(),
    email: data.email.trim().toLowerCase(),
    salesPerson: data.salesPerson.trim(),
    notes: data.notes.trim(),
    badgeNumber,
    createdAt: new Date().toISOString(),
  };
  const leads = readStore(STORE_KEYS.leads, []);
  leads.push(lead);
  writeStore(STORE_KEYS.leads, leads);
  const syncResult = await syncLeadToSheet(lead);
  if (!syncResult.ok) {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit";
    }
    toast(syncResult.message || "Could not save details. Please try again.");
    return;
  }

  form.reset();
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.textContent = "Submit";
  }

  if (campaign.type === "presenter" && campaign.destinationUrl) {
    toast("Details saved. Opening exhibitor link.");
    setTimeout(() => window.location.assign(campaign.destinationUrl), 700);
    return;
  }

  $("#badgeNumber").textContent = badgeNumber;
  $("#badgeOutput").classList.remove("hidden");
  toast("Details saved.");
});

$("#verifyForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireUser()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const badge = data.badge.trim().toUpperCase();
  const campaignId = data.campaignId || "all";
  const match = leadsForUser().find((lead) => {
    const badgeMatches = lead.badgeNumber?.toUpperCase() === badge;
    const campaignMatches = campaignId === "all" || lead.campaignId === campaignId;
    return badgeMatches && campaignMatches;
  });
  const campaign = readStore(STORE_KEYS.campaigns, []).find((item) => item.id === campaignId);
  $("#verifyResult").textContent = match
    ? `Verified for ${campaign?.eventName || campaign?.title || "selected campaign"}: ${match.customerName}, ${match.email}, ${new Date(match.createdAt).toLocaleString()}`
    : "No matching badge found for the selected campaign.";
});

$("#downloadCsvButton").addEventListener("click", () => {
  if (!requireUser()) return;
  const campaignId = $("#csvCampaignSelect").value;
  const rows = leadsForUser();
  const selectedRows = campaignId === "all" ? rows : rows.filter((lead) => lead.campaignId === campaignId);
  if (!selectedRows.length) {
    toast("No leads found for the selected expo batch.");
    return;
  }
  csvDownload(rows, campaignId);
});

$("#refreshButton").addEventListener("click", async () => {
  if (!requireUser()) return;
  const button = $("#refreshButton");
  button.disabled = true;
  button.textContent = "Refreshing...";
  const result = await refreshRecordsFromSheet();
  button.disabled = false;
  button.textContent = "Refresh";
  toast(result.ok ? "Records refreshed from Google Sheets." : result.message);
});

$("#adminRefreshButton").addEventListener("click", () => {
  if (!requireUser() || !isAdmin()) return;
  loadAdminData();
  toast("Admin records refreshed.");
});

$("#adminUserSelect").addEventListener("change", (event) => {
  fillAdminUserForm(event.currentTarget.value);
});

$("#adminEventSelect").addEventListener("change", (event) => {
  fillAdminEventForm(event.currentTarget.value);
});

$("#adminEventForm input[name=\"banner\"]").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  const preview = $("#adminBannerPreview");
  if (!file) {
    preview.classList.add("hidden");
    preview.style.backgroundImage = "";
    return;
  }
  const dataUrl = await readImageFile(file);
  preview.style.backgroundImage = `url("${dataUrl}")`;
  preview.classList.remove("hidden");
});

$("#adminUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireUser() || !isAdmin()) return;
  await saveAdminUser(event.currentTarget);
});

$("#adminEventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireUser() || !isAdmin()) return;
  await saveAdminEvent(event.currentTarget);
});

$("#adminSearchInput").addEventListener("input", (event) => {
  state.adminSearch = event.currentTarget.value;
  state.adminPage = 1;
  renderAdminLeads();
});

$("#adminCampaignSelect").addEventListener("change", () => {
  state.adminPage = 1;
  renderAdminLeads();
});

$("#adminDownloadCsvButton").addEventListener("click", () => {
  if (!requireUser() || !isAdmin()) return;
  adminCsvDownload();
});

$("#adminPrevButton").addEventListener("click", () => {
  if (!requireUser() || !isAdmin() || state.adminPage <= 1) return;
  state.adminPage -= 1;
  renderAdminLeads();
});

$("#adminNextButton").addEventListener("click", () => {
  if (!requireUser() || !isAdmin()) return;
  state.adminPage += 1;
  renderAdminLeads();
});

$("#accountQrRefreshButton").addEventListener("click", async () => {
  if (!requireUser()) return;
  await loadAccountQrData();
  toast("Event QR list refreshed.");
});

$("#accountQrSearchInput").addEventListener("input", (event) => {
  state.accountQrSearch = event.currentTarget.value;
  state.accountQrPage = 1;
  renderAccountQrList();
});

$("#accountQrPrevButton").addEventListener("click", () => {
  if (!requireUser() || state.accountQrPage <= 1) return;
  state.accountQrPage -= 1;
  renderAccountQrList();
});

$("#accountQrNextButton").addEventListener("click", () => {
  if (!requireUser()) return;
  state.accountQrPage += 1;
  renderAccountQrList();
});

$("#accountQrList").addEventListener("click", async (event) => {
  const downloadButton = event.target.closest("[data-account-download-qr]");
  const copyButton = event.target.closest("[data-account-copy-link]");
  const campaignId = downloadButton?.dataset.accountDownloadQr || copyButton?.dataset.accountCopyLink;
  if (!campaignId) return;

  const campaign = accountCampaigns().find((item) => item.id === campaignId);
  if (!campaign) {
    toast("QR campaign not found.");
    return;
  }

  if (copyButton) {
    await navigator.clipboard.writeText(scanUrl(campaign.id));
    toast("Scan link copied.");
    return;
  }

  const card = downloadButton.closest(".account-qr-card");
  const img = card?.querySelector(".account-qr-code img") || card?.querySelector(".account-qr-code canvas");
  if (!img) {
    toast("QR code is not ready yet.");
    return;
  }
  const link = document.createElement("a");
  link.download = `${campaign.title || campaign.eventName || "expo-lead-generator-qr"}.png`;
  link.href = img.tagName.toLowerCase() === "canvas" ? img.toDataURL("image/png") : img.src;
  link.click();
});

$("#leadSearchInput").addEventListener("input", (event) => {
  state.leadSearch = event.currentTarget.value;
  state.leadPage = 1;
  renderLeads();
});

$("#leadPrevButton").addEventListener("click", () => {
  if (!requireUser() || state.leadPage <= 1) return;
  state.leadPage -= 1;
  renderLeads();
});

$("#leadNextButton").addEventListener("click", () => {
  if (!requireUser()) return;
  state.leadPage += 1;
  renderLeads();
});

$("#downloadQrButton").addEventListener("click", () => {
  const img = $("#qrCode img") || $("#qrCode canvas");
  if (!img) {
    toast("Generate a QR code first.");
    return;
  }
  const link = document.createElement("a");
  link.download = `${state.selectedCampaign?.title || "expo-lead-generator-qr"}.png`;
  link.href = img.tagName.toLowerCase() === "canvas" ? img.toDataURL("image/png") : img.src;
  link.click();
});

$("#copyLinkButton").addEventListener("click", async () => {
  const text = $("#scanLinkText").textContent.trim();
  if (!text) {
    toast("Generate a QR code first.");
    return;
  }
  await navigator.clipboard.writeText(text);
  toast("Scan link copied.");
});

$$("[data-view-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const view = button.dataset.viewButton;
    if (view === "dashboard" && !requireUser()) return;
    if (view === "capture") {
      setView("auth");
      setMobileMenu(false);
      return;
    }
    if (view === "dashboard" && isAdmin()) {
      setView("admin");
      loadAdminData();
      return;
    }
    if (view === "admin" && (!requireUser() || !isAdmin())) {
      toast("Admin access is required.");
      return;
    }
    if (view === "dashboard") {
      setMobileMenu(false);
      await openDashboardFromSheet();
      return;
    }
    setView(view);
    setMobileMenu(false);
    if (view === "admin") loadAdminData();
    if (view === "auth" && state.user) {
      refreshAccountFromSheet();
      loadAccountQrData();
    }
  });
});

window.addEventListener("hashchange", handleHashRoute);

loadSession();
updateAuthUi();
refreshAccountFromSheet();
loadAccountQrData();
renderLeads();
handleHashRoute();
