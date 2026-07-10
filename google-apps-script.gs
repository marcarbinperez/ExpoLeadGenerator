const SHEET_ID = "1yUfreitpLB9QSbUnygiqAfQhk4HYUCF0HWf_tEO-Vw4";

function authorizeExpoLeadGeneratorServices() {
  SpreadsheetApp.openById(SHEET_ID).getName();
  PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "post",
    headers: {
      Authorization: "Bearer sk_authorization_check",
    },
    payload: {
      mode: "payment",
      success_url: "https://script.google.com",
      cancel_url: "https://script.google.com",
    },
    muteHttpExceptions: true,
  });
}

function authorizeExpoLeadServices() {
  return authorizeExpoLeadGeneratorServices();
}

function doPost(e) {
  try {
    return handlePost_(e);
  } catch (error) {
    return json_({
      ok: false,
      message: error && error.message ? error.message : String(error),
    });
  }
}

function handlePost_(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  const action = body.action;
  const payload = body.payload || {};

  if (action === "saveAccount") {
    const sheet = getSheet_("Accounts");
    ensureAccountHeader_(sheet);
    appendRow_("Accounts", [
      payload.id,
      payload.role,
      payload.name,
      payload.email,
      payload.passwordHash,
      payload.createdAt,
    ]);
    return json_({ ok: true });
  }

  if (action === "saveCampaign") {
    saveCampaign_(payload);
    return json_({ ok: true });
  }

  if (action === "getCampaign") {
    return json_(getCampaign_(payload.campaignId));
  }

  if (action === "getUserCampaigns") {
    return json_(getUserCampaigns_(payload));
  }

  if (action === "getUserData") {
    return json_(getUserData_(payload));
  }

  if (action === "saveLead") {
    saveLead_(payload);
    return json_({ ok: true });
  }

  if (action === "changePassword") {
    return json_(changePassword_(payload));
  }

  if (action === "login") {
    return json_(login_(payload));
  }

  if (action === "getAccount") {
    return json_(getAccount_(payload));
  }

  if (action === "createStripeCheckout") {
    return json_(createStripeCheckout_(payload));
  }

  if (action === "getAdminData") {
    return json_(getAdminData_(payload));
  }

  if (action === "adminUpdateAccount") {
    return json_(adminUpdateAccount_(payload));
  }

  if (action === "adminUpdateCampaign") {
    return json_(adminUpdateCampaign_(payload));
  }

  return json_({ ok: false, message: "Unsupported action." });
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === "listLeads") {
    ensureLeadHeader_(getSheet_("Leads"));
    return json_({ ok: true, rows: getRows_("Leads") });
  }
  return json_({ ok: true, message: "Expo Lead Generator sheet endpoint is running." });
}

function appendRow_(name, row) {
  const sheet = getSheet_(name);
  sheet.appendRow(row);
}

function getRows_(name) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => item[header] = row[index]);
    return item;
  });
}

function getAdminData_(payload) {
  if (!isAdminAccount_(payload.adminUserId, payload.adminEmail)) {
    return { ok: false, message: "Admin access is required." };
  }

  return {
    ok: true,
    accounts: getAdminAccounts_(),
    campaigns: getAdminCampaigns_(),
    leads: getAdminLeads_(),
  };
}

function getUserCampaigns_(payload) {
  const account = getAccountRecord_(payload.userId, payload.email);
  if (!account) {
    return { ok: false, message: "Account not found." };
  }
  if (String(account.role).toLowerCase() === "admin") {
    return { ok: true, campaigns: getAdminCampaigns_() };
  }

  const campaigns = getAdminCampaigns_().filter((campaign) => campaign.ownerId === account.id);
  return { ok: true, campaigns };
}

function getUserData_(payload) {
  const account = getAccountRecord_(payload.userId, payload.email);
  if (!account) {
    return { ok: false, message: "Account not found." };
  }
  if (String(account.role).toLowerCase() === "admin") {
    return {
      ok: true,
      campaigns: getAdminCampaigns_(),
      leads: getAdminLeads_(),
    };
  }

  const campaigns = getAdminCampaigns_().filter((campaign) => campaign.ownerId === account.id);
  const campaignIds = {};
  campaigns.forEach((campaign) => campaignIds[campaign.id] = true);
  const leads = getAdminLeads_().filter((lead) => campaignIds[lead.campaignId]);
  return { ok: true, campaigns, leads };
}

