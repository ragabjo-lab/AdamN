import { api } from '../api.js';
import { t, setLang, getLang, applyTranslations } from '../i18n.js';
import { esc, el, toastError } from '../ui.js';

export default {
  async mount(root, { setup = false, message = '', onSuccess }) {
    setLang(getLang());
    root.innerHTML = `
      <div class="auth-screen">
        <aside class="auth-hero">
          <div class="brand-mark" style="width:58px;height:58px;font-size:1.8rem">A</div>
          <h1>${esc(t('auth.heroTitle'))}</h1>
          <p>${esc(t('auth.heroText'))}</p>
          <ul>
            <li><span class="tick">✓</span><span>${esc(t('auth.feature1'))}</span></li>
            <li><span class="tick">✓</span><span>${esc(t('auth.feature2'))}</span></li>
            <li><span class="tick">✓</span><span>${esc(t('auth.feature3'))}</span></li>
            <li><span class="tick">✓</span><span>${esc(t('auth.feature4'))}</span></li>
          </ul>
        </aside>
        <div class="auth-form-wrap">
          <div class="auth-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div class="brand-mark">A</div>
              <button class="btn secondary sm" id="auth-lang">${getLang() === 'ar' ? 'English' : 'العربية'}</button>
            </div>
            <h2>${esc(setup ? t('auth.setupTitle') : t('auth.loginTitle'))}</h2>
            <p class="muted">${esc(setup ? t('auth.setupSubtitle') : t('auth.loginSubtitle'))}</p>
            ${message ? `<div class="toast error" style="margin:12px 0">${esc(message)}</div>` : ''}
            <form id="auth-form" autocomplete="on">
              ${setup ? `
                <div class="field">
                  <label for="nurseryName">${esc(t('auth.nurseryName'))}</label>
                  <input id="nurseryName" name="nurseryName" value="حضانة AdamN" required maxlength="120">
                </div>
                <div class="field">
                  <label for="fullName">${esc(t('auth.fullName'))}</label>
                  <input id="fullName" name="fullName" placeholder="${esc(getLang() === 'en' ? 'e.g. Sara Ahmed' : 'مثال: سارة أحمد')}" required maxlength="120">
                </div>` : ''}
              <div class="field">
                <label for="username">${esc(t('auth.username'))}</label>
                <input id="username" name="username" autocomplete="username" required maxlength="32"
                  placeholder="admin" style="direction:ltr;text-align:left">
                ${setup ? `<div class="hint">${esc(t('auth.usernameHint'))}</div>` : ''}
              </div>
              <div class="field">
                <label for="password">${esc(t('auth.password'))}</label>
                <input id="password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="8">
                ${setup ? `<div class="hint">${esc(getLang() === 'en' ? 'At least 8 characters including letters and digits' : '8 أحرف على الأقل وتحتوي حروفًا وأرقامًا')}</div>` : ''}
              </div>
              ${setup ? `
                <div class="field">
                  <label for="confirm">${esc(t('auth.confirmPassword'))}</label>
                  <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="8">
                </div>` : ''}
              <button class="btn block" type="submit" id="auth-submit">
                ${esc(setup ? t('auth.createAccount') : t('auth.login'))}
              </button>
            </form>
            <p class="auth-foot">${esc(t('auth.noAccount'))}</p>
            <p class="auth-foot" style="margin-top:6px">AdamN NMS • ${esc(getLang() === 'en' ? 'Local-first data file (HDANA)' : 'بيانات محلية في ملف HDANA')}</p>
          </div>
        </div>
      </div>`;

    applyTranslations(root);

    root.querySelector('#auth-lang').addEventListener('click', () => {
      setLang(getLang() === 'ar' ? 'en' : 'ar');
      this.mount(root, { setup, message, onSuccess });
    });

    const form = root.querySelector('#auth-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = root.querySelector('#auth-submit');
      const values = Object.fromEntries(new FormData(form).entries());
      if (setup && values.password !== values.confirm) {
        toastError(t('auth.mismatch'));
        return;
      }
      submit.disabled = true;
      submit.textContent = setup ? t('auth.createAccount') : t('auth.login');
      try {
        const payload = setup
          ? await api.post('/auth/setup', {
            username: values.username,
            password: values.password,
            fullName: values.fullName,
            nurseryName: values.nurseryName,
          })
          : await api.post('/auth/login', { username: values.username, password: values.password });
        await onSuccess(payload);
      } catch (err) {
        toastError(err.message);
        submit.disabled = false;
        submit.textContent = setup ? t('auth.createAccount') : t('auth.login');
      }
    });
  },
};
