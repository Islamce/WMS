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

  /**
   * Generate a client-side idempotency key. Uses crypto.randomUUID when
   * available (all supported browsers) with a fallback so a missing API
   * never blocks a submit.
   */
  newIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  },

  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    // Auto-attach an idempotency key to POST bodies that don't already carry
    // one, so the server's withIdempotency middleware (which only activates
    // when idempotency_key is present) actually protects against a
    // double-click or a retried request creating a duplicate record.
    let sendBody = body;
    if (method === 'POST' && body && typeof body === 'object' && !Array.isArray(body) && body.idempotency_key === undefined) {
      sendBody = { ...body, idempotency_key: this.newIdempotencyKey() };
    }

    const res = await fetch(url, {
      method,
      headers,
      body: sendBody !== undefined ? JSON.stringify(sendBody) : undefined,
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
