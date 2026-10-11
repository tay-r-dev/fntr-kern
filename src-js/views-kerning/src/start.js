import "@fontra/core/theme-settings.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();

import { KerningViewController } from "@fontra/views-kerning/kerning.js";

async function startApp() {
  window.kerningViewController = await KerningViewController.fromBackend();
}

startApp();
