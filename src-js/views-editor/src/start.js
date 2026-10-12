import "@fontra/core/theme-settings.js";
import { showTooltipsEverywhere } from "@fontra/web-components/armed-tooltip.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();
showTooltipsEverywhere();

import { EditorController } from "@fontra/views-editor/editor.js";

async function startApp() {
  window.editorController = await EditorController.fromBackend();
}

startApp();
