/* ============================================================================
   CCRent dark replica — interactions
   The original ships Astro islands for dialogs + account, and CSS scroll
   animations for reveals. This file re-implements the interaction layer with
   plain DOM APIs: dialogs, booking summary, copy-to-clipboard, accordion,
   scroll progress and the mobile menu.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- toast -- */
  const toastEl = $('[data-toast]');
  let toastTimer;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
      setTimeout(() => (toastEl.hidden = true), 240);
    }, 1900);
  }

  /* ------------------------------------------------------------ dialogs -- */
  const dialogEls = new Map();
  $$('.cr-dialog-backdrop').forEach((el) => {
    const name = el.getAttribute('data-dialog');
    if (name) dialogEls.set(name, el);
  });
  let activeDialog = null;
  let lastFocused = null;

  function openDialog(name) {
    const el = dialogEls.get(name);
    if (!el) return;
    if (activeDialog && activeDialog !== el) closeDialog(true);
    lastFocused = document.activeElement;
    el.hidden = false;
    activeDialog = el;
    document.body.classList.add('cr-locked');
    const focusable = el.querySelector(
      'select, input:not(:disabled), button:not(:disabled):not(.cr-dialog-close), a[href]'
    );
    (focusable || el.querySelector('.cr-dialog-close'))?.focus({ preventScroll: true });
  }

  function closeDialog(silent = false) {
    if (!activeDialog) return;
    activeDialog.hidden = true;
    activeDialog = null;
    document.body.classList.remove('cr-locked');
    if (!silent) lastFocused?.focus?.({ preventScroll: true });
  }

  $$('[data-dialog-close]').forEach((btn) =>
    btn.addEventListener('click', () => closeDialog())
  );
  dialogEls.forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target === el) closeDialog();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      const details = $('header details[open]');
      if (details) details.removeAttribute('open');
    }
    // basic focus trap
    if (e.key === 'Tab' && activeDialog) {
      const items = $$(
        'a[href], button:not([disabled]), select, input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])',
        activeDialog
      ).filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  /* ------------------------------------------------------- dialog wiring -- */
  const openContact = () => openDialog('contact');
  const openBooking = (plan, region) => {
    const select = $('[data-booking-plan]');
    if (select && plan) select.value = plan;
    const regionSelect = $('[data-booking-region]');
    if (regionSelect && region) regionSelect.value = region;
    syncBooking();
    openDialog('booking');
  };

  $$('[data-contact-open]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openContact();
    })
  );

  $$('[data-waitlist-open]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openBooking(planValue(el.dataset.plan), el.dataset.region);
    })
  );

  $$('[data-stock-open]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openDialog('stock');
    })
  );

  const loginBtn = $('[data-open-login]');
  loginBtn?.addEventListener('click', () => openDialog('login'));

  $$('[data-open-booking]').forEach((el) =>
    el.addEventListener('click', () => openBooking('mac'))
  );
  $$('[data-open-contact]').forEach((el) =>
    el.addEventListener('click', () => openContact())
  );

  function planValue(plan) {
    switch (plan) {
      case 'mac':
        return 'mac';
      case 'max5x':
      case 'max':
        return 'max';
      case 'max20x':
      case 'ultra':
        return 'ultra';
      case 'team':
        return 'team';
      default:
        return 'mac';
    }
  }

  /* ---------------------------------------------------- booking summary -- */
  const planSelect = $('[data-booking-plan]');
  const regionSelect = $('[data-booking-region]');
  const bookingSummary = $('[data-booking-summary]');
  const bookingSend = $('[data-booking-send]');

  function syncBooking() {
    if (!planSelect || !regionSelect || !bookingSummary) return;
    const planLabel = planSelect.selectedOptions[0]?.textContent?.split('·')[0].trim() || '';
    const price = planSelect.selectedOptions[0]?.value === 'team' ? '面议' : planSelect.selectedOptions[0]?.textContent?.split('·')[1]?.trim() || '';
    bookingSummary.textContent = `${planLabel} · ${price} · ${regionSelect.value}`;
    if (bookingSend) {
      const text = `你好，我想预订：${planLabel}（${regionSelect.value}）`;
      bookingSend.dataset.shareText = text;
    }
  }
  planSelect?.addEventListener('change', syncBooking);
  regionSelect?.addEventListener('change', syncBooking);
  syncBooking();

  if (bookingSend) {
    bookingSend.addEventListener('click', () => {
      const text = bookingSend.dataset.shareText;
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
          () => toast('预订信息已复制，去 Telegram 发给客服吧'),
          () => {}
        );
      }
    });
  }

  /* -------------------------------------------------------------- copy --- */
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      /* ignore */
    }
    ta.remove();
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('已复制：' + text),
        () => {
          legacyCopy(text);
          toast('已复制：' + text);
        }
      );
    } else {
      legacyCopy(text);
      toast('已复制：' + text);
    }
  }

  // Contact dialog copy buttons
  $$('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () => {
      copyText(btn.dataset.copy);
      const original = btn.textContent;
      btn.textContent = btn.dataset.copiedLabel || '已复制';
      setTimeout(() => (btn.textContent = original), 1600);
    })
  );

  // Inline contact chips in the final CTA
  $$('[data-contact-copy]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.contactCopy;
      const textEl = document.querySelector(`[data-sf-contact-text="${key}"]`);
      const text = textEl?.textContent?.trim();
      if (!text) return;
      copyText(text);
      const original = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => (btn.textContent = original), 1600);
    })
  );

  /* ----------------------------------------------------------- accordion -- */
  const faqItems = $$('#faq details');
  faqItems.forEach((item) =>
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
    })
  );

  /* ---------------------------------------------------- scroll progress --- */
  const progress = $('.scroll-progress');
  const header = $('header.sticky');
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (progress) {
        // Tailwind v4 uses the `scale` property for scale-x-0, so drive that
        // instead of `transform` (which would be multiplied by it).
        progress.style.scale = `${ratio} 1`;
        progress.style.transform = 'none';
      }
      header?.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ------------------------------------------------------- anchor links -- */
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', id);
      const details = $('header details[open]');
      if (details) details.removeAttribute('open');
    });
  });

  /* ------------------------------------------- external demo-only links -- */
  // Links that point at pages outside the replica (account, legal) should not
  // silently jump to the top. Explain instead.
  $$('a[href="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (a.closest('.cr-dialog') || a.hasAttribute('data-waitlist-open')) return;
      e.preventDefault();
      toast('复刻演示站：这个页面没有包含在内');
    });
  });

  /* ------------------------------------------- directory badges (footer) -- */
  // Badge images are hot-linked from third-party directories. Drop the ones
  // that fail to load so the footer never shows broken images, and hide the
  // whole row when nothing loaded (offline preview).
  const badges = $('.sf-badges');
  if (badges) {
    const items = $$('.sf-badges li', badges);
    items.forEach((li) => {
      const img = li.querySelector('img');
      if (!img) return;
      img.addEventListener('error', () => li.remove());
    });
    setTimeout(() => {
      if (!badges.querySelector('li')) badges.hidden = true;
    }, 6000);
  }

  /* ----------------------------------------------------- mobile menu ---- */
  $$('header details').forEach((details) => {
    document.addEventListener('click', (e) => {
      if (!details.contains(e.target)) details.removeAttribute('open');
    });
  });
})();
