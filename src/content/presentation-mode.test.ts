/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { detectPresentationSlides, createPresentationController } from "./presentation-mode";
import type { ClickDeckLogger } from "../diagnostics/logger";

describe("detectPresentationSlides", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects .slide elements", () => {
    document.body.innerHTML = `
      <div class="slide">1</div>
      <div class="slide">2</div>
      <div class="slide">3</div>
    `;
    const slides = detectPresentationSlides(document.body);
    expect(slides.length).toBe(3);
  });

  it("detects [data-slide] elements", () => {
    document.body.innerHTML = `
      <section data-slide="1">1</section>
      <section data-slide="2">2</section>
    `;
    const slides = detectPresentationSlides(document.body);
    expect(slides.length).toBe(2);
  });

  it("detects .deck > section elements", () => {
    document.body.innerHTML = `
      <div class="deck">
        <section>1</section>
        <section>2</section>
      </div>
    `;
    const slides = detectPresentationSlides(document.body);
    expect(slides.length).toBe(2);
  });

  it("does not return if less than 2 slides found", () => {
    document.body.innerHTML = `<div class="slide">1</div>`;
    const slides = detectPresentationSlides(document.body);
    expect(slides.length).toBe(0);
  });

  it("detects main > section if they are tall enough", () => {
    // Mock innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true });
    
    document.body.innerHTML = `
      <main>
        <section id="s1">1</section>
        <section id="s2">2</section>
      </main>
    `;
    const s1 = document.getElementById("s1")!;
    const s2 = document.getElementById("s2")!;
    Object.defineProperty(s1, 'clientHeight', { value: 800 });
    Object.defineProperty(s2, 'clientHeight', { value: 900 });

    const slides = detectPresentationSlides(document.body);
    expect(slides.length).toBe(2);
  });

  it("does not detect main > section if they are short", () => {
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true });
    
    document.body.innerHTML = `
      <main>
        <section id="s1">1</section>
        <section id="s2">2</section>
      </main>
    `;
    const s1 = document.getElementById("s1")!;
    const s2 = document.getElementById("s2")!;
    Object.defineProperty(s1, 'clientHeight', { value: 500 }); // Below 0.75 * 1000 (750)
    Object.defineProperty(s2, 'clientHeight', { value: 900 });

    const slides = detectPresentationSlides(document.body);
    expect(slides.length).toBe(0); // All must be tall
  });
});

