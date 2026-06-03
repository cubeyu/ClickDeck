import type { ClickDeckLogger } from "../diagnostics/logger";

export function detectPresentationSlides(root: ParentNode = document): HTMLElement[] {
  // 1. Check for .slide
  let slides = Array.from(root.querySelectorAll<HTMLElement>(".slide"));
  if (slides.length >= 2) return slides;

  // 2. Check for [data-slide]
  slides = Array.from(root.querySelectorAll<HTMLElement>("[data-slide]"));
  if (slides.length >= 2) return slides;

  // 3. Check for [aria-roledescription="slide"]
  slides = Array.from(root.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'));
  if (slides.length >= 2) return slides;

  // 4. Check for .deck > section
  slides = Array.from(root.querySelectorAll<HTMLElement>(".deck > section"));
  if (slides.length >= 2) return slides;

  // 5. Check for main > section (only if they are mostly viewport height)
  const sections = Array.from(root.querySelectorAll<HTMLElement>("main > section"));
  if (sections.length >= 2) {
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 600;
    const threshold = viewportHeight * 0.75; // "接近视口高度"
    const allTall = sections.every((s) => s.clientHeight >= threshold);
    if (allTall) {
      return sections;
    }
  }

  return [];
}

export type PresentationDirection = "next" | "previous" | "jump" | "initial";

export type PresentationSyncDetail = {
  index: number;
  total: number;
  slide: HTMLElement | null;
  direction: PresentationDirection;
};

type RevealLike = {
  slide?: (index: number) => unknown;
  sync?: () => unknown;
  layout?: () => unknown;
};

type ImpressLike = {
  goto?: (target: string | HTMLElement) => unknown;
};

type PresentationHostWindow = Window & {
  __playSlide?: (slideIndex: number) => unknown;
  __clickdeckSyncPresentationState?: (detail: PresentationSyncDetail) => unknown;
  Reveal?: RevealLike;
  impress?: () => ImpressLike;
};

declare global {
  interface Window {
    __playSlide?: (slideIndex: number) => unknown;
    __clickdeckSyncPresentationState?: (detail: PresentationSyncDetail) => unknown;
    Reveal?: RevealLike;
    impress?: () => ImpressLike;
  }
}

export function syncPresentationHostState(options: {
  slides: HTMLElement[];
  index: number;
  direction: PresentationDirection;
  logger: ClickDeckLogger;
}): PresentationSyncDetail {
  const { slides, index, direction, logger } = options;
  const slide = slides[index] ?? null;
  const detail: PresentationSyncDetail = { index, total: slides.length, slide, direction };

  syncCommonSlideState(slides, index);
  syncHostNavState(slides, index);
  syncCounters(slides, index);
  syncHostThemeState(slides, index);
  triggerLegacyHostSlideHook(index, logger);
  syncKnownPresentationFrameworks(slide, index, logger);
  triggerClickDeckHostProtocol(detail, logger);
  dispatchPresentationChange(detail, logger);

  return detail;
}

function getHostNavDots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#nav .dot, .nav-dot, .nav-dots .nav-dot"));
}

function syncHostNavState(slides: HTMLElement[], index: number): void {
  const dots = getHostNavDots();
  if (dots.length !== slides.length) {
    return;
  }

  dots.forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === index);
    if (dotIndex === index) {
      dot.setAttribute("aria-current", "true");
    } else {
      dot.removeAttribute("aria-current");
    }
  });
}

function syncCommonSlideState(slides: HTMLElement[], index: number): void {
  slides.forEach((slide, slideIndex) => {
    if (slideIndex === index) {
      slide.classList.add("active");
      slide.classList.remove("prev");
    } else if (slideIndex < index) {
      slide.classList.remove("active");
      slide.classList.add("prev");
    } else {
      slide.classList.remove("active");
      slide.classList.remove("prev");
    }
  });
}

