import "@fontra/core/theme-settings.js";

import { KerningViewController } from "@fontra/views-kerning/kerning.js";

async function startApp() {
  window.kerningViewController = await KerningViewController.fromBackend();
}

startApp();
