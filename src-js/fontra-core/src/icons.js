// The one place icon files are chosen. Components and call sites name an icon
// (`iconPath("refresh")`, or just `src: "refresh"`); to swap an icon, change its
// line here. "/images/..." is the design-system set, "/tabler-icons/..." the
// stock Tabler library.

export const ICONS = Object.freeze({
  // Actions
  "add": "/images/plus.svg",
  "remove": "/images/minus.svg",
  "update": "/images/update.svg",
  "refresh": "/images/refresh.svg",
  "lock": "/images/lock.svg",
  "unlock": "/images/lock-open.svg",
  "delete": "/images/bin.svg",
  "close": "/images/cross.svg",
  "help": "/images/question.svg",
  "overflow": "/images/overflow.svg",
  "chevron-down": "/images/chevron-down.svg",
  "scrub": "/images/scrub.svg",
  "info": "/images/info.svg",
  "sliders": "/images/sliders.svg",
  "reference": "/images/reference.svg",
  "search": "/images/magnifyingglass.svg",
  "text-tool": "/images/texttool.svg",
  "text-align-left": "/images/alignleft.svg",
  "text-align-center": "/images/aligncenter.svg",
  "text-align-right": "/images/alignright.svg",

  // Skeleton and measure
  "measure-distance": "/images/measure-distance.svg",
  "skeleton-pen": "/images/skeleton-pen.svg",
  "lock-handle": "/images/lock-handle.svg",
  "lock-shift": "/images/lock-shift.svg",
  "lock-width": "/images/lock-width.svg",
  "tie": "/images/tie.svg",
  "detach": "/images/detach.svg",
  "reset-handle": "/images/reset-handle.svg",
  "reset-shift": "/images/reset-shift.svg",
  "reset-all": "/images/reset-all.svg",

  // Canvas plaques
  "plaque-distance": "/images/plaque-distance.svg",
  "plaque-curvature": "/images/plaque-curvature.svg",
  "plaque-angle": "/images/plaque-angle.svg",
  "plaque-shift": "/images/plaque-shift.svg",

  // Tools
  "tool-pointer": "/images/tool-panel-pointer.svg",
  "tool-pointer-add-quad": "/images/pointeraddquad.svg",
  "tool-pointer-scale": "/images/pointerscale.svg",
  "tool-hand": "/images/tool-panel-hand.svg",
  "tool-knife": "/images/tool-panel-knife.svg",
  "tool-marker": "/images/tool-panel-marker.svg",
  "tool-spacing": "/images/tool-panel-spacing.svg",
  "tool-kerning": "/images/tool-panel-kerning.svg",
  "tool-pen": "/images/tool-panel-pen.svg",
  "tool-ruler": "/images/tool-panel-ruler.svg",
  "tool-ribbon-pen": "/images/tool-panel-ribbon-pen.svg",
  "tool-rectangle": "/images/tool-panel-add-primitive-rectangle.svg",
  "tool-circle": "/images/tool-panel-add-primitive-circle.svg",
  "zoom-out": "/images/tool-panel-minus.svg",
  "zoom-in": "/images/tool-panel-plus.svg",
  "center-glyph": "/images/tool-panel-center-glyph.svg",
  "full-screen": "/images/tool-panel-full-screen-mode.svg",

  // Transform panel
  "transform-origin": "/images/transform-panel-origin.svg",
  "transform-move": "/images/transform-panel-move.svg",
  "transform-scale": "/images/transform-panel-scale.svg",
  "transform-rotate": "/images/transform-panel-rotate.svg",
  "transform-skew": "/images/transform-panel-skew.svg",
  "transform-dimension": "/images/transform-panel-dimension.svg",
  "flip-vertical": "/images/transform-pane-lflip-vertical.svg",
  "flip-horizontal": "/images/transform-pane-lflip-horizontal.svg",
  "distribute-horizontally": "/images/transform-pane-ldistribute-horizontally.svg",
  "distribute-vertically": "/images/transform-pane-ldistribute-vertically.svg",
  "align-left": "/images/transform-panel-align-left.svg",
  "align-horizontally": "/images/transform-panel-align-horizontally.svg",
  "align-right": "/images/transform-panel-alight-right.svg",
  "align-top": "/images/transform-panel-align-top.svg",
  "align-vertically": "/images/transform-panel-align-vertically.svg",
  "align-bottom": "/images/transform-panel-align-bottom.svg",
  "subtract": "/images/subtract.svg",
  "intersect": "/images/intersect.svg",
  "exclude": "/images/exclude.svg",
  "union": "/images/union.svg",
  "simplify": "/images/simplify.svg",
  "balance": "/images/balance.svg",

  // Tabler
  "alert-circle": "/tabler-icons/alert-circle.svg",
  "alert-triangle": "/tabler-icons/alert-triangle.svg",
  "antenna-bars-1": "/tabler-icons/antenna-bars-1.svg",
  "antenna-bars-2": "/tabler-icons/antenna-bars-2.svg",
  "antenna-bars-3": "/tabler-icons/antenna-bars-3.svg",
  "antenna-bars-4": "/tabler-icons/antenna-bars-4.svg",
  "antenna-bars-5": "/tabler-icons/antenna-bars-5.svg",
  "arrow-big-right": "/tabler-icons/arrow-big-right.svg",
  "arrows-horizontal": "/tabler-icons/arrows-horizontal.svg",
  "binary-tree-2": "/tabler-icons/binary-tree-2.svg",
  "bone": "/tabler-icons/bone.svg",
  "bug": "/tabler-icons/bug.svg",
  "check": "/tabler-icons/check.svg",
  "chevron-right": "/tabler-icons/chevron-right.svg",
  "chevron-up": "/tabler-icons/chevron-up.svg",
  "circle-dot": "/tabler-icons/circle-dot.svg",
  "circle-dotted": "/tabler-icons/circle-dotted.svg",
  "columns": "/tabler-icons/columns.svg",
  "eye": "/tabler-icons/eye.svg",
  "eye-closed": "/tabler-icons/eye-closed.svg",
  "focus-2": "/tabler-icons/focus-2.svg",
  "layers-union": "/tabler-icons/layers-union.svg",
  "link": "/tabler-icons/link.svg",
  "link-plus": "/tabler-icons/link-plus.svg",
  "loader-2": "/tabler-icons/loader-2.svg",
  "menu-2": "/tabler-icons/menu-2.svg",
  "notes": "/tabler-icons/notes.svg",
  "pencil": "/tabler-icons/pencil.svg",
  "rotate": "/tabler-icons/rotate.svg",
  "ruler-measure": "/tabler-icons/ruler-measure.svg",
  "settings": "/tabler-icons/settings.svg",
  "shape": "/tabler-icons/shape.svg",
  "spacing-horizontal": "/tabler-icons/spacing-horizontal.svg",
  "tool": "/tabler-icons/tool.svg",
  "unlink": "/tabler-icons/unlink.svg",
});

// A name from ICONS, or a path ("/..." or empty, passed through), or the name of
// a stock Tabler icon that has no entry above.
export function iconPath(nameOrPath) {
  if (!nameOrPath || nameOrPath.startsWith("/")) {
    return nameOrPath;
  }
  return ICONS[nameOrPath] ?? `/tabler-icons/${nameOrPath}.svg`;
}
