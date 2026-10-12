import "@fontra/core/theme-settings.js";
import { showTooltipsEverywhere } from "@fontra/web-components/armed-tooltip.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();
showTooltipsEverywhere();

import { FontInfoController } from "@fontra/views-fontinfo/fontinfo.js";

async function startApp() {
  window.fontInfoController = await FontInfoController.fromBackend();
}

startApp();
