(function() {
  var API_BASE = 'https://business-hub-beige.vercel.app/api/public/reviews/';

  function getProductId() {
    var manual = document.getElementById('fitpeak-reviews');
    if (manual && manual.getAttribute('data-product-id')) {
      return { id: manual.getAttribute('data-product-id'), container: manual };
    }
    var productId = null;
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      productId = String(window.ShopifyAnalytics.meta.product.id);
    }
    if (!productId && window.meta && window.meta.product) {
      productId = String(window.meta.product.id);
    }
    if (!productId) {
      var scripts = document.querySelectorAll('script[type="application/json"][data-product-json], script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        try {
          var json = JSON.parse(scripts[i].textContent);
          if (json && json.id && json.variants) { productId = String(json.id); break; }
        } catch(e) {}
      }
    }
    if (!productId) {
      var match = window.location.pathname.match(/\/products\/([^/?#]+)/);
      if (match) return { handle: match[1], container: null };
    }
    if (!productId) return null;
    return { id: productId, container: null };
  }

  function findInsertPoint() {
    var selectors = [
      '.product__description', '.product-single__description', '[data-product-description]',
      '.product__info-container', '.product-single__meta', '.product__content',
      '.product-info', '.product__details', '.product-details',
      '.product-form', 'form[action*="/cart/add"]', '.product-single', '.product'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return document.querySelector('main') || document.querySelector('#MainContent') || document.body;
  }

  function createContainer(productId) {
    var existing = document.getElementById('fitpeak-reviews');
    if (existing) { existing.setAttribute('data-product-id', productId); return existing; }
    var container = document.createElement('div');
    container.id = 'fitpeak-reviews';
    container.setAttribute('data-product-id', productId);
    container.style.cssText = 'margin-top:40px;padding-top:20px;width:100%';
    var insertPoint = findInsertPoint();
    if (insertPoint.tagName === 'FORM' || insertPoint.classList.contains('product-form')) {
      insertPoint.parentNode.insertBefore(container, insertPoint.nextSibling);
    } else {
      insertPoint.appendChild(container);
    }
    return container;
  }

  function el(tag, styles, children, textContent) {
    var node = document.createElement(tag);
    if (styles) Object.keys(styles).forEach(function(k) { node.style[k] = styles[k]; });
    if (textContent) node.textContent = textContent;
    if (children) children.forEach(function(c) { if (c) node.appendChild(c); });
    return node;
  }

  function starText(rating) {
    return Array.from({length:5}, function(_,i) { return i < Math.round(rating) ? '\u2605' : '\u2606'; }).join('');
  }

  function sourceLabel(s) { return {amazon:'Amazon',survey:'\u30a2\u30f3\u30b1\u30fc\u30c8'}[s] || ''; }

  function makeBar(label, count, total) {
    var pct = total ? Math.round(count / total * 100) : 0;
    var row = document.createElement('div');
    row.setAttribute('style', 'display:flex !important;align-items:center !important;gap:8px !important;margin-bottom:5px !important;font-size:12px !important;color:#666 !important');

    var lbl = document.createElement('span');
    lbl.setAttribute('style', 'min-width:10px !important;text-align:right !important');
    lbl.textContent = String(label);
    row.appendChild(lbl);

    // SVG bar - immune to CSS overrides
    var w = 200, h = 10, r = 5;
    var fillW = Math.round(w * pct / 100);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('style', 'flex-shrink:0 !important;display:inline-block !important');
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
    bg.setAttribute('width', w); bg.setAttribute('height', h);
    bg.setAttribute('rx', r); bg.setAttribute('fill', '#d1d5db');
    svg.appendChild(bg);
    if (fillW > 0) {
      var fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      fill.setAttribute('x', '0'); fill.setAttribute('y', '0');
      fill.setAttribute('width', fillW); fill.setAttribute('height', h);
      fill.setAttribute('rx', r); fill.setAttribute('fill', '#f59e0b');
      svg.appendChild(fill);
    }
    row.appendChild(svg);

    var cnt = document.createElement('span');
    cnt.setAttribute('style', 'min-width:20px !important');
    cnt.textContent = String(count);
    row.appendChild(cnt);

    return row;
  }

  function insertTopBadge(stats) {
    if (!stats || !stats.total_count) return;
    if (document.getElementById('fp-top-badge')) return;
    var selectors = ['.product__title','.product-single__title','h1.product-title','[data-product-title]','.product-info h1','.product__info-container h1','h1'];
    var titleEl = null;
    for (var i = 0; i < selectors.length; i++) {
      var candidates = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].closest && candidates[j].closest('#fitpeak-reviews')) continue;
        titleEl = candidates[j]; break;
      }
      if (titleEl) break;
    }
    if (!titleEl) return;

    var badge = document.createElement('a');
    badge.id = 'fp-top-badge';
    badge.href = '#fitpeak-reviews';
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;text-decoration:none;margin-top:8px;cursor:pointer';
    var s1 = el('span', {color:'#f59e0b',fontSize:'16px',letterSpacing:'1px'}, null, starText(stats.average_rating));
    var s2 = el('span', {fontSize:'13px',color:'#666'}, null, stats.average_rating + ' (' + stats.total_count + '\u4ef6\u306e\u30ec\u30d3\u30e5\u30fc)');
    badge.appendChild(s1);
    badge.appendChild(s2);
    titleEl.parentNode.insertBefore(badge, titleEl.nextSibling);
  }

  function renderReviews(container, data) {
    if (!data.reviews || data.reviews.length === 0) return;
    insertTopBadge(data.stats);

    var stats = data.stats || {};
    var reviews = data.reviews.slice().sort(function(a, b) { return b.rating - a.rating; });
    var showCount = 5;

    // Root
    var root = el('div', {
      fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      color:'#1a1a1a', maxWidth:'960px', margin:'0 auto', padding:'0 20px'
    });

    // Title
    root.appendChild(el('div', {fontSize:'18px',fontWeight:'700',marginBottom:'16px'}, null, '\u30ab\u30b9\u30bf\u30de\u30fc\u30ec\u30d3\u30e5\u30fc'));

    // Summary
    if (stats.total_count) {
      var summary = el('div', {display:'flex',alignItems:'center',gap:'16px',padding:'20px 0',borderBottom:'1px solid #e5e5e5',marginBottom:'20px',flexWrap:'wrap'});

      var avgBox = el('div', {});
      avgBox.appendChild(el('div', {fontSize:'48px',fontWeight:'700',lineHeight:'1'}, null, String(stats.average_rating || 0)));
      avgBox.appendChild(el('div', {color:'#f59e0b',fontSize:'18px',letterSpacing:'2px'}, null, starText(stats.average_rating || 0)));
      avgBox.appendChild(el('div', {fontSize:'14px',color:'#666',marginTop:'4px'}, null, stats.total_count + '\u4ef6\u306e\u30ec\u30d3\u30e5\u30fc'));
      summary.appendChild(avgBox);

      var bars = el('div', {flex:'1',minWidth:'150px',maxWidth:'240px'});
      for (var i = 5; i >= 1; i--) {
        bars.appendChild(makeBar(i, stats['rating_' + i] || 0, stats.total_count));
      }
      summary.appendChild(bars);
      root.appendChild(summary);
    }

    // Reviews
    var hiddenEls = [];
    reviews.forEach(function(r, idx) {
      var card = el('div', {padding:'16px 0',borderBottom:'1px solid #f0f0f0'});
      if (idx >= showCount) { card.style.display = 'none'; hiddenEls.push(card); }

      // Header
      var header = el('div', {display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',flexWrap:'wrap'});
      header.appendChild(el('span', {color:'#f59e0b',fontSize:'14px'}, null, starText(r.rating)));
      header.appendChild(el('span', {fontSize:'13px',color:'#666'}, null, r.author_name || '\u8cfc\u5165\u8005'));
      if (r.verified_purchase) header.appendChild(el('span', {fontSize:'11px',color:'#16a34a',fontWeight:'500'}, null, '\u2713 \u8a8d\u8a3c\u6e08\u307f\u8cfc\u5165'));
      var sl = sourceLabel(r.source);
      if (sl) header.appendChild(el('span', {fontSize:'11px',color:'#999',background:'#f5f5f5',padding:'1px 6px',borderRadius:'8px'}, null, sl));
      header.appendChild(el('span', {fontSize:'12px',color:'#999'}, null, new Date(r.created_at).toLocaleDateString('ja-JP')));
      card.appendChild(header);

      if (r.title) card.appendChild(el('div', {fontSize:'15px',fontWeight:'600',marginBottom:'4px'}, null, r.title));
      card.appendChild(el('div', {fontSize:'14px',lineHeight:'1.6',color:'#333',whiteSpace:'pre-wrap'}, null, r.body));
      root.appendChild(card);
    });

    // Show more button
    if (reviews.length > showCount) {
      var btn = el('button', {
        display:'block',width:'100%',padding:'12px',textAlign:'center',
        background:'#f5f5f5',border:'none',borderRadius:'8px',
        fontSize:'14px',color:'#666',cursor:'pointer',marginTop:'16px'
      }, null, '\u3059\u3079\u3066\u306e\u30ec\u30d3\u30e5\u30fc\u3092\u898b\u308b (' + reviews.length + '\u4ef6)');
      btn.addEventListener('click', function() {
        hiddenEls.forEach(function(e) { e.style.display = ''; });
        btn.style.display = 'none';
      });
      root.appendChild(btn);
    }

    container.innerHTML = '';
    container.appendChild(root);
  }

  function init() {
    if (window.__fpReviewsLoaded) return;
    var result = getProductId();
    if (!result) return;
    window.__fpReviewsLoaded = true;

    if (result.handle && !result.id) {
      fetch(window.location.origin + '/products/' + result.handle + '.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.product && data.product.id) {
            var container = result.container || createContainer(String(data.product.id));
            fetch(API_BASE + data.product.id).then(function(r) { return r.json(); })
              .then(function(rd) { renderReviews(container, rd); });
          }
        }).catch(function(err) { console.error('FitPeak Reviews:', err); });
      return;
    }

    var container = result.container || createContainer(result.id);
    if (container.getAttribute('data-loaded')) return;
    container.setAttribute('data-loaded', '1');
    fetch(API_BASE + result.id).then(function(r) { return r.json(); })
      .then(function(data) { renderReviews(container, data); })
      .catch(function(err) { console.error('FitPeak Reviews:', err); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  var lastUrl = window.location.href;
  setInterval(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      window.__fpReviewsLoaded = false;
      var old = document.getElementById('fitpeak-reviews');
      if (old) { old.removeAttribute('data-loaded'); old.innerHTML = ''; }
      var badge = document.getElementById('fp-top-badge');
      if (badge) badge.remove();
      init();
    }
  }, 1000);
})();
