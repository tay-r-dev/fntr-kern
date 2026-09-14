import { MultiSelectDropdown } from "./multi-select-dropdown.js";

// Ticket 48 (UI-REFACTOR.md §5.5, UI-NOMENCLATURE.md §14): the overflow
// button -- a vertical three-dot beside a segmented control, holding the
// choices the control has no room for. It is the multi-select dropdown in its
// icon mode and nothing else, so `items`, `singleChoice`, `disabled` and the
// "change" event are the dropdown's. Tickets 53 and 59 reuse it.
export class OverflowButton extends MultiSelectDropdown {
  constructor() {
    super();
    this.icon = "/tabler-icons/dots-vertical.svg";
  }
}

customElements.define("overflow-button", OverflowButton);