function getAccountRecord_(userId, email) {
  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0];
  const columns = accountColumns_(headers);
  const normalizedEmail = String(email || "").toLowerCase();

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const idMatches = userId && row[columns.id] === userId;
    const emailMatches = normalizedEmail && String(row[columns.email]).toLowerCase() === normalizedEmail;
    if (idMatches || emailMatches) {
      return {
        id: row[columns.id],
        role: row[columns.role],
        name: row[columns.name],
        email: row[columns.email],
      };
    }
  }
  return null;
}

function isAdminAccount_(userId, email) {
  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;

  const headers = values[0];
  const columns = accountColumns_(headers);
  const normalizedEmail = String(email || "").toLowerCase();

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const idMatches = userId && row[columns.id] === userId;
    const emailMatches = normalizedEmail && String(row[columns.email]).toLowerCase() === normalizedEmail;
    if ((idMatches || emailMatches) && String(row[columns.role]).toLowerCase() === "admin") {
      return true;
    }
  }
  return false;
}

function getAdminAccounts_() {
  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const columns = accountColumns_(headers);
  return values.slice(1).map((row) => ({
    id: row[columns.id],
    role: row[columns.role],
    name: row[columns.name],
    email: row[columns.email],
    createdAt: row[columns.createdAt],
    subscriptionStatus: getSubscriptionStatus_(row[columns.id], row[columns.email]),
  }));
}

function getAdminCampaigns_() {
  const sheet = getSheet_("Campaigns");
  ensureCampaignHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const columns = campaignColumns_(headers);
  return values.slice(1).map((row) => ({
    id: row[columns.id],
    ownerId: row[columns.ownerId],
    ownerName: row[columns.ownerName],
    type: row[columns.type],
    title: row[columns.title],
    destinationUrl: row[columns.destinationUrl],
    eventName: row[columns.eventName],
    createdAt: row[columns.createdAt],
  }));
}

function getAdminLeads_() {
  const sheet = getSheet_("Leads");
  ensureLeadHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const columns = {
    id: headers.indexOf("id"),
    campaignId: headers.indexOf("campaignId"),
    campaignTitle: headers.indexOf("campaignTitle"),
    ownerId: headers.indexOf("ownerId"),
    customerName: headers.indexOf("customerName"),
    phone: headers.indexOf("phone"),
    email: headers.indexOf("email"),
    salesPerson: headers.indexOf("salesPerson"),
    notes: headers.indexOf("notes"),
    badgeNumber: headers.indexOf("badgeNumber"),
    createdAt: headers.indexOf("createdAt"),
  };

  return values.slice(1).map((row) => ({
    id: row[columns.id],
    campaignId: row[columns.campaignId],
    campaignTitle: row[columns.campaignTitle],
    ownerId: row[columns.ownerId],
    customerName: row[columns.customerName],
    phone: row[columns.phone],
    email: row[columns.email],
    salesPerson: columns.salesPerson >= 0 ? row[columns.salesPerson] : "",
    notes: columns.notes >= 0 ? row[columns.notes] : "",
    badgeNumber: row[columns.badgeNumber],
    createdAt: row[columns.createdAt],
  }));
}

function saveLead_(payload) {
  const sheet = getSheet_("Leads");
  ensureLeadHeader_(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idColumn = headers.indexOf("id");
  if (payload.id && idColumn >= 0 && sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, idColumn + 1, sheet.getLastRow() - 1, 1).getValues();
    for (let index = 0; index < ids.length; index++) {
      if (ids[index][0] === payload.id) {
        return;
      }
    }
  }
  const row = headers.map((header) => {
    if (header === "salesPerson") return payload.salesPerson || "";
    if (header === "notes") return payload.notes || "";
    return payload[header] || "";
  });
  sheet.appendRow(row);
}