function syncCounters(slides: HTMLElement[], index: number): void {
  const currentSlideEl = document.getElementById("currentSlide");
  const totalSlidesEl = document.getElementById("totalSlides");

  if (currentSlideEl) {
    currentSlideEl.textContent = String(index + 1);
  }
  if (totalSlidesEl) {
    totalSlidesEl.textContent = String(slides.length);
  }
}

function syncHostThemeState(slides: HTMLElement[], index: number): void {
  const slide = slides[index];
  if (!slide) {
    return;
  }

  const theme =
    slide.dataset.theme ||
    (slide.classList.contains("light") ? "light" : slide.classList.contains("dark") ? "dark" : "");

  if (theme) {
    document.body.classList.toggle("light-bg", theme === "light");
  }
}

function triggerLegacyHostSlideHook(index: number, logger: ClickDeckLogger): void {
  const hostWindow = window as PresentationHostWindow;
  if (typeof hostWindow.__playSlide !== "function") {
    return;
  }

  try {
    hostWindow.__playSlide(index);
  } catch (error) {
    logger.warn("Could not trigger host slide hook", error);
  }
}

function syncKnownPresentationFrameworks(slide: HTMLElement | null, index: number, logger: ClickDeckLogger): void {
  const hostWindow = window as PresentationHostWindow;
  const reveal = hostWindow.Reveal;
  if (reveal && typeof reveal.slide === "function") {
    try {
      reveal.slide(index);
      if (typeof reveal.sync === "function") {
        reveal.sync();
      }
      if (typeof reveal.layout === "function") {
        reveal.layout();
      }
    } catch (error) {
      logger.warn("Could not sync reveal.js presentation state", error);
    }
  }

  if (slide?.id && typeof hostWindow.impress === "function") {
    try {
      const impressApi = hostWindow.impress();
      if (typeof impressApi?.goto === "function") {
        impressApi.goto(slide.id);
      }
    } catch (error) {
      logger.warn("Could not sync impress.js presentation state", error);
    }
  }
}

function triggerClickDeckHostProtocol(detail: PresentationSyncDetail, logger: ClickDeckLogger): void {
  const hostWindow = window as PresentationHostWindow;
  if (typeof hostWindow.__clickdeckSyncPresentationState !== "function") {
    return;
  }

  try {
    hostWindow.__clickdeckSyncPresentationState(detail);
  } catch (error) {
    logger.warn("Could not trigger ClickDeck presentation sync protocol", error);
  }
}

function dispatchPresentationChange(detail: PresentationSyncDetail, logger: ClickDeckLogger): void {
  try {
    document.dispatchEvent(new CustomEvent("clickdeck:presentationchange", { detail }));
  } catch (error) {
    logger.warn("Could not dispatch presentation change event", error);
  }
}

function getPresentationDirection(options: {
  from: number;
  to: number;
  initial: boolean;
  requested?: PresentationDirection;
}): PresentationDirection {
  const { from, to, initial, requested } = options;
  if (requested) {
    return requested;
  }
  if (initial) {
    return "initial";
  }
  if (Math.abs(to - from) > 1) {
    return "jump";
  }
  if (to > from) {
    return "next";
  }
  if (to < from) {
    return "previous";
  }
  return "jump";
}

export type PresentationController = {
  enter: () => Promise<void>;
  exit: () => void;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
  destroy: () => void;
};

