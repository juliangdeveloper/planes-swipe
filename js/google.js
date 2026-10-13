import { GOOGLE_API_KEY, GOOGLE_APP_ID, GOOGLE_CLIENT_ID, SCOPE } from "./config.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(`script[data-src="${src}"]`);
    if (found?.dataset.loaded === "1") {
      resolve();
      return;
    }
    const script = found || document.createElement("script");
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "network" })), 15000);
    script.dataset.src = src;
    script.src = src;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("script"), { code: "network" }));
    };
    if (!found) document.head.appendChild(script);
  });
}

export function configError() {
  if (!GOOGLE_CLIENT_ID) return "Falta el client id de Google en js/config.js.";
  return "";
}

export function pickerConfigError() {
  if (!GOOGLE_CLIENT_ID) return "Falta el client id de Google en js/config.js.";
  if (!GOOGLE_API_KEY) return "Falta la clave de API de Google en js/config.js.";
  if (!GOOGLE_APP_ID) return "Falta el número de proyecto (App ID) en js/config.js.";
  return "";
}

export async function signIn({ prompt = "" } = {}) {
  if (!GOOGLE_CLIENT_ID) throw Object.assign(new Error("no_client"), { code: "no_client" });
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    const google = globalThis.google;
    if (!google?.accounts?.oauth2) {
      reject(Object.assign(new Error("auth"), { code: "auth" }));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response?.access_token) resolve(response.access_token);
        else reject(Object.assign(new Error(response?.error || "auth"), { code: response?.error || "auth" }));
      },
      error_callback: (err) => reject(Object.assign(new Error(err?.message || err?.type || "auth"), { code: err?.type || "auth" })),
    });
    client.requestAccessToken({ prompt });
  });
}

async function loadPicker() {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((resolve, reject) => {
    const gapi = globalThis.gapi;
    if (!gapi?.load) {
      reject(Object.assign(new Error("picker"), { code: "picker" }));
      return;
    }
    gapi.load("picker", { callback: resolve, onerror: () => reject(Object.assign(new Error("picker"), { code: "picker" })) });
  });
}

export async function pickSpreadsheet(token) {
  const problem = pickerConfigError();
  if (problem) throw Object.assign(new Error(problem), { code: "config" });
  await loadPicker();
  return new Promise((resolve, reject) => {
    const google = globalThis.google;
    if (!google?.picker) {
      reject(Object.assign(new Error("picker"), { code: "picker" }));
      return;
    }
    const viewId = google.picker.ViewId.SPREADSHEETS || google.picker.ViewId.DOCS;
    const view = new google.picker.DocsView(viewId);
    if (google.picker.ViewId.SPREADSHEETS && view.setMimeTypes) {
      view.setMimeTypes("application/vnd.google-apps.spreadsheet");
    }
    const builder = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setAppId(GOOGLE_APP_ID)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setTitle("Eventos y planes")
      .setLocale("es")
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]?.id) {
          resolve(data.docs[0].id);
          return;
        }
        if (data.action === google.picker.Action.CANCEL) resolve(null);
      });
    builder.build().setVisible(true);
  });
}

async function api(token, path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`https://sheets.googleapis.com/v4${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw Object.assign(new Error("network"), { code: "network", cause: err });
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.error?.message || `http_${response.status}`), { status: response.status });
  }
  return data;
}

async function withAuth(getToken, refreshToken, run) {
  try {
    return await run(getToken());
  } catch (err) {
    if (err.status !== 401 || !refreshToken) throw err;
    const next = await refreshToken();
    return run(next);
  }
}

export function createSheetsClient({ getToken, refreshToken }) {
  return {
    getSpreadsheet(spreadsheetId) {
      const id = encodeURIComponent(spreadsheetId);
      return withAuth(getToken, refreshToken, (token) => api(
        token,
        `/spreadsheets/${id}?fields=properties.title,sheets.properties(title,index)`,
      ));
    },
    async batchGet(spreadsheetId, ranges) {
      const params = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
      const id = encodeURIComponent(spreadsheetId);
      const data = await withAuth(getToken, refreshToken, (token) => api(
        token,
        `/spreadsheets/${id}/values:batchGet?${params}`,
      ));
      return data.valueRanges || [];
    },
    batchUpdate(spreadsheetId, data) {
      const id = encodeURIComponent(spreadsheetId);
      return withAuth(getToken, refreshToken, (token) => api(
        token,
        `/spreadsheets/${id}/values:batchUpdate`,
        { method: "POST", body: { valueInputOption: "RAW", data } },
      ));
    },
  };
}
