import "@fontra/core/theme-settings.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();

import { EditorController } from "@fontra/views-editor/editor.js";

async function startApp() {
  window.editorController = await EditorController.fromBackend();
}

startApp();
