import "@fontra/core/theme-settings.js";
import { showTooltipsEverywhere } from "@fontra/web-components/armed-tooltip.js";
import { drawScrollbarsEverywhere } from "@fontra/web-components/scrollbars.js";

drawScrollbarsEverywhere();
showTooltipsEverywhere();

import { buildComponentsGallery } from "@fontra/views-components/components.js";

buildComponentsGallery(document.querySelector("#components-gallery"));
