import "@fontra/core/theme-settings.js";
import { showTooltipsEverywhere } from "@fontra/web-components/armed-tooltip.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();
showTooltipsEverywhere();

import { KerningViewController } from "@fontra/views-kerning/kerning.js";

async function startApp() {
  window.kerningViewController = await KerningViewController.fromBackend();
}

startApp();
