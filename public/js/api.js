/* Thin API client with consistent error handling + CSRF header. */
const BASE = '/api';
const CLIENT_HEADER = { 'x-adamn-client': '1' };

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || 'Request failed');
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, { body, raw, headers = {}, signal } = {}) {
  const init = { method, headers: { ...CLIENT_HEADER, ...headers }, credentials: 'same-origin', signal };
  if (body !== undefined) {
    if (raw) {
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'تعذر الاتصال بالخادم المحلي — تأكد أن البرنامج يعمل');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const message = (payload && (payload.message || payload.error)) || `HTTP ${res.status}`;
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, payload && payload.error, message, payload && payload.details);
  }
  return payload;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  /** Uploads raw binary content with metadata headers (photos, attachments). */
  async upload(path, file, { fileName } = {}) {
    const name = fileName || file.name || 'file';
    return request('POST', path, {
      raw: true,
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(name),
      },
    });
  },
  /** Downloads a GET endpoint as a blob (used for Excel exports / backups). */
  async download(path, fallbackName = 'download') {
    const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin' });
    if (!res.ok) {
      let message = 'فشل التنزيل';
      try { const p = await res.json(); message = p.message || message; } catch { /* ignore */ }
      throw new ApiError(res.status, 'download', message);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(disposition);
    const name = match ? decodeURIComponent(match[1] || match[2]) : fallbackName;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return name;
  },
};

export function toQuery(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    q.set(key, value);
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}