function adminUpdateAccount_(payload) {
  if (!isAdminAccount_(payload.adminUserId, payload.adminEmail)) {
    return { ok: false, message: "Admin access is required." };
  }

  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, message: "Account not found." };

  const headers = values[0];
  const columns = accountColumns_(headers);
  const allowedRoles = ["presenter", "organizer", "admin"];
  const role = String(payload.role || "").toLowerCase();
  if (allowedRoles.indexOf(role) === -1) {
    return { ok: false, message: "Invalid account role." };
  }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) return { ok: false, message: "Email is required." };

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const sameEmail = String(row[columns.email]).toLowerCase() === email;
    const sameAccount = row[columns.id] === payload.userId;
    if (sameEmail && !sameAccount) {
      return { ok: false, message: "Another account already uses that email." };
    }
  }

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    if (row[columns.id] === payload.userId) {
      sheet.getRange(index + 1, columns.name + 1).setValue(payload.name || "");
      sheet.getRange(index + 1, columns.email + 1).setValue(email);
      sheet.getRange(index + 1, columns.role + 1).setValue(role);
      if (String(payload.temporaryPassword || "").trim()) {
        sheet.getRange(index + 1, columns.adminTemporaryPassword + 1).setValue(String(payload.temporaryPassword).trim());
        sheet.getRange(index + 1, columns.passwordUpdatedAt + 1).setValue(payload.updatedAt || new Date().toISOString());
      }
      if (String(payload.subscriptionStatus || "").trim()) {
        appendAdminSubscriptionStatus_(row[columns.id], email, role, String(payload.subscriptionStatus).trim(), payload.updatedAt);
      }
      return { ok: true };
    }
  }

  return { ok: false, message: "Account not found." };
}

function appendAdminSubscriptionStatus_(userId, email, role, status, createdAt) {
  appendRow_("Subscriptions", [
    userId,
    email,
    role,
    status,
    799,
    "usd",
    "",
    "admin_override",
    "",
    createdAt || new Date().toISOString(),
  ]);
}

function adminUpdateCampaign_(payload) {
  if (!isAdminAccount_(payload.adminUserId, payload.adminEmail)) {
    return { ok: false, message: "Admin access is required." };
  }

  const sheet = getSheet_("Campaigns");
  ensureCampaignHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, message: "Event not found." };

  const headers = values[0];
  const columns = campaignColumns_(headers);
  const allowedTypes = ["presenter", "organizer"];
  const type = String(payload.type || "").toLowerCase();
  if (allowedTypes.indexOf(type) === -1) {
    return { ok: false, message: "Invalid event account type." };
  }

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    if (row[columns.id] === payload.campaignId) {
      sheet.getRange(index + 1, columns.ownerId + 1).setValue(payload.ownerId || "");
      sheet.getRange(index + 1, columns.ownerName + 1).setValue(payload.ownerName || "");
      sheet.getRange(index + 1, columns.type + 1).setValue(type);
      sheet.getRange(index + 1, columns.title + 1).setValue(payload.title || "");
      sheet.getRange(index + 1, columns.destinationUrl + 1).setValue(type === "presenter" ? payload.destinationUrl || "" : "");
      sheet.getRange(index + 1, columns.eventName + 1).setValue(payload.eventName || "");
      if (payload.clearBanner || payload.hasBannerUpdate) {
        updateCampaignBannerCells_(sheet, index + 1, columns, payload);
        replaceCampaignBanner_(payload);
      }
      return { ok: true };
    }
  }

  return { ok: false, message: "Event not found." };
}

function updateCampaignBannerCells_(sheet, rowNumber, columns, payload) {
  const chunks = payload.hasBannerUpdate ? payload.bannerChunks || [] : [];
  if (columns.bannerMime >= 0) {
    sheet.getRange(rowNumber, columns.bannerMime + 1).setValue(payload.hasBannerUpdate ? payload.bannerMime || "image/jpeg" : "");
  }
  if (columns.bannerChunkCount >= 0) {
    sheet.getRange(rowNumber, columns.bannerChunkCount + 1).setValue(chunks.length);
  }
  for (let index = 1; index <= 12; index++) {
    const columnIndex = columns["bannerChunk" + index];
    if (columnIndex >= 0) {
      sheet.getRange(rowNumber, columnIndex + 1).setValue(chunks[index - 1] || "");
    }
  }
}

