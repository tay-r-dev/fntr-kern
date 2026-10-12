import "@fontra/core/theme-settings.js";
import { showTooltipsEverywhere } from "@fontra/web-components/armed-tooltip.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();
showTooltipsEverywhere();

import { ApplicationSettingsController } from "@fontra/views-applicationsettings/applicationsettings.js";

async function startApp() {
  window.applicationSettingsController = new ApplicationSettingsController();
  await window.applicationSettingsController.start();
}

startApp();
