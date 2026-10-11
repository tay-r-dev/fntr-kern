import "@fontra/core/theme-settings.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();

import { ApplicationSettingsController } from "@fontra/views-applicationsettings/applicationsettings.js";

async function startApp() {
  window.applicationSettingsController = new ApplicationSettingsController();
  await window.applicationSettingsController.start();
}

startApp();