function replaceCampaignBanner_(payload) {
  const bannerSheet = getSheet_("CampaignBanners");
  ensureCampaignBannerHeader_(bannerSheet);
  const values = bannerSheet.getDataRange().getValues();
  if (values.length > 1) {
    const headers = values[0];
    const columns = campaignBannerColumns_(headers);
    for (let index = values.length - 1; index >= 1; index--) {
      if (values[index][columns.campaignId] === payload.campaignId) {
        bannerSheet.deleteRow(index + 1);
      }
    }
  }
  if (payload.hasBannerUpdate) {
    saveCampaignBanner_({
      id: payload.campaignId,
      bannerMime: payload.bannerMime || "image/jpeg",
      bannerChunks: payload.bannerChunks || [],
      createdAt: payload.updatedAt || new Date().toISOString(),
    });
  }
}

function saveCampaign_(payload) {
  const sheet = getSheet_("Campaigns");
  ensureCampaignHeader_(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map((header) => {
    if (header === "bannerDataUrl") return "";
    if (header === "bannerChunkCount") return payload.bannerChunkCount || 0;
    if (header.indexOf("bannerChunk") === 0) {
      const chunkNumber = Number(header.replace("bannerChunk", ""));
      return payload.bannerChunks && payload.bannerChunks[chunkNumber - 1] ? payload.bannerChunks[chunkNumber - 1] : "";
    }
    return payload[header] || "";
  });
  sheet.appendRow(row);
  saveCampaignBanner_(payload);
}

function saveCampaignBanner_(payload) {
  const bannerSheet = getSheet_("CampaignBanners");
  ensureCampaignBannerHeader_(bannerSheet);
  const chunks = payload.bannerChunks || [];
  if (!chunks.length) return;

  chunks.forEach((chunk, index) => {
    bannerSheet.appendRow([
      payload.id,
      index + 1,
      chunks.length,
      payload.bannerMime || "image/jpeg",
      chunk,
      payload.createdAt || new Date().toISOString(),
    ]);
  });
}

function getCampaign_(campaignId) {
  const sheet = getSheet_("Campaigns");
  ensureCampaignHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, message: "Campaign not found." };

  const headers = values[0];
  const columns = campaignColumns_(headers);
  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    if (row[columns.id] === campaignId) {
      const banner = getCampaignBanner_(campaignId) || rebuildLegacyBanner_(row, columns);
      return {
        ok: true,
        campaign: {
          id: row[columns.id],
          ownerId: row[columns.ownerId],
          ownerName: row[columns.ownerName],
          type: row[columns.type],
          title: row[columns.title],
          destinationUrl: row[columns.destinationUrl],
          eventName: row[columns.eventName],
          bannerDataUrl: banner.dataUrl,
          bannerMime: banner.mime,
          bannerChunkCount: banner.chunkCount,
          createdAt: row[columns.createdAt],
        },
      };
    }
  }

  return { ok: false, message: "Campaign not found." };
}

function getCampaignBanner_(campaignId) {
  const bannerSheet = getSheet_("CampaignBanners");
  ensureCampaignBannerHeader_(bannerSheet);
  const values = bannerSheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const headers = values[0];
  const columns = campaignBannerColumns_(headers);
  const chunks = [];
  let mime = "";
  let chunkCount = 0;

  values.slice(1).forEach((row, index) => {
    if (row[columns.campaignId] === campaignId) {
      const chunkIndex = Number(row[columns.chunkIndex]);
      chunks[chunkIndex - 1] = row[columns.chunkData] || "";
      mime = row[columns.mime] || mime;
      chunkCount = Number(row[columns.chunkCount] || chunkCount);
    }
  });

  const dataUrl = chunks.filter(Boolean).join("");
  if (!dataUrl) return null;
  return {
    dataUrl,
    mime,
    chunkCount: chunkCount || chunks.length,
  };
}

