/**
 * Tiny API client. Stores the JWT in localStorage and attaches it to
 * every request. On 401 the session is cleared and the login page shown.
 */
const Api = {
  token: localStorage.getItem('wms_token') || null,

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('wms_token', token);
    else localStorage.removeItem('wms_token');
  },

  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }

    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
      // Session expired or account deactivated -> back to login.
      this.setToken(null);
      window.App && window.App.onSessionExpired();
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  /** Fetch a binary resource (e.g. a PDF) with auth; returns a Blob. */
  async blob(url) {
    const res = await fetch(url, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.blob();
  },

  /** POST a JSON body and get a binary Blob back (e.g. an exported PDF). */
  async postBlob(url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.blob();
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  patch(url, body) { return this.request('PATCH', url, body); },
  delete(url) { return this.request('DELETE', url); },
};
