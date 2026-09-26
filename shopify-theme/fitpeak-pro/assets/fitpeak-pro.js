/* FITPEAK PRO 登録フォーム（sections/lp-fitpeak-pro.liquid）  2026-09-27
   クレアショット（creashot-plans.js）と同じ流れ：
   プラン選択 → /cart/clear.js → /cart/add.js（selling_plan付き）→ メールを引き継いで /checkout */
(function () {
  var dataEl = document.getElementById('fpp-data');
  if (!dataEl) return;
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }

  var form = document.getElementById('fpp-form');
  var summaryEl = document.getElementById('fpp-summary');
  var submitBtn = document.getElementById('fpp-submit');
  var submitSub = document.getElementById('fpp-submit-sub');
  var errorEl = document.getElementById('fpp-error');
  var variantInput = document.getElementById('fpp-variant-id');
  var planInput = document.getElementById('fpp-selling-plan');
  var emailEl = document.getElementById('fpp-email');
  var emailField = document.getElementById('fpp-email-field');
  var agreeEl = document.getElementById('fpp-agree');
  var trial = data.trialDays || 14;

  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function addDaysLabel(days) {
    var d = new Date(Date.now() + days * 86400000);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function current() {
    var r = form.querySelector('input[name="fpp_plan"]:checked');
    return r ? r.value : 'year';
  }
  function showError(msg) {
    errorEl.textContent = msg; errorEl.hidden = false;
    clearTimeout(showError._t);
    showError._t = setTimeout(function () { errorEl.hidden = true; }, 6000);
  }

  function update() {
    var key = current();
    var v = data.variants[key];
    form.querySelectorAll('.fpp-plan').forEach(function (el) { el.classList.toggle('is-selected', el.getAttribute('data-plan') === key); });
    if (!v) { submitBtn.disabled = true; return; }
    variantInput.value = v.id;
    planInput.value = v.sellingPlanId || '';
    var price = v.price / 100;
    summaryEl.innerHTML =
      '<div>' + v.label + '：<strong>今日は0円</strong></div>' +
      '<div>' + addDaysLabel(trial) + 'から <strong>' + yen(price) + '</strong>／' + v.per + '（税込）</div>' +
      '<small>' + addDaysLabel(trial - 1) + 'までに解約すれば、料金はかかりません。</small>';
    submitSub.textContent = '今日は0円・' + addDaysLabel(trial) + 'から' + yen(price) + '／' + v.per;
    submitBtn.disabled = !v.available || !v.sellingPlanId;
    if (!v.sellingPlanId) showError('登録の準備中です。しばらくしてから再度お試しください。');
  }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'fpp_plan') update();
    if (e.target === agreeEl) agreeEl.closest('.fpp-agree').classList.remove('is-invalid');
  });

  // メール
  var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function checkEmail(show) {
    var v = (emailEl.value || '').trim();
    var ok = emailRe.test(v);
    emailField.classList.toggle('is-valid', ok);
    emailField.classList.toggle('is-invalid', !ok && show);
    emailField.querySelector('.fpp-err').textContent = ok || !show ? '' : 'メールアドレスの形式で入力してください（例: name@example.com）';
    return ok;
  }
  try { var saved = sessionStorage.getItem('fpp_email'); if (saved) emailEl.value = saved; } catch (e) {}
  emailEl.addEventListener('input', function () {
    emailEl.value = emailEl.value.replace(/\s/g, '');
    checkEmail(false);
    try { sessionStorage.setItem('fpp_email', emailEl.value); } catch (e) {}
  });
  emailEl.addEventListener('blur', function () { checkEmail(true); });

  var nativeFallback = false;
  form.addEventListener('submit', function (e) {
    if (nativeFallback) return;
    e.preventDefault();
    var vid = parseInt(variantInput.value, 10);
    var spid = parseInt(planInput.value, 10);
    if (!vid || !spid) { showError('プランを選択してください'); return; }
    if (!checkEmail(true)) { emailEl.focus(); showError('メールアドレスを入力してください'); return; }
    if (!agreeEl.checked) {
      agreeEl.closest('.fpp-agree').classList.add('is-invalid');
      showError('定期契約の条件への同意にチェックを入れてください');
      return;
    }
    submitBtn.disabled = true;
    var mainEl = submitBtn.querySelector('.fpp-submit__main');
    var prev = mainEl.textContent;
    mainEl.textContent = '処理中…';
    if (typeof fbq === 'function') { try { fbq('track', 'StartTrial', { value: 0, currency: 'JPY', predicted_ltv: 4800 }); } catch (err) {} }
    var email = emailEl.value.trim();

    fetch('/cart/clear.js', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(function () {
        return fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ items: [{ id: vid, quantity: 1, selling_plan: spid }] })
        });
      })
      .then(function (r) { if (!r.ok) throw new Error('add failed'); return r.json(); })
      .then(function () {
        return fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: { checkout_email: email, signup_source: 'fitpeak-pro-lp' } }) }).catch(function () {});
      })
      .then(function () { window.location.href = '/checkout?checkout[email]=' + encodeURIComponent(email); })
      .catch(function () {
        submitBtn.disabled = false; mainEl.textContent = prev;
        nativeFallback = true;
        form.querySelector('input[name="return_to"]').value = '/checkout?checkout[email]=' + encodeURIComponent(email);
        form.submit();
      });
  });

  // ページ内リンク（ヘッダー・ヒーロー・追従バー）
  var section = document.getElementById('pro-plans');
  document.addEventListener('click', function (e) {
    var j = e.target && e.target.closest ? e.target.closest('[data-fpp-jump]') : null;
    if (!j || !section) return;
    e.preventDefault();
    try { section.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { section.scrollIntoView(); }
  });

  // 追従バー：ヒーローを過ぎたら出し、フォームが見えている間は隠す
  var sticky = document.getElementById('fpp-sticky');
  if (sticky && section) {
    var formInView = false;
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { formInView = en.isIntersecting; toggle(); });
      }, { threshold: 0.02 }).observe(section);
    }
    function toggle() {
      var on = window.scrollY > 520 && !formInView;
      sticky.classList.toggle('is-on', on);
      sticky.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    window.addEventListener('scroll', toggle, { passive: true });
    toggle();
  }

  update();
})();