function rebuildLegacyBanner_(row, columns) {
  const chunkCount = Number(row[columns.bannerChunkCount] || 0);
  if (!chunkCount) return { dataUrl: "", mime: "", chunkCount: 0 };
  const chunks = [];
  for (let index = 1; index <= chunkCount; index++) {
    const columnIndex = columns["bannerChunk" + index];
    if (columnIndex >= 0) {
      chunks.push(row[columnIndex] || "");
    }
  }
  return {
    dataUrl: chunks.join(""),
    mime: row[columns.bannerMime] || "",
    chunkCount,
  };
}

function changePassword_(payload) {
  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, message: "Account was not found." };

  const headers = values[0];
  const columns = accountColumns_(headers);

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const idMatches = payload.userId && row[columns.id] === payload.userId;
    const emailMatches = payload.email && String(row[columns.email]).toLowerCase() === String(payload.email).toLowerCase();
    const storedHashMatches = row[columns.passwordHash] === payload.currentPasswordHash;
    const temporaryPasswordMatches = row[columns.adminTemporaryPassword] && String(row[columns.adminTemporaryPassword]) === String(payload.currentPassword);
    if ((idMatches || emailMatches) && (storedHashMatches || temporaryPasswordMatches)) {
      sheet.getRange(index + 1, columns.passwordHash + 1).setValue(payload.newPasswordHash);
      sheet.getRange(index + 1, columns.adminTemporaryPassword + 1).setValue("");
      sheet.getRange(index + 1, columns.passwordUpdatedAt + 1).setValue(payload.changedAt || new Date().toISOString());
      return { ok: true };
    }
  }

  return { ok: false, message: "Current password is incorrect." };
}

function login_(payload) {
  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, message: "Email or password is incorrect." };

  const headers = values[0];
  const columns = accountColumns_(headers);
  const email = String(payload.email || "").toLowerCase();

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const emailMatches = String(row[columns.email]).toLowerCase() === email;
    const storedHashMatches = row[columns.passwordHash] === payload.passwordHash;
    const temporaryPasswordMatches = row[columns.adminTemporaryPassword] && String(row[columns.adminTemporaryPassword]) === String(payload.password);
    if (emailMatches && (storedHashMatches || temporaryPasswordMatches)) {
      if (temporaryPasswordMatches) {
        sheet.getRange(index + 1, columns.passwordHash + 1).setValue(payload.passwordHash);
        sheet.getRange(index + 1, columns.adminTemporaryPassword + 1).setValue("");
        sheet.getRange(index + 1, columns.passwordUpdatedAt + 1).setValue(payload.loggedInAt || new Date().toISOString());
      }
      return {
        ok: true,
        user: {
          id: row[columns.id],
          role: row[columns.role],
          name: row[columns.name],
          email: row[columns.email],
          passwordHash: payload.passwordHash,
          createdAt: row[columns.createdAt],
          subscriptionStatus: getSubscriptionStatus_(row[columns.id], row[columns.email]),
          subscriptionActive: hasActiveSubscription_(row[columns.id], row[columns.email]),
        },
      };
    }
  }

  return { ok: false, message: "Email or password is incorrect." };
}

function getAccount_(payload) {
  const sheet = getSheet_("Accounts");
  ensureAccountHeader_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, message: "Account not found." };

  const headers = values[0];
  const columns = accountColumns_(headers);
  const email = String(payload.email || "").toLowerCase();

  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const idMatches = payload.userId && row[columns.id] === payload.userId;
    const emailMatches = email && String(row[columns.email]).toLowerCase() === email;
    if (idMatches || emailMatches) {
      const subscriptionStatus = getSubscriptionStatus_(row[columns.id], row[columns.email]);
      return {
        ok: true,
        user: {
          id: row[columns.id],
          role: row[columns.role],
          name: row[columns.name],
          email: row[columns.email],
          createdAt: row[columns.createdAt],
          subscriptionStatus,
          subscriptionActive: isActiveSubscriptionStatus_(subscriptionStatus),
        },
      };
    }
  }

  return { ok: false, message: "Account not found." };
}

