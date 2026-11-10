/* ==========================================================================
   Arsyad Grant Saputro — Personal Portfolio
   Theme: Darknode Tactical HUD & Defence-Tech Architectural Grid
   Interactions, Targeting Cursor, Scroll-Driven Sectors, Modals & i18n
   ========================================================================== */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ==========================================================================
     1. BILINGUAL LANGUAGE SWITCHER (ID & EN)
     ========================================================================== */
  let currentLang = localStorage.getItem("portfolio_lang") || "id";

  const applyLanguage = (lang) => {
    if (!window.TRANSLATIONS || !window.TRANSLATIONS[lang]) return;
    currentLang = lang;
    localStorage.setItem("portfolio_lang", lang);
    document.documentElement.lang = lang;

    // Update active button state
    $$(".lang-btn").forEach((btn) => {
      const isActive = btn.dataset.lang === lang;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });

    const dict = window.TRANSLATIONS[lang];
    $$("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (dict[key]) {
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          el.placeholder = dict[key];
        } else {
          el.innerHTML = dict[key];
        }
      }
    });
    window.updateSimulator?.();
  };

  // Setup language button clicks
  $$(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyLanguage(btn.dataset.lang));
  });

  // Initial language application
  applyLanguage(currentLang);

  /* ==========================================================================
     2B. DARKNODE TACTICAL TELEMETRY & RED OPTICS MODE
     ========================================================================== */
  const coordReadout = $("#coordReadout");
  if (coordReadout) {
    window.addEventListener(
      "pointermove",
      (e) => {
        const x = String(Math.round(e.clientX)).padStart(4, "0");
        const y = String(Math.round(e.clientY)).padStart(4, "0");
        coordReadout.textContent = `X:${x} Y:${y}`;
      },
      { passive: true }
    );
  }

  const opticsToggle = $("#opticsToggle");
  if (opticsToggle) {
    opticsToggle.addEventListener("click", () => {
      const isRed = document.body.classList.toggle("is-red-optics");
      opticsToggle.setAttribute("aria-pressed", String(isRed));
      opticsToggle.textContent = isRed ? "[OPTICS: RED]" : "[OPTICS: STD]";
    });
  }

  /* ==========================================================================
     2C. TEXT DECODE / SCRAMBLE (HUD "data incoming" effect)
     ========================================================================== */
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>_+";
  const scramble = (el, finalText, duration = 600) => {
    if (!el) return;
    if (reduceMotion) { el.textContent = finalText; return; }
    cancelAnimationFrame(el._scrambleRaf);
    const start = performance.now();
    const len = finalText.length;
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const revealed = Math.floor(p * len);
      let out = finalText.slice(0, revealed);
      for (let i = revealed; i < len; i++) {
        out += finalText[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (p < 1) el._scrambleRaf = requestAnimationFrame(tick);
      else el.textContent = finalText;
    };
    el._scrambleRaf = requestAnimationFrame(tick);
  };

  // Decode section badges once as they scroll into view (language-safe)
  const badgeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const key = el.dataset.i18n;
        const finalText = (key && window.TRANSLATIONS?.[currentLang]?.[key]) || el.textContent.trim();
        scramble(el, finalText, 700);
        badgeObserver.unobserve(el);
      });
    },
    { threshold: 0.6 }
  );
  $$(".sec-head .section-badge, .connect-wrapper > .section-badge").forEach((b) => badgeObserver.observe(b));

  /* ==========================================================================
     2D. TARGETING CURSOR (darknode-style reticle that locks onto targets)
     ========================================================================== */
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const hudCursor = $("#hudCursor");

  if (finePointer && hudCursor && !reduceMotion) {
    document.body.classList.add("has-hud-cursor");

    const dot = $("#hudDot");
    const reticle = $("#hudReticle");
    const label = $("#hudCursorLabel");
    const lineX = $("#hudLineX");
    const lineY = $("#hudLineY");

    const LOCK_SEL = "a, button, label, .chip, .skill-pill, .lang-btn, .social-item";
    const SCAN_SEL = "[data-open-cert], .project-card, .mini-card, .timeline-card, .edu-card, .skill-card, .showcase-card";
    const BASE = 34;

    const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    const ret = { x: mouse.x, y: mouse.y, w: BASE, h: BASE };
    const target = { x: mouse.x, y: mouse.y, w: BASE, h: BASE };
    let lockEl = null;
    let mode = "free"; // free | lock | scan
    let pressed = false;
    let lastLabel = "";

    const pad = (n) => String(Math.max(0, Math.round(n))).padStart(4, "0");

    const setLabel = (text, decode = false) => {
      if (text === lastLabel) return;
      lastLabel = text;
      decode ? scramble(label, text, 320) : (label.textContent = text);
    };

    const labelFor = (el) => {
      const raw = el.getAttribute("aria-label") || el.dataset.certName || el.textContent || "";
      const clean = raw.replace(/\s+/g, " ").trim().toUpperCase();
      return clean.length > 18 ? clean.slice(0, 18) + "…" : clean || "TARGET";
    };

    const setMode = (next) => {
      if (mode === next) return;
      mode = next;
      document.body.classList.toggle("cursor-lock", next === "lock");
      document.body.classList.toggle("cursor-scan", next === "scan");
    };

    window.addEventListener("pointermove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      document.body.classList.add("cursor-visible");

      const lockTarget = e.target.closest?.(LOCK_SEL);
      const scanTarget = !lockTarget && e.target.closest?.(SCAN_SEL);

      if (lockTarget) {
        const r = lockTarget.getBoundingClientRect();
        // Huge links (e.g. whole cards) behave like scan targets instead of wrapping
        if (r.width < 420 && r.height < 160) {
          lockEl = lockTarget;
          setMode("lock");
          setLabel("LOCK // " + labelFor(lockTarget), true);
          return;
        }
      }
      lockEl = null;
      if (scanTarget) {
        setMode("scan");
        setLabel(scanTarget.matches("[data-open-cert]") ? "INSPECT // ZOOM" : "SCAN // " + pad(mouse.x) + ":" + pad(mouse.y));
      } else {
        setMode("free");
        setLabel(`X:${pad(mouse.x)} Y:${pad(mouse.y)}`);
      }
    }, { passive: true });

    document.addEventListener("pointerleave", () => document.body.classList.remove("cursor-visible"));
    document.addEventListener("pointerenter", () => document.body.classList.add("cursor-visible"));
    window.addEventListener("pointerdown", () => { pressed = true; document.body.classList.add("cursor-down"); });
    window.addEventListener("pointerup", () => { pressed = false; document.body.classList.remove("cursor-down"); });

    const lerp = (a, b, t) => a + (b - a) * t;

    const render = () => {
      if (mode === "lock" && lockEl && lockEl.isConnected) {
        const r = lockEl.getBoundingClientRect();
        target.x = r.left + r.width / 2;
        target.y = r.top + r.height / 2;
        target.w = r.width + 14;
        target.h = r.height + 12;
      } else {
        const s = mode === "scan" ? 58 : BASE;
        target.x = mouse.x;
        target.y = mouse.y;
        target.w = s;
        target.h = s;
      }
      const k = pressed ? 0.78 : 1;
      const ease = mode === "lock" ? 0.22 : 0.18;
      ret.x = lerp(ret.x, target.x, ease);
      ret.y = lerp(ret.y, target.y, ease);
      ret.w = lerp(ret.w, target.w * k, 0.2);
      ret.h = lerp(ret.h, target.h * k, 0.2);

      dot.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
      lineX.style.transform = `translate3d(0, ${mouse.y}px, 0)`;
      lineY.style.transform = `translate3d(${mouse.x}px, 0, 0)`;
      reticle.style.width = ret.w + "px";
      reticle.style.height = ret.h + "px";
      reticle.style.transform = `translate3d(${ret.x - ret.w / 2}px, ${ret.y - ret.h / 2}px, 0)`;

      // Label sits at the reticle's bottom-right corner, flipped near viewport edges
      let lx = ret.x + ret.w / 2 + 8;
      let ly = ret.y + ret.h / 2 + 6;
      const lw = label.offsetWidth;
      if (lx + lw > innerWidth - 8) lx = ret.x - ret.w / 2 - lw - 8;
      if (ly + 18 > innerHeight - 8) ly = ret.y - ret.h / 2 - 22;
      label.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;

      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  /* ==========================================================================
     2E. SCROLL-DRIVEN SECTORS (progress, sector rail, watermark, scan sweep, parallax)
     ========================================================================== */
  const SECTORS = [
    { id: "hero", label: "INTRO" },
    { id: "projects", label: "PROJECTS" },
    { id: "experience", label: "EXPERIENCE" },
    { id: "skills", label: "TOOLKIT" },
    { id: "certifications", label: "CREDENTIALS" },
    { id: "connect", label: "CONTACT" },
  ].map((s) => ({ ...s, el: document.getElementById(s.id) })).filter((s) => s.el);

  const progressBar = $("#scrollProgressBar");
  const hudIdx = $("#hudIdx");
  const hudFill = $("#hudFill");
  const hudLabel = $("#hudLabel");
  const hudPct = $("#hudPct");
  const watermark = $("#sectionWatermark");
  const sweep = $("#scanSweep");
  const heroContent = $(".hero__content");
  const heroCard = $("#showcaseCard");
  const heroImg = $(".profile-photo img");
  const gridBg = $(".tactical-grid-bg");
  const heroEl = $("#hero");

  let currentSector = -1;
  let scrollTicking = false;

  const enterSector = (i, silent = false) => {
    if (i === currentSector) return;
    currentSector = i;
    const num = String(i).padStart(2, "0");
    document.body.dataset.sector = SECTORS[i].id;
    if (hudIdx) hudIdx.textContent = num;
    if (hudLabel) scramble(hudLabel, SECTORS[i].label, 450);
    if (watermark) {
      watermark.textContent = num;
      watermark.classList.remove("is-switching");
      void watermark.offsetWidth;
      watermark.classList.add("is-switching");
    }
    if (!silent && sweep && !reduceMotion) {
      sweep.classList.remove("is-active");
      void sweep.offsetWidth;
      sweep.classList.add("is-active");
    }
  };

  const onScrollHud = () => {
    scrollTicking = false;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(y / max, 1) : 0;

    if (progressBar) progressBar.style.transform = `scaleX(${p})`;
    if (hudFill) hudFill.style.transform = `scaleY(${p})`;
    if (hudPct) hudPct.textContent = String(Math.round(p * 100)).padStart(3, "0") + "%";

    // Active sector = last section whose top passed 45% of viewport
    const probe = innerHeight * 0.45;
    let idx = 0;
    SECTORS.forEach((s, i) => { if (s.el.getBoundingClientRect().top <= probe) idx = i; });
    enterSector(idx, currentSector === -1);

    if (reduceMotion) return;

    // Grid drifts slower than content (depth)
    if (gridBg) gridBg.style.backgroundPosition = `0 ${-y * 0.15}px`;

    // Hero exits like a camera pulling away
    const heroH = heroEl ? heroEl.offsetHeight : innerHeight;
    if (y <= 2) {
      if (heroContent) {
        heroContent.style.transform = "";
        heroContent.style.opacity = "";
      }
      if (heroCard) heroCard.style.transform = "";
      if (heroImg) heroImg.style.transform = "";
    } else if (y < heroH) {
      const t = Math.min(Math.max(y / heroH, 0), 1);
      if (heroContent) {
        heroContent.style.transform = `translate3d(0, ${y * 0.24}px, 0)`;
        heroContent.style.opacity = String(Math.max(0, 1 - t * 0.9));
      }
      if (heroCard) heroCard.style.transform = `translate3d(0, ${y * 0.1}px, 0)`;
      if (heroImg) heroImg.style.transform = `scale(${1 + t * 0.1})`;
    }
  };

  const requestHud = () => {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(onScrollHud);
    }
  };
  window.addEventListener("scroll", requestHud, { passive: true });
  window.addEventListener("resize", requestHud, { passive: true });
  onScrollHud();

  /* ==========================================================================
     3. SCROLL-SPY & SCROLLED NAV
     ========================================================================== */
  const nav = $("#nav");
  const onScroll = () => nav?.classList.toggle("is-scrolled", window.scrollY > 15);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const navLinks = $$(".nav__link");
  const navSections = navLinks.map((l) => $(l.getAttribute("href"))).filter(Boolean);
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        navLinks.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === `#${e.target.id}`));
      });
    },
    { rootMargin: "-40% 0px -50% 0px" }
  );
  navSections.forEach((s) => spy.observe(s));

  /* ==========================================================================
     8. MOBILE MENU
     ========================================================================== */
  const toggle = $("#navToggle");
  const mobileMenu = $("#mobileMenu");
  const setMobileMenu = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    mobileMenu.classList.toggle("is-open", open);
    document.body.classList.toggle("is-locked", open);
  };
  toggle?.addEventListener("click", () => setMobileMenu(toggle.getAttribute("aria-expanded") !== "true"));
  $$("a", mobileMenu).forEach((a) => a.addEventListener("click", () => setMobileMenu(false)));

  /* ==========================================================================
     9. REVEAL ON SCROLL
     ========================================================================== */
  const revealer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          revealer.unobserve(e.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );
  $$(".reveal").forEach((el) => revealer.observe(el));

  /* ==========================================================================
     11. MARQUEE DUPLICATION FOR INFINITE LOOP
     ========================================================================== */
  const track = $("#marqueeTrack");
  if (track) {
    [...track.children].forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    });
  }

  /* ==========================================================================
     12. COPY EMAIL & TOAST NOTIFICATION
     ========================================================================== */
  const toast = $("#toast");
  let toastTimer;
  const showToast = (msg) => {
    $("#toastText").textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2400);
  };

  const copyBtn = $("#copyEmail");
  copyBtn?.addEventListener("click", async () => {
    const email = copyBtn.dataset.email || "arsyadgrants@gmail.com";
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: email });
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    const msg = currentLang === "id" ? "Email disalin ke clipboard!" : "Email copied to clipboard!";
    showToast(msg);
  });

  /* ==========================================================================
     13. RESUME MODAL
     ========================================================================== */
  const modal = $("#resumeModal");
  let lastFocus = null;
  const openModal = () => {
    lastFocus = document.activeElement;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    setTimeout(() => $("#resume-close")?.focus(), 50);
  };
  const closeModal = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-locked");
    lastFocus?.focus();
  };
  $$("[data-open-resume]").forEach((b) => b.addEventListener("click", openModal));
  $$("[data-close-resume]").forEach((b) => b.addEventListener("click", closeModal));

  // Show confirmation toast when downloading resume PDF
  $("#resume-download")?.addEventListener("click", () => {
    const msg = currentLang === "id" ? "Mengunduh CV-Arsyad-Grant-Saputro.pdf..." : "Downloading CV-Arsyad-Grant-Saputro.pdf...";
    showToast(msg);
  });

  /* ==========================================================================
     14. CERTIFICATE & EXPERIENCE LIGHTBOX MODAL
     ========================================================================== */
  const certModal = $("#certModal");
  const certModalImg = $("#certModalImg");
  const certModalTitle = $("#certModalTitle");
  const certModalDownload = $("#certModalDownload");

  const openCertModal = (src, title) => {
    if (!certModal || !certModalImg) return;
    const cleanSrc = src.split("?")[0].split("#")[0];
    const cleanFilename = cleanSrc.split("/").pop() || "arsyad-document.jpg";
    certModalImg.src = src;
    if (certModalTitle) certModalTitle.textContent = title || "Pratinjau Dokumen";
    if (certModalDownload) {
      certModalDownload.href = cleanSrc;
      certModalDownload.setAttribute("download", cleanFilename);
    }
    certModal.classList.add("is-open");
    certModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
  };

  const closeCertModal = () => {
    if (!certModal) return;
    certModal.classList.remove("is-open");
    certModal.setAttribute("aria-hidden", "true");
    if (!modal?.classList.contains("is-open")) {
      document.body.classList.remove("is-locked");
    }
  };

  $$("[data-open-cert]").forEach((card) => {
    card.addEventListener("click", () => {
      const src = card.dataset.openCert;
      const title = card.dataset.certName;
      if (src) openCertModal(src, title);
    });
  });

  $("#certModalClose")?.addEventListener("click", closeCertModal);
  $("#certModalBackdrop")?.addEventListener("click", closeCertModal);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (certModal?.classList.contains("is-open")) {
      closeCertModal();
      return;
    }
    if (modal?.classList.contains("is-open")) {
      closeModal();
      return;
    }
    if (mobileMenu?.classList.contains("is-open")) {
      setMobileMenu(false);
    }
  });

  /* ==========================================================================
     15. FOOTER CLOCK (SEMARANG / WIB TIME)
     ========================================================================== */
  const clock = $("#clock");
  if (clock) {
    const fmt = new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta"
    });
    const tickClock = () => (clock.textContent = fmt.format(new Date()).replace(".", ":"));
    tickClock();
    setInterval(tickClock, 30000);
  }
})();
