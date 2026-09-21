/* クレアショット 定期プラン選択フォーム（EFO）  2026-09-16 */
  (function () {
    var dataEl = document.getElementById('csp-data');
    if (!dataEl) return;
    var data;
    try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }

    var form = document.getElementById('csp-form');
    var cardsEl = document.getElementById('csp-cards');
    var summaryEl = document.getElementById('csp-summary');
    var submitBtn = document.getElementById('csp-submit');
    var submitSub = document.getElementById('csp-submit-sub');
    var errorEl = document.getElementById('csp-error');
    var variantInput = document.getElementById('csp-variant-id');
    var planInput = document.getElementById('csp-selling-plan');
    var CFG = (function () { try { return JSON.parse(document.getElementById('csp-config').textContent); } catch (e) { return {}; } })();
    var DEFAULT_CYCLE = CFG.defaultCycle || '3ヶ月ごと';

    var META = {
      '1ヶ月ごと': { months: 1, note: '毎月お届け。まず試したい方に' },
      '3ヶ月ごと': { months: 3, badge: '一番人気', note: '3ヶ月分をまとめてお届け', hero: true },
      '12ヶ月ごと': { months: 12, badge: '一番お得', best: true, note: '1年分をまとめて購入（配送は3ヶ月ごと）。更新前にLINEとメールでお知らせ' }
    };

    function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
    function bagsOf(sticks, months) { return (sticks === '1日2本' ? 2 : 1) * months; }
    function currentSticks() {
      var r = form.querySelector('input[name="csp_sticks"]:checked');
      return r ? r.value : '1日1本';
    }
    var selectedCycle = DEFAULT_CYCLE;

    function variantFor(sticks, cycle) {
      for (var i = 0; i < data.variants.length; i++) {
        var v = data.variants[i];
        if (v.sticks === sticks && v.cycle === cycle) return v;
      }
      return null;
    }

    function render() {
      var sticks = currentSticks();
      cardsEl.innerHTML = '';
      data.cycles.forEach(function (cycle) {
        var v = variantFor(sticks, cycle);
        if (!v) return;
        var m = META[cycle] || { months: 1 };
        var bags = bagsOf(sticks, m.months);
        var price = v.price / 100;
        var perBag = price / bags;
        var perBagLabel = Number.isInteger(perBag) ? yen(perBag) : '約' + yen(Math.ceil(perBag / 10) * 10);
        // 「○袋無料」は1日1本のプランだけ（1ヶ月ごと6,980円を基準に計算）。1日2本は1袋あたりの価格で伝える
        var freeBags = sticks === '1日1本' ? Math.round((6980 * m.months - price) / 6980) : 0;
        var label = document.createElement('label');
        label.className = 'csp__card' + (m.hero ? ' csp__card--hero' : '') + (cycle === selectedCycle ? ' is-selected' : '');
        label.innerHTML =
          '<input type="radio" name="csp_cycle" value="' + cycle + '"' + (cycle === selectedCycle ? ' checked' : '') + '>' +
          (m.badge ? '<span class="csp__badge' + (m.best ? ' csp__badge--best' : '') + '">' + m.badge + (freeBags > 0 ? '・' + freeBags + '袋無料' : '') + '</span>' : '') +
          '<span class="csp__card-radio"></span>' +
          '<div class="csp__card-row"><span class="csp__card-name">' + cycle + '</span><span class="csp__card-bags">' + bags + '袋（' + (bags * 28) + '本）</span></div>' +
          '<div class="csp__card-price"><strong>' + yen(price) + '</strong>' + (v.compareAt > v.price ? '<s>' + yen(v.compareAt / 100) + '</s>' : '') + '<em>税込・送料無料</em></div>' +
          '<div class="csp__card-unit">1袋あたり ' + perBagLabel + ' <small>（' + cycle + 'に' + yen(price) + '）</small>' + (freeBags > 0 ? '<span class="csp__card-free">' + freeBags + '袋無料</span>' : '') + '</div>' +
          (m.note ? '<div class="csp__card-note">' + m.note + '</div>' : '');
        cardsEl.appendChild(label);
      });
      updateSummary();
    }

    function updateSummary() {
      var sticks = currentSticks();
      var v = variantFor(sticks, selectedCycle);
      if (!v) { submitBtn.disabled = true; return; }
      var m = META[selectedCycle] || { months: 1 };
      var bags = bagsOf(sticks, m.months);
      variantInput.value = v.id;
      planInput.value = v.sellingPlanId || '';
      submitBtn.disabled = !v.available || !v.sellingPlanId;
      summaryEl.innerHTML =
        '<div>' + sticks + '・' + selectedCycle + 'に <strong>' + bags + '袋</strong>（' + (bags * 28) + '本）</div>' +
        '<div><strong>' + yen(v.price / 100) + '</strong> 税込・送料無料</div>' +
        '<small>2回目以降は次回お届け日の3日前に自動決済。いつでも休会・解約できます。</small>';
      submitSub.textContent = selectedCycle + ' ' + yen(v.price / 100) + '（送料無料）';
      if (!v.sellingPlanId) showError('定期プランの設定が完了していません。しばらくしてから再度お試しください。');
    }

    function showError(msg) {
      errorEl.textContent = msg; errorEl.hidden = false;
      setTimeout(function () { errorEl.hidden = true; }, 5000);
    }

    form.addEventListener('change', function (e) {
      if (e.target.name === 'csp_sticks') render();
      if (e.target.name === 'csp_cycle') {
        selectedCycle = e.target.value;
        cardsEl.querySelectorAll('.csp__card').forEach(function (c) { c.classList.toggle('is-selected', c.querySelector('input').value === selectedCycle); });
        updateSummary();
      }
    });

    // ─────────────── STEP 3: EFO（入力フォーム最適化） ───────────────
    var PREFS = [['北海道','Hokkaido'],['青森県','Aomori'],['岩手県','Iwate'],['宮城県','Miyagi'],['秋田県','Akita'],['山形県','Yamagata'],['福島県','Fukushima'],['茨城県','Ibaraki'],['栃木県','Tochigi'],['群馬県','Gunma'],['埼玉県','Saitama'],['千葉県','Chiba'],['東京都','Tokyo'],['神奈川県','Kanagawa'],['新潟県','Niigata'],['富山県','Toyama'],['石川県','Ishikawa'],['福井県','Fukui'],['山梨県','Yamanashi'],['長野県','Nagano'],['岐阜県','Gifu'],['静岡県','Shizuoka'],['愛知県','Aichi'],['三重県','Mie'],['滋賀県','Shiga'],['京都府','Kyoto'],['大阪府','Osaka'],['兵庫県','Hyogo'],['奈良県','Nara'],['和歌山県','Wakayama'],['鳥取県','Tottori'],['島根県','Shimane'],['岡山県','Okayama'],['広島県','Hiroshima'],['山口県','Yamaguchi'],['徳島県','Tokushima'],['香川県','Kagawa'],['愛媛県','Ehime'],['高知県','Kochi'],['福岡県','Fukuoka'],['佐賀県','Saga'],['長崎県','Nagasaki'],['熊本県','Kumamoto'],['大分県','Oita'],['宮崎県','Miyazaki'],['鹿児島県','Kagoshima'],['沖縄県','Okinawa']];
    var provinceSel = document.getElementById('csp-province');
    PREFS.forEach(function (p) { var o = document.createElement('option'); o.value = p[1]; o.textContent = p[0]; provinceSel.appendChild(o); });

    var F = {
      email: { el: document.getElementById('csp-email'), test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }, msg: 'メールアドレスの形式で入力してください（例: name@example.com）' },
      last_name: { el: document.getElementById('csp-last-name'), test: function (v) { return v.length >= 1; }, msg: '姓を入力してください' },
      first_name: { el: document.getElementById('csp-first-name'), test: function (v) { return v.length >= 1; }, msg: '名を入力してください' },
      zip: { el: document.getElementById('csp-zip'), test: function (v) { return /^\d{3}-\d{4}$/.test(v); }, msg: '郵便番号は7桁の数字で入力してください' },
      province: { el: provinceSel, test: function (v) { return !!v; }, msg: '都道府県を選択してください' },
      city: { el: document.getElementById('csp-city'), test: function (v) { return v.length >= 1; }, msg: '市区町村を入力してください' },
      address1: { el: document.getElementById('csp-address1'), test: function (v) { return v.length >= 2; }, msg: '番地・建物名を入力してください' },
      phone: { el: document.getElementById('csp-phone'), test: function (v) { var d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 11; }, msg: '電話番号は10〜11桁の数字で入力してください' }
    };
    var ORDER = ['email', 'last_name', 'first_name', 'zip', 'province', 'city', 'address1', 'phone'];
    var progressEl = document.getElementById('csp-progress');
    var touched = {};

    function fieldWrap(key) { return F[key].el.closest('.csp__field'); }
    function val(key) { return (F[key].el.value || '').trim(); }
    function setState(key, show) {
      var w = fieldWrap(key); var v = val(key); var ok = F[key].test(v);
      w.classList.toggle('is-valid', ok && v.length > 0);
      w.classList.toggle('is-invalid', !ok && show && (touched[key] || v.length > 0));
      w.querySelector('.csp__err').textContent = ok ? '' : F[key].msg;
      return ok;
    }
    function validateAll(show) {
      var okAll = true; var left = 0;
      ORDER.forEach(function (k) { var ok = setState(k, show || !!touched[k]); if (!ok) { okAll = false; left++; } });
      progressEl.textContent = okAll ? '入力完了' : 'あと' + left + '項目';
      submitBtn.classList.toggle('is-incomplete', !okAll);
      return okAll;
    }

    // 下書きの復元（同じタブ内のみ）
    try {
      var draft = JSON.parse(sessionStorage.getItem('csp_draft') || '{}');
      ORDER.forEach(function (k) { if (draft[k]) F[k].el.value = draft[k]; });
    } catch (e) {}
    function saveDraft() {
      try { var d = {}; ORDER.forEach(function (k) { d[k] = val(k); }); sessionStorage.setItem('csp_draft', JSON.stringify(d)); } catch (e) {}
    }

    ORDER.forEach(function (k) {
      var el = F[k].el;
      el.addEventListener('input', function () {
        if (k === 'zip') { var d = el.value.replace(/\D/g, '').slice(0, 7); el.value = d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d; if (d.length === 7) lookupZip(d); }
        if (k === 'phone') { el.value = el.value.replace(/[^\d\-]/g, ''); }
        if (k === 'email') { el.value = el.value.replace(/\s/g, ''); }
        setState(k, touched[k]); validateAll(false); saveDraft();
      });
      el.addEventListener('blur', function () { touched[k] = true; setState(k, true); validateAll(false); });
      el.addEventListener('change', function () { touched[k] = true; setState(k, true); validateAll(false); saveDraft(); });
    });

    // 郵便番号 → 住所（zipcloud）
    var zipStatus = document.getElementById('csp-zip-status');
    var zipTimer = null;
    function lookupZip(digits) {
      zipStatus.textContent = '検索中…';
      clearTimeout(zipTimer);
      zipTimer = setTimeout(function () {
        fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + digits)
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var r = j && j.results && j.results[0];
            if (!r) { zipStatus.textContent = '見つかりません'; return; }
            var pref = PREFS.filter(function (p) { return p[0] === r.address1; })[0];
            if (pref) { provinceSel.value = pref[1]; touched.province = true; setState('province', true); }
            F.city.el.value = r.address2 || ''; touched.city = true; setState('city', true);
            if (!val('address1') && r.address3) { F.address1.el.value = r.address3; }
            setState('address1', false);
            zipStatus.textContent = '住所を入力しました';
            validateAll(false); saveDraft();
            F.address1.el.focus();
            setTimeout(function () { zipStatus.textContent = ''; }, 3000);
          })
          .catch(function () { zipStatus.textContent = ''; });
      }, 150);
    }
    validateAll(false);

    function checkoutQuery() {
      var d = val('phone').replace(/\D/g, '');
      var parts = [
        'checkout[email]=' + encodeURIComponent(val('email')),
        'checkout[shipping_address][last_name]=' + encodeURIComponent(val('last_name')),
        'checkout[shipping_address][first_name]=' + encodeURIComponent(val('first_name')),
        'checkout[shipping_address][zip]=' + encodeURIComponent(val('zip')),
        'checkout[shipping_address][province]=' + encodeURIComponent(val('province')),
        'checkout[shipping_address][city]=' + encodeURIComponent(val('city')),
        'checkout[shipping_address][address1]=' + encodeURIComponent(val('address1')),
        'checkout[shipping_address][country]=JP',
        'checkout[shipping_address][phone]=' + encodeURIComponent(d),
        'checkout[phone]=' + encodeURIComponent(d)
      ];
      return parts.join('&');
    }

    var nativeFallback = false;
    form.addEventListener('submit', function (e) {
      if (nativeFallback) return; // fetchに失敗した後は通常のフォーム送信に任せる
      e.preventDefault();
      var vid = parseInt(variantInput.value, 10);
      var spid = parseInt(planInput.value, 10);
      if (!vid || !spid) { showError('プランを選択してください'); return; }
      ORDER.forEach(function (k) { touched[k] = true; });
      if (!validateAll(true)) {
        var firstBad = ORDER.filter(function (k) { return !F[k].test(val(k)); })[0];
        if (firstBad) { try { F[firstBad].el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {} F[firstBad].el.focus(); }
        showError('未入力の項目があります');
        return;
      }
      submitBtn.disabled = true;
      var mainEl = submitBtn.querySelector('.csp__submit-main');
      var prev = mainEl.textContent;
      mainEl.textContent = '処理中…';
      if (typeof fbq === 'function') { try { fbq('track', 'AddToCart', { content_ids: [String(vid)], value: 0, currency: 'JPY' }); } catch (err) {} }

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
          // 連絡先をカート属性にも残す（メール未取得時の保険）
          return fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attributes: { checkout_email: val('email'), checkout_phone: val('phone') } }) }).catch(function () {});
        })
        .then(function () { window.location.href = '/checkout?' + checkoutQuery(); })
        .catch(function () {
          // fetchが使えない環境では通常のフォーム送信（/cart/add → /checkout）
          submitBtn.disabled = false; mainEl.textContent = prev;
          nativeFallback = true;
          form.querySelector('input[name="return_to"]').value = '/checkout?' + checkoutQuery();
          form.submit();
        });
    });

    render();

    // LP本文（lp-images）が差し込む「公式LINE登録」CTAを、ページ内の定期プランへのCTAに置き換える。
    // 販売LPではLINE登録ボタンを一切出さない。
    function rewriteLineCtas() {
      var ctas = document.querySelectorAll('.lp-cta');
      Array.prototype.forEach.call(ctas, function (cta) {
        if (cta.getAttribute('data-csp-rewritten')) return;
        var a = cta.querySelector('a[href*="line.me"], a[href*="line-crm"]');
        if (!a) return;
        cta.setAttribute('data-csp-rewritten', '1');
        cta.innerHTML =
          '<div style="font-size:clamp(10px,2.9vw,13px)!important;font-weight:800;color:#4a6b00;margin:0 0 8px;line-height:1.35!important;letter-spacing:-0.03em;white-space:nowrap;">' + esc(CFG.inlpCtaSub || '＼ 送料無料・いつでも休会OK ／') + '</div>' +
          '<a href="#creashot-plans" data-csp-jump style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px;background:linear-gradient(135deg,#3F9403,#7cbd0c);color:#fff;border:none;border-radius:12px;font-size:clamp(14px,4.2vw,17px)!important;font-weight:700;white-space:nowrap;text-decoration:none;box-sizing:border-box;min-height:56px;box-shadow:0 4px 16px rgba(63,148,3,0.35);">' +
            '<span style="font-size:clamp(14px,4.2vw,17px)!important;font-weight:700;color:#fff!important;-webkit-text-fill-color:#fff!important;line-height:1.4!important;white-space:nowrap;">' + esc(CFG.inlpCtaText || '定期プランを見る') + '</span>' +
            '<span style="font-size:14px!important;color:#fff!important;-webkit-text-fill-color:#fff!important;">&#10095;</span>' +
          '</a>';
      });
    }
    rewriteLineCtas();
    [300, 1500, 4000].forEach(function (ms) { setTimeout(rewriteLineCtas, ms); });
    if (typeof MutationObserver === 'function') {
      var root = document.querySelector('[data-lp-desc]');
      if (root) new MutationObserver(rewriteLineCtas).observe(root, { childList: true });
    }
    document.addEventListener('click', function (e) {
      var j = e.target && e.target.closest ? e.target.closest('[data-csp-jump]') : null;
      if (!j) return;
      var sec = document.getElementById('creashot-plans');
      if (!sec) return;
      e.preventDefault();
      e.stopPropagation();
      try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { sec.scrollIntoView(); }
    }, true);

    // 追従バー: LP本文を読み進めたら出し、フォームが見えている間は隠す
    var sticky = document.getElementById('csp-sticky');
    if (sticky) {
      var section = document.getElementById('creashot-plans');
      var formInView = false;
      if (typeof IntersectionObserver === 'function') {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { formInView = en.isIntersecting; toggleSticky(); });
        }, { threshold: 0.05 }).observe(section);
      }
      function toggleSticky() {
        var on = window.scrollY > 600 && !formInView;
        sticky.classList.toggle('is-on', on);
        sticky.setAttribute('aria-hidden', on ? 'false' : 'true');
      }
      window.addEventListener('scroll', toggleSticky, { passive: true });
      sticky.querySelector('[data-csp-sticky]').addEventListener('click', function (e) {
        e.preventDefault();
        try { section.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { section.scrollIntoView(); }
      });
      toggleSticky();
    }
  })();
