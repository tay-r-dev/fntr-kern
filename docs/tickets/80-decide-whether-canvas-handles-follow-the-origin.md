# 80: Decide whether the canvas selection box follows the origin

**Status:** needs-decision

**Blocked by:** None

## Today

The panel's origin grid pins every panel transform. The canvas selection box ignores it: dragging a handle scales or rotates about the opposite side of the box, and Alt pins the centre. Found while closing ticket 02.

## Decision needed

Should a handle drag pin at the panel's origin, and if so, what do the opposite-side pin and Alt become?

**Files:** `views-editor/src/edit-tools-pointer.js` (handle drag), `views-editor/src/panel-transformation.js` (`getPinPoint`, the origin state).
