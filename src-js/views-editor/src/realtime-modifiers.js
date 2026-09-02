// A held key that turns a mode on for as long as it is down.
//
// The pointer tool's Z, D, S, A and X all work this way, and the skeleton pen
// tool's W does too. One copy of the machine, because the hard part is not the
// flag: it is releasing the mode when the key comes up, when the window loses
// focus, and when the tool is put away, and a second copy would get one of
// those three wrong.

import {
  eventMatchesActionBaseKey,
  eventMatchesActionShortCut,
} from "@fontra/core/actions.js";

export class RealtimeModifierModes {
  // `owner` is the tool. The flags are written onto it by name, so the code
  // that reads a mode reads a plain property and does not know this class
  // exists. `actions` is a list of {action, modeProperty}.
  constructor(owner, actions) {
    this.owner = owner;
    this.actions = actions;
    this._keyUpHandlers = new Map();
    this._boundWindowBlur = null;
    for (const { modeProperty } of actions) {
      owner[modeProperty] = false;
    }
  }

  // Returns whether the event was one of ours, so the caller can stop.
  handleKeyDown(event) {
    const modifier = this.actions.find((modifier) =>
      eventMatchesActionShortCut(modifier.action, event)
    );
    if (!modifier) {
      return false;
    }
    if (!this.owner[modifier.modeProperty]) {
      this.owner[modifier.modeProperty] = true;
      const keyUpHandler = (e) => {
        if (eventMatchesActionBaseKey(modifier.action, e)) {
          this.end(modifier.action);
        }
      };
      this._keyUpHandlers.set(modifier.action, keyUpHandler);
      window.addEventListener("keyup", keyUpHandler);
      if (!this._boundWindowBlur) {
        this._boundWindowBlur = () => this.endAll();
        window.addEventListener("blur", this._boundWindowBlur);
      }
      this.owner.canvasController?.requestUpdate();
    }
    return true;
  }

  end(action) {
    const modifier = this.actions.find((modifier) => modifier.action === action);
    if (!modifier || !this.owner[modifier.modeProperty]) {
      return;
    }
    this.owner[modifier.modeProperty] = false;
    const keyUpHandler = this._keyUpHandlers.get(action);
    if (keyUpHandler) {
      window.removeEventListener("keyup", keyUpHandler);
      this._keyUpHandlers.delete(action);
    }
    this._removeBlurHandlerIfIdle();
    this.owner.canvasController?.requestUpdate();
  }

  endAll() {
    let changed = false;
    for (const modifier of this.actions) {
      if (this.owner[modifier.modeProperty]) {
        this.owner[modifier.modeProperty] = false;
        changed = true;
      }
      const keyUpHandler = this._keyUpHandlers.get(modifier.action);
      if (keyUpHandler) {
        window.removeEventListener("keyup", keyUpHandler);
      }
    }
    this._keyUpHandlers.clear();
    this._removeBlurHandlerIfIdle();
    if (changed) {
      this.owner.canvasController?.requestUpdate();
    }
  }

  _removeBlurHandlerIfIdle() {
    if (this._boundWindowBlur && !this._keyUpHandlers.size) {
      window.removeEventListener("blur", this._boundWindowBlur);
      this._boundWindowBlur = null;
    }
  }
}
