import { IconButton } from "./icon-button.js";

// The overflow as a card: the same vertical three-dot as overflow-button.js,
// opening a panel of real controls (a segmented control, a check, icon groups)
// instead of a menu list. The caller builds the controls once and hands them
// over as `content`; IconButton owns opening, placing and closing the card
// (a native popover, so a click outside and Escape close it) -- this class
// only maps `content` onto `dropdown` and points the icon at the dots.
export class OverflowPopover extends IconButton {
  constructor() {
    super();
    this.src = "/tabler-icons/dots-vertical.svg";
  }

  set content(element) {
    this.dropdown = element;
  }
}

customElements.define("overflow-popover", OverflowPopover);
