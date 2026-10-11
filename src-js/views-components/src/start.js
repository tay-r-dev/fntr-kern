import "@fontra/core/theme-settings.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();

import { buildComponentsGallery } from "@fontra/views-components/components.js";

buildComponentsGallery(document.querySelector("#components-gallery"));
