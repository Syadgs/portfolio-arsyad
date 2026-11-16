/* ==========================================================================
   Cinematic Scene Director
   Fullscreen, layered "scene" navigation (Cappen / Alche Studio style).

   - Every section becomes a fullscreen layer stacked inside <main>.
   - GSAP Observer listens to wheel + touch; one gesture = one scene change.
   - Input is locked while a transition timeline is running (no double-skip).
   - Long scenes scroll internally first; the jump only fires once the
     visitor starts a NEW gesture while already resting on the scene edge.
   - Keyboard (arrows / PageUp / PageDown / Space / Home / End), in-page
     anchors (#projects ...), deep links and a clickable pager all route
     through the same goTo() engine.

   Requires: gsap.min.js + Observer.min.js (vendored in js/vendor/).
   Exposes:  window.createSceneDirector(options) -> director | null
   ========================================================================== */
(() => {
  "use strict";

  const EDGE_PX = 2; // px tolerance when testing whether a scene rests on an edge
  const WHEEL_GESTURE_GAP = 200; // ms of wheel silence that separates two gestures
  const pad2 = (n) => String(n).padStart(2, "0");

  function createSceneDirector(options = {}) {
    const { gsap, Observer } = window;
    const scenes = (options.scenes || []).filter(Boolean);
    if (!gsap || !Observer || scenes.length < 2) return null;
    gsap.registerPlugin(Observer);

    const labels = options.labels || scenes.map((_, i) => `SCENE ${pad2(i + 1)}`);
    const reduceMotion = !!options.reduceMotion;
    const isBlocked = options.isBlocked || (() => false);
    const onChange = options.onChange || (() => {});
    const onScroll = options.onScroll || (() => {});
    const focusOffset = options.focusOffset || (() => 0);
    const revealSelector = options.revealSelector || ".reveal";
    const revealClass = options.revealClass || "is-in";
    const stage = scenes[0].parentElement;
    const root = document.documentElement;

    let index = 0;
    let animating = false;
    let wheelGestureEdge = null; // edge state captured when the current wheel gesture began
    let touchGestureEdge = null; // edge state captured on touchstart
    let lastWheelAt = 0;
    let edgeHitAt = 0;
    let wasAtTop = true;
    let wasAtBottom = true;

    /* ---------- Stage setup ---------- */
    root.classList.add("is-cinematic");
    scenes.forEach((scene, i) => {
      scene.classList.add("scene");
      scene.dataset.sceneIndex = String(i);
    });

    // Dark curtain that rides under the incoming scene, and the HUD scan line on its edge
    const veil = document.createElement("div");
    veil.className = "scene-veil";
    veil.setAttribute("aria-hidden", "true");
    const scan = document.createElement("div");
    scan.className = "scene-scan";
    scan.setAttribute("aria-hidden", "true");
    scan.innerHTML = '<span class="scene-scan__label"></span>';
    stage.append(veil, scan);
    const scanLabel = scan.firstElementChild;

    /* ---------- Pager (01 / 07 + clickable dots + inner-scroll meter) ---------- */
    const pager = document.createElement("nav");
    pager.className = "scene-pager";
    pager.setAttribute("aria-label", options.pagerLabel || "Scene navigation");
    pager.innerHTML = `
      <div class="scene-pager__count" aria-hidden="true">
        <b class="scene-pager__current">01</b><span>/</span><span>${pad2(scenes.length)}</span>
      </div>
      <ol class="scene-pager__list">
        ${labels
          .map(
            (label, i) => `
          <li>
            <button type="button" class="scene-pager__dot" data-scene-target="${i}" aria-label="${pad2(i + 1)} — ${label}">
              <span class="scene-pager__label">${pad2(i + 1)} // ${label}</span>
            </button>
          </li>`
          )
          .join("")}
      </ol>
      <div class="scene-pager__progress" aria-hidden="true"><span></span></div>`;
    document.body.appendChild(pager);
    const pagerCurrent = pager.querySelector(".scene-pager__current");
    const pagerDots = [...pager.querySelectorAll(".scene-pager__dot")];
    const pagerFill = pager.querySelector(".scene-pager__progress span");

    pager.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-scene-target]");
      if (btn) goTo(Number(btn.dataset.sceneTarget));
    });

    /* ---------- Helpers ---------- */
    const current = () => scenes[index];

    const edgeOf = (scene) => {
      const max = scene.scrollHeight - scene.clientHeight;
      return { top: scene.scrollTop <= EDGE_PX, bottom: scene.scrollTop >= max - EDGE_PX };
    };

    const innerProgress = (scene) => {
      const max = scene.scrollHeight - scene.clientHeight;
      return max > EDGE_PX ? Math.min(scene.scrollTop / max, 1) : 0;
    };

    const offsetWithin = (scene, el) => {
      if (!el || el === scene) return 0;
      const top =
        el.getBoundingClientRect().top - scene.getBoundingClientRect().top + scene.scrollTop - focusOffset();
      return Math.max(0, top);
    };

    const updatePager = () => {
      pagerCurrent.textContent = pad2(index + 1);
      pagerDots.forEach((dot, i) => {
        const on = i === index;
        dot.classList.toggle("is-active", on);
        if (on) dot.setAttribute("aria-current", "step");
        else dot.removeAttribute("aria-current");
      });
    };

    const updateInner = () => {
      const scene = current();
      const edge = edgeOf(scene);
      if ((edge.top && !wasAtTop) || (edge.bottom && !wasAtBottom)) {
        edgeHitAt = performance.now();
      }
      wasAtTop = edge.top;
      wasAtBottom = edge.bottom;
      pagerFill.style.transform = `scaleY(${innerProgress(scene)})`;
      pager.classList.toggle("has-overflow", scene.scrollHeight - scene.clientHeight > EDGE_PX);
    };

    // Re-play the existing CSS reveal animations for whatever is visible in the incoming scene
    const visibleReveals = (scene) => {
      const vh = window.innerHeight;
      return [...scene.querySelectorAll(revealSelector)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < vh;
      });
    };
    const hideReveals = (els) => {
      els.forEach((el) => {
        el.classList.add("reveal--reset");
        el.classList.remove(revealClass);
      });
      void stage.offsetWidth; // commit the hidden state without transitions
      els.forEach((el) => el.classList.remove("reveal--reset"));
    };
    const showReveals = (els) => els.forEach((el) => el.classList.add(revealClass));

    /* ---------- Core transition ---------- */
    function goTo(target, opts = {}) {
      target = gsap.utils.clamp(0, scenes.length - 1, Math.round(target));
      if (animating || target === index) return false;

      const dir = target > index ? 1 : -1;
      const prevIndex = index;
      const prev = scenes[prevIndex];
      const next = scenes[target];
      const content = [...next.children];
      animating = true;
      root.classList.add("is-scene-transitioning");

      // Decide where the incoming scene lands before it becomes visible
      if (typeof opts.offset === "number") next.scrollTop = opts.offset;
      else next.scrollTop = opts.landAt === "end" ? next.scrollHeight : 0;

      index = target;
      updatePager();
      updateInner();
      onChange(index, prevIndex, dir);

      const reveals = visibleReveals(next);
      hideReveals(reveals);
      scanLabel.textContent = `SEC ${pad2(target + 1)} // ${labels[target]}`;

      gsap.set(prev, { zIndex: 1 });
      next.classList.add("is-active");

      const finish = () => {
        prev.classList.remove("is-active");
        gsap.set(prev, { clearProps: "transform,opacity,zIndex" });
        gsap.set(next, { clearProps: "clipPath,opacity" });
        gsap.set(content, { clearProps: "transform" });
        gsap.set(veil, { autoAlpha: 0, clearProps: "clipPath" });
        gsap.set(scan, { autoAlpha: 0 });
        animating = false;
        wheelGestureEdge = null; // momentum from the old gesture can never trigger another jump
        touchGestureEdge = null;
        root.classList.remove("is-scene-transitioning");
        updateInner();
        onScroll();
        options.onSettled?.(index, prevIndex);
      };

      if (reduceMotion) {
        gsap
          .timeline({ onComplete: finish })
          .fromTo(next, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, 0)
          .to(prev, { opacity: 0, duration: 0.3, ease: "power1.out" }, 0)
          .call(() => showReveals(reveals), null, 0.05);
        return true;
      }

      const vh = window.innerHeight;
      // Forward: reveal grows from the bottom edge. Backward: from the top edge.
      const clipFrom = dir > 0 ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 100% 0%)";
      const clipTo = "inset(0% 0% 0% 0%)";

      gsap
        .timeline({ defaults: { ease: "power3.inOut" }, onComplete: finish })
        .set(next, { clipPath: clipFrom }, 0)
        .set(veil, { clipPath: clipFrom, autoAlpha: 1 }, 0)
        .set(scan, { y: dir > 0 ? vh : 0, autoAlpha: 1 }, 0)
        // Old scene: camera pulls back — scale down, drift, dim
        .to(prev, { scale: 0.92, yPercent: -5 * dir, opacity: 0.12, duration: 1.05 }, 0)
        // New scene + curtain: clip-path wipe with a HUD scan line on the leading edge
        .to([next, veil], { clipPath: clipTo, duration: 1 }, 0.06)
        .to(scan, { y: dir > 0 ? 0 : vh, duration: 1 }, 0.06)
        // New scene content slides into place with a slight stagger
        .fromTo(content, { y: 90 * dir }, { y: 0, duration: 0.95, ease: "power3.out", stagger: 0.06 }, 0.28)
        .call(() => showReveals(reveals), null, 0.4)
        .to(scan, { autoAlpha: 0, duration: 0.2, ease: "power1.out" }, 0.98)
        // Curtain fades away so the background video shows through again
        .to(veil, { autoAlpha: 0, duration: 0.35, ease: "power2.out" }, 1);

      return true;
    }

    function navigateTo(el) {
      const scene = el && el.closest(".scene");
      const target = scenes.indexOf(scene);
      if (target < 0) return false;
      const offset = offsetWithin(scene, el);
      if (target === index) {
        scene.scrollTo({ top: offset, behavior: reduceMotion ? "auto" : "smooth" });
        return true;
      }
      return goTo(target, { offset });
    }

    /* ---------- Gesture input (GSAP Observer) ---------- */
    // Native listener runs before Observer's debounced callbacks: it marks the start of
    // each wheel gesture and records whether the scene was already resting on an edge.
    window.addEventListener(
      "wheel",
      () => {
        const now = performance.now();
        if (!animating) {
          const edge = edgeOf(current());
          const settledAtEdge = (edge.top || edge.bottom) && now - edgeHitAt > 140;
          if (now - lastWheelAt > WHEEL_GESTURE_GAP || settledAtEdge) {
            wheelGestureEdge = edge;
          }
        }
        lastWheelAt = now;
      },
      { passive: true, capture: true }
    );

    const intent = (dir, self) => {
      if (animating || isBlocked()) return;
      const target = index + dir;
      if (target < 0 || target >= scenes.length) return;
      const isWheel = !!self.event && self.event.type === "wheel";
      const startEdge = isWheel ? wheelGestureEdge : touchGestureEdge;
      const nowEdge = edgeOf(current());
      const ready = dir > 0 ? startEdge?.bottom && nowEdge.bottom : startEdge?.top && nowEdge.top;
      if (!ready) return; // let the scene scroll natively first
      goTo(target, { landAt: dir > 0 ? "start" : "end" });
    };

    const observer = Observer.create({
      target: window,
      type: "wheel,touch",
      wheelSpeed: -1, // wheel-down and finger-swipe-up both map to onUp -> next scene
      tolerance: 10,
      preventDefault: false, // keep native inner scrolling for long scenes
      ignore: options.ignore,
      onPress: () => {
        if (!animating) touchGestureEdge = edgeOf(current());
      },
      onUp: (self) => intent(1, self),
      onDown: (self) => intent(-1, self),
    });

    /* ---------- Keyboard ---------- */
    window.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isBlocked()) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        goTo(e.key === "Home" ? 0 : scenes.length - 1);
        return;
      }

      let dir = 0;
      if (e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) dir = 1;
      else if (e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) dir = -1;
      if (!dir) return;
      if (e.key === " " && t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName)) return;

      e.preventDefault();
      if (animating) return;

      const scene = current();
      const edge = edgeOf(scene);
      if (!(dir > 0 ? edge.bottom : edge.top)) {
        const step = e.key.startsWith("Arrow") ? 140 : scene.clientHeight * 0.85;
        scene.scrollBy({ top: step * dir, behavior: reduceMotion ? "auto" : "smooth" });
        return;
      }
      if (e.repeat) return;
      goTo(index + dir, { landAt: dir > 0 ? "start" : "end" });
    });

    /* ---------- In-page anchors & deep links ---------- */
    const sceneTargetFromHash = (hash) => {
      const id = decodeURIComponent((hash || "").replace(/^#/, ""));
      const el = id && document.getElementById(id);
      return el && el.closest(".scene") ? el : null;
    };

    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;
      const el = sceneTargetFromHash(link.getAttribute("href"));
      if (!el) return;
      e.preventDefault();
      navigateTo(el);
      history.replaceState?.(null, "", `#${el.id}`);
    });

    window.addEventListener("hashchange", () => {
      const el = sceneTargetFromHash(location.hash);
      if (el) navigateTo(el);
    });

    /* ---------- Inner scroll & resize ---------- */
    scenes.forEach((scene) =>
      scene.addEventListener(
        "scroll",
        () => {
          if (scene !== current() || animating) return;
          updateInner();
          onScroll();
        },
        { passive: true }
      )
    );
    window.addEventListener(
      "resize",
      () => {
        updateInner();
        onScroll();
      },
      { passive: true }
    );

    /* ---------- Initial state (honours #hash deep links) ---------- */
    const initialEl = sceneTargetFromHash(location.hash);
    index = initialEl ? scenes.indexOf(initialEl.closest(".scene")) : 0;
    scenes[index].classList.add("is-active");
    if (initialEl) scenes[index].scrollTop = offsetWithin(scenes[index], initialEl);
    updatePager();
    updateInner();
    queueMicrotask(() => {
      onChange(index, -1, 0);
      onScroll();
    });

    return {
      goTo,
      navigateTo,
      next: () => goTo(index + 1, { landAt: "start" }),
      prev: () => goTo(index - 1, { landAt: "end" }),
      current,
      isAnimating: () => animating,
      metrics: () => ({ index, count: scenes.length, inner: innerProgress(current()) }),
      get index() {
        return index;
      },
      get count() {
        return scenes.length;
      },
      observer,
      pager,
    };
  }

  window.createSceneDirector = createSceneDirector;
})();