describe("createPresentationController", () => {
  let mockLogger: ClickDeckLogger;
  let hostPlaySlideSpy: ReturnType<typeof vi.fn> | undefined;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as unknown as ClickDeckLogger;
    
    document.body.innerHTML = `
      <div class="slide" id="s1">1</div>
      <div class="slide" id="s2">2</div>
    `;
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = () => {};
    hostPlaySlideSpy = undefined;
  });

  afterEach(() => {
    delete window.__playSlide;
    delete window.__clickdeckSyncPresentationState;
    delete window.Reveal;
    delete window.impress;
  });

  it("adds staging classes and CSS variables on enter, updates on navigation, and cleans up on exit", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    document.body.style.background = "rgb(247, 242, 232)";
    
    // Mock getBoundingClientRect for scale calculation
    slides.forEach((s, idx) => {
      s.getBoundingClientRect = () => ({ width: 800, height: 600, top: idx === 0 ? 0 : 1000 } as any);
    });
    
    Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });

    const controller = createPresentationController({ slides, logger: mockLogger });
    
    await controller.enter();
    
    expect(document.documentElement.classList.contains("clickdeck-presenting")).toBe(true);
    expect(document.body.style.background).toBe("rgb(247, 242, 232)");
    expect(slides[0].classList.contains("clickdeck-presenting-slide")).toBe(true);
    expect(slides[1].classList.contains("clickdeck-presentation-hidden-slide")).toBe(true);
    
    // Math.min(1600/800, 900/600) => min(2, 1.5) => 1.5
    expect(slides[0].style.getPropertyValue("--clickdeck-present-scale")).toBe("1.5");
    
    // Navigate next
    controller.next();
    
    expect(slides[0].classList.contains("clickdeck-presenting-slide")).toBe(false);
    expect(slides[0].classList.contains("clickdeck-presentation-hidden-slide")).toBe(true);
    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);
    expect(slides[1].classList.contains("clickdeck-presentation-hidden-slide")).toBe(false);
    
    // Exit
    controller.exit();
    
    expect(document.documentElement.classList.contains("clickdeck-presenting")).toBe(false);
    expect(slides[1].classList.contains("clickdeck-presentation-hidden-slide")).toBe(false);
    expect(slides[1].style.getPropertyValue("--clickdeck-present-scale")).toBe("");
  });

  it("exits presentation when next is called on the last slide", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    // Go to last slide
    controller.goTo(1);
    expect(document.documentElement.classList.contains("clickdeck-presenting")).toBe(true);

    // Calling next on last slide should exit
    controller.next();
    expect(document.documentElement.classList.contains("clickdeck-presenting")).toBe(false);
  });

  it("temporarily neutralizes transformed deck ancestors during presentation", async () => {
    document.body.innerHTML = `
      <div id="deck" style="transform: translateX(-100vw);">
        <div class="slide" id="s1">1</div>
        <div class="slide" id="s2">2</div>
      </div>
    `;
    const deck = document.getElementById("deck") as HTMLElement;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));

    slides[0].getBoundingClientRect = () => ({ width: 800, height: 600, left: -1000, top: 0, right: -200, bottom: 600 } as any);
    slides[1].getBoundingClientRect = () => ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 } as any);

    const controller = createPresentationController({ slides, logger: mockLogger });

    await controller.enter();

    expect(deck.style.transform).toBe("none");
    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);

    controller.exit();

    expect(deck.getAttribute("style")).toContain("transform: translateX(-100vw)");
  });

  it("triggers host slide hooks and syncs host nav/theme state on navigation", async () => {
    document.body.innerHTML = `
      <div id="nav">
        <button class="dot" data-i="0"></button>
        <button class="dot" data-i="1"></button>
      </div>
      <div class="slide light" id="s1">1</div>
      <div class="slide dark" id="s2">2</div>
    `;

    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide, index) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: index === 0 ? 0 : 1000 } as any);
    });

    hostPlaySlideSpy = vi.fn();
    (window as any).__playSlide = hostPlaySlideSpy;

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    expect(hostPlaySlideSpy).toHaveBeenCalledWith(0);
    expect(document.querySelectorAll("#nav .dot")[0].classList.contains("active")).toBe(true);
    expect(document.body.classList.contains("light-bg")).toBe(true);

    controller.goTo(1);

    expect(hostPlaySlideSpy).toHaveBeenCalledWith(1);
    expect(document.querySelectorAll("#nav .dot")[1].classList.contains("active")).toBe(true);
    expect(document.body.classList.contains("light-bg")).toBe(false);
  });


  it("keeps presenting when the legacy host slide hook throws", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide, index) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: index === 0 ? 0 : 1000 } as any);
    });
    window.__playSlide = vi.fn(() => {
      throw new Error("host failed");
    });

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);

    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith("Could not trigger host slide hook", expect.any(Error));
  });

  it("calls the structured ClickDeck host protocol with direction details", async () => {
    document.body.innerHTML = `
      <div class="slide" id="s1">1</div>
      <div class="slide" id="s2">2</div>
      <div class="slide" id="s3">3</div>
    `;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    const syncSpy = vi.fn();
    window.__clickdeckSyncPresentationState = syncSpy;

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);
    controller.goTo(0);
    controller.goTo(2);

    expect(syncSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      index: 0,
      total: 3,
      slide: slides[0],
      direction: "initial"
    }));
    expect(syncSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ index: 1, direction: "next" }));
    expect(syncSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ index: 0, direction: "previous" }));
    expect(syncSpy).toHaveBeenNthCalledWith(4, expect.objectContaining({ index: 2, direction: "jump" }));
  });

  it("keeps ClickDeck navigation working when the structured host protocol throws", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    window.__clickdeckSyncPresentationState = vi.fn(() => {
      throw new Error("protocol failed");
    });

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);

    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith("Could not trigger ClickDeck presentation sync protocol", expect.any(Error));
  });

  it("dispatches clickdeck:presentationchange with the structured detail", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    const eventSpy = vi.fn();
    document.addEventListener("clickdeck:presentationchange", eventSpy);

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);

    const event = eventSpy.mock.calls.at(-1)?.[0] as CustomEvent;
    expect(event.detail).toEqual(expect.objectContaining({
      index: 1,
      total: 2,
      slide: slides[1],
      direction: "next"
    }));

    document.removeEventListener("clickdeck:presentationchange", eventSpy);
  });

  it("syncs reveal.js through its public slide, sync, and layout APIs", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    window.Reveal = {
      slide: vi.fn(),
      sync: vi.fn(),
      layout: vi.fn()
    };

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);

    expect(window.Reveal.slide).toHaveBeenLastCalledWith(1);
    expect(window.Reveal.sync).toHaveBeenCalled();
    expect(window.Reveal.layout).toHaveBeenCalled();
  });

  it("syncs impress.js by calling goto with the current slide id", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    const goto = vi.fn();
    window.impress = vi.fn(() => ({ goto }));

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);

    expect(goto).toHaveBeenLastCalledWith("s2");
  });

  it("ignores unknown framework-like globals instead of guessing APIs", async () => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    (window as any).Reveal = { next: vi.fn(), prev: vi.fn() };
    (window as any).impress = { goto: vi.fn() };

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();
    controller.goTo(1);

    expect((window as any).Reveal.next).not.toHaveBeenCalled();
    expect((window as any).Reveal.prev).not.toHaveBeenCalled();
    expect((window as any).impress.goto).not.toHaveBeenCalled();
  });

  it("uses host nav dots as clickable presentation controls", async () => {
    document.body.innerHTML = `
      <div id="nav">
        <button class="dot" data-i="0"></button>
        <button class="dot" data-i="1"></button>
      </div>
      <div class="slide" id="s1">1</div>
      <div class="slide" id="s2">2</div>
    `;

    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide, index) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: index === 0 ? 0 : 1000 } as any);
    });

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    const secondDot = document.querySelectorAll<HTMLElement>("#nav .dot")[1];
    secondDot.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);
    expect(slides[0].classList.contains("clickdeck-presentation-hidden-slide")).toBe(true);
    expect(secondDot.classList.contains("active")).toBe(true);
  });

  it("syncs .active and .prev classes on slides", async () => {
    document.body.innerHTML = `
      <div class="slide" id="s1">1</div>
      <div class="slide" id="s2">2</div>
      <div class="slide" id="s3">3</div>
    `;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    expect(slides[0].classList.contains("active")).toBe(true);
    expect(slides[1].classList.contains("active")).toBe(false);
    expect(slides[1].classList.contains("prev")).toBe(false);

    controller.goTo(1);
    expect(slides[0].classList.contains("active")).toBe(false);
    expect(slides[0].classList.contains("prev")).toBe(true);
    expect(slides[1].classList.contains("active")).toBe(true);
    expect(slides[1].classList.contains("prev")).toBe(false);
    expect(slides[2].classList.contains("prev")).toBe(false);

    controller.goTo(2);
    expect(slides[0].classList.contains("prev")).toBe(true);
    expect(slides[1].classList.contains("prev")).toBe(true);
    expect(slides[2].classList.contains("active")).toBe(true);
  });

  it("syncs #currentSlide and #totalSlides counters", async () => {
    document.body.innerHTML = `
      <div id="currentSlide"></div>
      <div id="totalSlides"></div>
      <div class="slide">1</div>
      <div class="slide">2</div>
    `;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });

    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    expect(document.getElementById("currentSlide")?.textContent).toBe("1");
    expect(document.getElementById("totalSlides")?.textContent).toBe("2");

    controller.goTo(1);
    expect(document.getElementById("currentSlide")?.textContent).toBe("2");
  });

  it("does not sync nav dots if dot count does not match slide count", async () => {
    document.body.innerHTML = `
      <div id="nav">
        <button class="dot"></button>
      </div>
      <div class="slide">1</div>
      <div class="slide">2</div>
    `;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    const dot = document.querySelector(".dot")!;
    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    expect(dot.classList.contains("active")).toBe(false);
  });

  it("intercepts wheel events to navigate", async () => {
    document.body.innerHTML = `
      <div class="slide">1</div>
      <div class="slide">2</div>
    `;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    const wheelEvent = new WheelEvent("wheel", { deltaY: 100, bubbles: true });
    vi.spyOn(wheelEvent, 'preventDefault');
    document.dispatchEvent(wheelEvent);

    expect(wheelEvent.preventDefault).toHaveBeenCalled();
    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);
  });

  it("intercepts touch events to navigate", async () => {
    document.body.innerHTML = `
      <div class="slide">1</div>
      <div class="slide">2</div>
    `;
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide) => {
      slide.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0 } as any);
    });
    const controller = createPresentationController({ slides, logger: mockLogger });
    await controller.enter();

    // Mock touches for typescript
    const touchStartEvent = new TouchEvent("touchstart", {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
      bubbles: true
    });
    document.dispatchEvent(touchStartEvent);

    const touchEndEvent = new TouchEvent("touchend", {
      changedTouches: [{ clientX: 100, clientY: 20 } as Touch],
      bubbles: true
    });
    vi.spyOn(touchEndEvent, 'preventDefault');
    document.dispatchEvent(touchEndEvent);

    expect(touchEndEvent.preventDefault).toHaveBeenCalled();
    expect(slides[1].classList.contains("clickdeck-presenting-slide")).toBe(true);
  });
});
