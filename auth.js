// CCE / Wipomo Tools — Access Gate
// Version: v1.0.1
// To change the password: compute SHA-256 of the new password and replace HASH below.
// Quick way: open browser console on any page and run:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('newpassword'))
//     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))

(function () {
  const HASH = '2d16a416799d22f4b0886c4205ca22b4ffb2e0b5d1bbedcc0b39552576f4a9b8';
  const TOKEN_KEY = 'cce_auth';
  const TOKEN_VALUE = 'granted_' + HASH.slice(0, 16);

  if (sessionStorage.getItem(TOKEN_KEY) === TOKEN_VALUE) return;

  // Hide page content until authenticated
  document.documentElement.style.visibility = 'hidden';

  async function checkPassword(input) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('') === HASH;
  }

  function shake(el) {
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'auth-shake 0.4s ease';
  }

  function buildGate() {
    const style = document.createElement('style');
    style.textContent = `
      #auth-gate {
        position: fixed; inset: 0; z-index: 99999;
        background: #0a0f14;
        display: flex; align-items: center; justify-content: center;
        font-family: 'DM Sans', system-ui, sans-serif;
      }
      #auth-box {
        background: #111820;
        border: 1px solid #1e2d3d;
        border-radius: 14px;
        padding: 2.5rem 2rem;
        width: 100%; max-width: 360px;
        text-align: center;
      }
      #auth-box .auth-logo {
        font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase; color: #4a9eff; margin-bottom: 1.5rem;
      }
      #auth-box h2 {
        font-size: 20px; font-weight: 700; color: #e8edf2; margin-bottom: 0.4rem;
      }
      #auth-box p {
        font-size: 13px; color: #8ba8c4; margin-bottom: 1.75rem;
      }
      #auth-input {
        width: 100%; padding: 0.7rem 1rem;
        background: #0d1520; border: 1px solid #2a3d52;
        border-radius: 8px; color: #e8edf2; font-size: 15px;
        outline: none; margin-bottom: 0.75rem;
        font-family: 'DM Mono', monospace;
        letter-spacing: 0.05em;
      }
      #auth-input:focus { border-color: #4a9eff; }
      #auth-btn {
        width: 100%; padding: 0.7rem;
        background: #4a9eff; border: none; border-radius: 8px;
        color: #fff; font-size: 15px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      }
      #auth-btn:hover { background: #6ab2ff; }
      #auth-error {
        font-size: 12px; color: #ff6b6b;
        margin-top: 0.6rem; min-height: 1.2em;
      }
      @keyframes auth-shake {
        0%,100% { transform: translateX(0); }
        20%      { transform: translateX(-8px); }
        40%      { transform: translateX(8px); }
        60%      { transform: translateX(-5px); }
        80%      { transform: translateX(5px); }
      }
    `;
    document.head.appendChild(style);

    const gate = document.createElement('div');
    gate.id = 'auth-gate';
    gate.innerHTML = `
      <div id="auth-box">
        <div class="auth-logo">Center for Community Energy / Makello</div>
        <h2>Solar Analysis Tools</h2>
        <p>Internal access only. Enter the team password to continue.</p>
        <input id="auth-input" type="password" placeholder="Password" autocomplete="current-password" />
        <button id="auth-btn">Enter</button>
        <div id="auth-error"></div>
      </div>
    `;
    document.body.appendChild(gate);
    // Gate covers the full viewport — safe to restore visibility now
    document.documentElement.style.visibility = '';

    const input = document.getElementById('auth-input');
    const btn = document.getElementById('auth-btn');
    const errEl = document.getElementById('auth-error');
    const box = document.getElementById('auth-box');

    async function attempt() {
      const val = input.value;
      if (!val) return;
      btn.disabled = true;
      const ok = await checkPassword(val);
      if (ok) {
        sessionStorage.setItem(TOKEN_KEY, TOKEN_VALUE);
        gate.remove();
        document.documentElement.style.visibility = '';
      } else {
        errEl.textContent = 'Incorrect password.';
        input.value = '';
        shake(box);
        input.focus();
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
    input.focus();
  }

  if (document.body) {
    buildGate();
  } else {
    document.addEventListener('DOMContentLoaded', buildGate);
  }
})();