export function createPresentationController(options: {
  slides: HTMLElement[];
  logger: ClickDeckLogger;
}): PresentationController {
  const { slides, logger } = options;
  let currentIndex = 0;
  let isPresenting = false;
  let originalScrollY = 0;
  let hasSyncedInitialState = false;

  let originalDimensions: { width: number; height: number }[] = [];
  let transformedAncestorStates: Array<{ element: HTMLElement; style: string | null }> = [];

  function notifyHostPresentationChange(index: number, direction: PresentationDirection): void {
    syncPresentationHostState({ slides, index, direction, logger });
  }

  function updateSlideVisibility() {
    slides.forEach((slide, index) => {
      if (index === currentIndex) {
        slide.classList.remove("clickdeck-presentation-hidden-slide");
        slide.classList.add("clickdeck-presenting-slide");
        
        // Calculate proportional scale to fit within viewport
        const dim = originalDimensions[index];
        if (dim) {
          const scale = Math.min(window.innerWidth / dim.width, window.innerHeight / dim.height);
          slide.style.setProperty("--clickdeck-present-scale", String(scale));
        }
      } else {
        slide.classList.remove("clickdeck-presenting-slide");
        slide.classList.add("clickdeck-presentation-hidden-slide");
        slide.style.removeProperty("--clickdeck-present-scale");
      }
    });
  }

  function goTo(index: number, requestedDirection?: PresentationDirection) {
    if (!isPresenting || slides.length === 0) return;
    if (index < 0) index = 0;
    if (index >= slides.length) index = slides.length - 1;

    const previousIndex = currentIndex;
    currentIndex = index;
    const direction = getPresentationDirection({
      from: previousIndex,
      to: currentIndex,
      initial: !hasSyncedInitialState,
      requested: requestedDirection
    });

    // We don't scroll anymore because position is fixed, but let's keep it in sync logically
    // if needed for exit
    updateSlideVisibility();
    notifyHostPresentationChange(currentIndex, direction);
    hasSyncedInitialState = true;
  }

  function next() {
    if (currentIndex < slides.length - 1) {
      goTo(currentIndex + 1);
    } else {
      exit();
    }
  }

  function previous() {
    if (currentIndex > 0) {
      goTo(currentIndex - 1);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!isPresenting) return;
    
    // Ignore events from input fields
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) {
      return;
    }

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
        e.preventDefault();
        e.stopPropagation(); // Prevent page's own scroll logic from running twice
        next();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        e.preventDefault();
        e.stopPropagation();
        previous();
        break;
      case "Home":
        e.preventDefault();
        e.stopPropagation();
        goTo(0, currentIndex === 0 ? "jump" : undefined);
        break;
      case "End":
        e.preventDefault();
        e.stopPropagation();
        goTo(slides.length - 1, slides.length > 2 ? "jump" : undefined);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        exit();
        break;
    }
  }

  function onDocumentClick(e: MouseEvent) {
    if (!isPresenting) return;

    const target = e.target as HTMLElement | null;
    const dot = target?.closest<HTMLElement>("#nav .dot, .nav-dot");
    if (!dot) {
      return;
    }

    const dots = getHostNavDots();
    if (dots.length !== slides.length) {
      return;
    }

    const explicitIndexStr = dot.dataset.i || dot.dataset.index;
    const explicitIndex = explicitIndexStr ? Number.parseInt(explicitIndexStr, 10) : Number.NaN;
    const nextIndex = Number.isFinite(explicitIndex) ? explicitIndex : dots.indexOf(dot);
    if (nextIndex < 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    goTo(nextIndex, Math.abs(nextIndex - currentIndex) > 1 ? "jump" : undefined);
  }

  let wheelTimeout: number | null = null;
  function onWheel(e: WheelEvent) {
    if (!isPresenting) return;
    
    e.preventDefault();
    e.stopPropagation();

    if (wheelTimeout) return;
    wheelTimeout = window.setTimeout(() => {
      wheelTimeout = null;
    }, 250);

    if (e.deltaY + e.deltaX > 0) {
      next();
    } else if (e.deltaY + e.deltaX < 0) {
      previous();
    }
  }

  let touchStartX = 0;
  let touchStartY = 0;

  function onTouchStart(e: TouchEvent) {
    if (!isPresenting || e.touches.length === 0) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }

  function onTouchEnd(e: TouchEvent) {
    if (!isPresenting || e.changedTouches.length === 0) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    if (Math.abs(deltaX) > 50 || Math.abs(deltaY) > 50) {
      e.preventDefault();
      e.stopPropagation();
      
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) next();
        else previous();
      } else {
        if (deltaY < 0) next();
        else previous();
      }
    }
  }

  // Also handle fullscreen change to exit presentation if user presses Esc to exit fullscreen
  function onFullscreenChange() {
    if (isPresenting && !document.fullscreenElement) {
      // User exited fullscreen via browser native UI or Esc
      exit();
    }
  }

  async function enter() {
    if (isPresenting) return;
    if (slides.length === 0) return;

    isPresenting = true;
    hasSyncedInitialState = false;
    originalScrollY = window.scrollY;

    // Determine current slide based on scroll position
    let bestIndex = 0;
    let minDistance = Infinity;
    slides.forEach((slide, index) => {
      const rect = slide.getBoundingClientRect();
      const distance = Math.abs(rect.top) + Math.abs(rect.left);
      if (distance < minDistance) {
        minDistance = distance;
        bestIndex = index;
      }
    });
    currentIndex = bestIndex;

    // Capture original dimensions before any staging classes are applied
    originalDimensions = slides.map(slide => {
      const rect = slide.getBoundingClientRect();
      return {
        width: rect.width || window.innerWidth,
        height: rect.height || window.innerHeight
      };
    });
    transformedAncestorStates = collectTransformedAncestors(slides);

    document.documentElement.classList.add("clickdeck-presenting");
    neutralizeTransformedAncestors(transformedAncestorStates);
    
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("click", onDocumentClick, { capture: true });
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("fullscreenchange", onFullscreenChange);

    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      logger.warn("Could not request fullscreen", err);
    }

    goTo(currentIndex, "initial");
    logger.info("Entered presentation mode", { slideCount: slides.length });
  }

  function exit() {
    if (!isPresenting) return;
    isPresenting = false;

    document.documentElement.classList.remove("clickdeck-presenting");
    restoreTransformedAncestors(transformedAncestorStates);
    transformedAncestorStates = [];
    slides.forEach(slide => {
      slide.classList.remove("clickdeck-presenting-slide");
      slide.classList.remove("clickdeck-presentation-hidden-slide");
      slide.style.removeProperty("--clickdeck-present-scale");
    });
    
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("click", onDocumentClick, { capture: true });
    document.removeEventListener("wheel", onWheel, { capture: true });
    document.removeEventListener("touchstart", onTouchStart, { capture: true });
    document.removeEventListener("touchend", onTouchEnd, { capture: true });
    document.removeEventListener("fullscreenchange", onFullscreenChange);

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(err => {
        logger.warn("Could not exit fullscreen", err);
      });
    }

    window.scrollTo({ top: originalScrollY, behavior: "auto" });
    logger.info("Exited presentation mode");
  }

  function destroy() {
    exit();
  }

  return { enter, exit, next, previous, goTo, destroy };
}

function collectTransformedAncestors(slides: HTMLElement[]): Array<{ element: HTMLElement; style: string | null }> {
  const states = new Map<HTMLElement, string | null>();

  for (const slide of slides) {
    let current = slide.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      const computed = window.getComputedStyle(current);
      const createsFixedContainingBlock =
        computed.transform !== "none" ||
        computed.perspective !== "none" ||
        computed.filter !== "none";

      if (createsFixedContainingBlock && !states.has(current)) {
        states.set(current, current.getAttribute("style"));
      }

      current = current.parentElement;
    }
  }

  return Array.from(states.entries()).map(([element, style]) => ({ element, style }));
}

function neutralizeTransformedAncestors(states: Array<{ element: HTMLElement; style: string | null }>): void {
  for (const { element } of states) {
    element.style.transform = "none";
    element.style.perspective = "none";
    element.style.filter = "none";
  }
}

function restoreTransformedAncestors(states: Array<{ element: HTMLElement; style: string | null }>): void {
  for (const { element, style } of states) {
    if (style === null) {
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", style);
    }
  }
}