function createStripeCheckout_(payload) {
  const secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return { ok: false, message: "Stripe secret key is not configured in Apps Script properties." };
  }

  const trialDays = Math.max(0, Math.min(15, Number(payload.trialDaysRemaining || 0)));
  const successUrl = stripeReturnUrl_(payload.successUrl);
  const cancelUrl = stripeReturnUrl_(payload.cancelUrl);
  const params = {
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: payload.email,
    client_reference_id: payload.userId,
    "metadata[userId]": payload.userId,
    "metadata[email]": payload.email,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": payload.currency || "usd",
    "line_items[0][price_data][unit_amount]": String(payload.amountCents || 799),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": "Expo Lead Generator Monthly Subscription",
  };

  if (trialDays > 0) {
    params["subscription_data[trial_period_days]"] = String(trialDays);
  }

  const response = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "post",
    headers: {
      Authorization: "Bearer " + secretKey,
    },
    payload: params,
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || "{}");
  if (statusCode < 200 || statusCode >= 300) {
    return { ok: false, message: data.error && data.error.message ? data.error.message : "Stripe checkout failed." };
  }

  appendRow_("Subscriptions", [
    payload.userId,
    payload.email,
    payload.role,
    "checkout_created",
    payload.amountCents || 799,
    payload.currency || "usd",
    trialDays,
    data.id,
    data.url,
    new Date().toISOString(),
  ]);

  return { ok: true, id: data.id, url: data.url };
}

function getSubscriptionStatus_(userId, email) {
  const sheet = getSheet_("Subscriptions");
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return "";

  const headers = values[0];
  const userIdCol = headers.indexOf("userId");
  const emailCol = headers.indexOf("email");
  const statusCol = headers.indexOf("status");
  const sessionCol = headers.indexOf("stripeCheckoutSessionId");
  const createdAtCol = headers.indexOf("createdAt");
  const normalizedEmail = String(email || "").toLowerCase();
  let latest = null;

  values.slice(1).forEach((row, index) => {
    const userMatches = userId && row[userIdCol] === userId;
    const emailMatches = normalizedEmail && String(row[emailCol]).toLowerCase() === normalizedEmail;
    if (userMatches || emailMatches) {
      const createdAt = createdAtCol >= 0 ? new Date(row[createdAtCol]).getTime() : 0;
      if (!latest || createdAt >= latest.createdAt) {
        latest = {
          status: String(row[statusCol] || ""),
          rowIndex: index + 2,
          sessionId: sessionCol >= 0 ? String(row[sessionCol] || "") : "",
          createdAt,
        };
      }
    }
  });

  if (!latest) return "";
  if (String(latest.status).toLowerCase() === "checkout_created" && latest.sessionId) {
    return refreshStripeCheckoutStatus_(sheet, latest.rowIndex, statusCol + 1, latest.sessionId);
  }
  return latest.status;
}

function hasActiveSubscription_(userId, email) {
  return isActiveSubscriptionStatus_(getSubscriptionStatus_(userId, email));
}

function isActiveSubscriptionStatus_(status) {
  return ["active", "trialing", "subscribed", "paid"].indexOf(String(status || "").toLowerCase()) >= 0;
}

function refreshStripeCheckoutStatus_(sheet, rowIndex, statusColumn, sessionId) {
  const secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!secretKey) return "checkout_created";

  const response = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
    method: "get",
    headers: {
      Authorization: "Bearer " + secretKey,
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    return "checkout_created";
  }

  const data = JSON.parse(response.getContentText() || "{}");
  if (data.status === "complete") {
    sheet.getRange(rowIndex, statusColumn).setValue("active");
    return "active";
  }
  return "checkout_created";
}

function stripeReturnUrl_(url) {
  const value = String(url || "");
  if (value.indexOf("http://127.0.0.1") === 0 || value.indexOf("http://localhost") === 0) {
    return ScriptApp.getService().getUrl();
  }
  return value;
}

