import "@fontra/core/theme-settings.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();

import { FontOverviewController } from "@fontra/views-fontoverview/fontoverview.js";

async function startApp() {
  window.fontOverviewController = await FontOverviewController.fromBackend();
}

startApp();
