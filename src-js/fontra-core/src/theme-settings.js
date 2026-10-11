import { ObservableController } from "./observable-object.ts";

function setupThemeOverride(value) {
  const rootElement = document.querySelector("html");
  rootElement.classList.remove("light-theme");
  rootElement.classList.remove("dark-theme");
  if (value !== "automatic") {
    rootElement.classList.add(value + "-theme");
  }
}

export const themeController = new ObservableController({ theme: "automatic" });

themeController.synchronizeWithLocalStorage("fontra-");

themeController.addKeyListener("theme", (event) => {
  setupThemeOverride(themeController.model.theme);
});

setupThemeOverride(themeController.model.theme);

// One screen pixel in CSS pixels, as --hairline. Page lines are drawn this
// thick, so a zoom does not thicken them. A zoom changes the ratio, so it is
// set again each time the ratio changes.
function setupHairline() {
  const ratio = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty("--hairline", `${1 / ratio}px`);
  matchMedia(`(resolution: ${ratio}dppx)`).addEventListener("change", setupHairline, {
    once: true,
  });
}

setupHairline();