function ensureAccountHeader_(sheet) {
  const requiredHeaders = ["id", "role", "name", "email", "passwordHash", "createdAt", "passwordUpdatedAt", "adminTemporaryPassword"];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  if (!headers[0]) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }
  requiredHeaders.forEach((header) => {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function accountColumns_(headers) {
  return {
    id: headers.indexOf("id"),
    role: headers.indexOf("role"),
    name: headers.indexOf("name"),
    email: headers.indexOf("email"),
    passwordHash: headers.indexOf("passwordHash"),
    createdAt: headers.indexOf("createdAt"),
    passwordUpdatedAt: headers.indexOf("passwordUpdatedAt"),
    adminTemporaryPassword: headers.indexOf("adminTemporaryPassword"),
  };
}

function ensureCampaignHeader_(sheet) {
  const requiredHeaders = [
    "id",
    "ownerId",
    "ownerName",
    "type",
    "title",
    "destinationUrl",
    "eventName",
    "createdAt",
    "bannerMime",
    "bannerChunkCount",
    "bannerChunk1",
    "bannerChunk2",
    "bannerChunk3",
    "bannerChunk4",
    "bannerChunk5",
    "bannerChunk6",
    "bannerChunk7",
    "bannerChunk8",
    "bannerChunk9",
    "bannerChunk10",
    "bannerChunk11",
    "bannerChunk12",
  ];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  if (!headers[0]) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }
  requiredHeaders.forEach((header) => {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function campaignColumns_(headers) {
  const columns = {
    id: headers.indexOf("id"),
    ownerId: headers.indexOf("ownerId"),
    ownerName: headers.indexOf("ownerName"),
    type: headers.indexOf("type"),
    title: headers.indexOf("title"),
    destinationUrl: headers.indexOf("destinationUrl"),
    eventName: headers.indexOf("eventName"),
    createdAt: headers.indexOf("createdAt"),
    bannerMime: headers.indexOf("bannerMime"),
    bannerChunkCount: headers.indexOf("bannerChunkCount"),
  };
  for (let index = 1; index <= 12; index++) {
    columns["bannerChunk" + index] = headers.indexOf("bannerChunk" + index);
  }
  return columns;
}

function ensureCampaignBannerHeader_(sheet) {
  const requiredHeaders = ["campaignId", "chunkIndex", "chunkCount", "mime", "chunkData", "createdAt"];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  if (!headers[0]) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }
  requiredHeaders.forEach((header) => {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function ensureLeadHeader_(sheet) {
  const requiredHeaders = ["id", "campaignId", "campaignTitle", "ownerId", "customerName", "phone", "email", "salesPerson", "notes", "badgeNumber", "createdAt"];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  if (!headers[0]) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }
  requiredHeaders.forEach((header) => {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function campaignBannerColumns_(headers) {
  return {
    campaignId: headers.indexOf("campaignId"),
    chunkIndex: headers.indexOf("chunkIndex"),
    chunkCount: headers.indexOf("chunkCount"),
    mime: headers.indexOf("mime"),
    chunkData: headers.indexOf("chunkData"),
    createdAt: headers.indexOf("createdAt"),
  };
}

function getSheet_(name) {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    if (name === "Accounts") sheet.appendRow(["id", "role", "name", "email", "passwordHash", "createdAt", "passwordUpdatedAt", "adminTemporaryPassword"]);
    if (name === "Campaigns") sheet.appendRow(["id", "ownerId", "ownerName", "type", "title", "destinationUrl", "eventName", "createdAt", "bannerMime", "bannerChunkCount", "bannerChunk1", "bannerChunk2", "bannerChunk3", "bannerChunk4", "bannerChunk5", "bannerChunk6", "bannerChunk7", "bannerChunk8", "bannerChunk9", "bannerChunk10", "bannerChunk11", "bannerChunk12"]);
    if (name === "CampaignBanners") sheet.appendRow(["campaignId", "chunkIndex", "chunkCount", "mime", "chunkData", "createdAt"]);
    if (name === "Leads") sheet.appendRow(["id", "campaignId", "campaignTitle", "ownerId", "customerName", "phone", "email", "salesPerson", "notes", "badgeNumber", "createdAt"]);
    if (name === "Subscriptions") sheet.appendRow(["userId", "email", "role", "status", "amountCents", "currency", "trialDays", "stripeCheckoutSessionId", "stripeCheckoutUrl", "createdAt"]);
  }
  return sheet;
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
