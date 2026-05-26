// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPanel } from "./panel";

describe("createPanel selection context", () => {
  it("enables image tools for image context", () => {
    const panel = createPanel(() => undefined);
    document.body.appendChild(panel.element);

    panel.setSelectionContext("image");
    panel.setReplaceImageAvailability(true);

    const imageSection = panel.element.querySelector<HTMLElement>("[data-section='image']");
    const replaceButton = panel.element.querySelector<HTMLButtonElement>("[data-action='replace-image']");
    expect(imageSection?.hidden).toBe(false);
    expect(replaceButton?.disabled).toBe(false);

    panel.destroy();
  });

  it("disables image replace for text context", () => {
    const panel = createPanel(() => undefined);
    document.body.appendChild(panel.element);

    panel.setSelectionContext("text");
    panel.setReplaceImageAvailability(true);

    const imageSection = panel.element.querySelector<HTMLElement>("[data-section='image']");
    const replaceButton = panel.element.querySelector<HTMLButtonElement>("[data-action='replace-image']");
    expect(imageSection?.hidden).toBe(true);
    expect(replaceButton?.disabled).toBe(true);

    panel.destroy();
  });

  it("keeps finish and diagnostics visible when no selection", () => {
    const panel = createPanel(() => undefined);
    document.body.appendChild(panel.element);

    panel.setSelectionContext("none");

    const finishSection = panel.element.querySelector<HTMLElement>("[data-section='finish']");
    const diagnosticsSection = panel.element.querySelector<HTMLElement>("[data-section='diagnostics']");
    const typographySection = panel.element.querySelector<HTMLElement>("[data-section='typography']");

    expect(finishSection?.hidden).toBe(false);
    expect(diagnosticsSection?.hidden).toBe(false);
    expect(typographySection?.hidden).toBe(true);

    panel.destroy();
  });
});

