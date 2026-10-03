import { useEffect, useId, useRef } from "react";

import { isTopDialog, registerDialog } from "./dialogStack.js";

export default function OverlayModal({ title, onClose, children, labelledBy, layer = "base" }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const accessibleTitleId = labelledBy || titleId;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const unregisterDialog = registerDialog(dialog);
    const firstFocusable = dialogRef.current?.querySelector(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
    );
    firstFocusable?.focus();

    function handleKeyDown(event) {
      if (!isTopDialog(dialog)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key === "Tab") {
        const focusable = dialog?.querySelectorAll(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        );
        const first = focusable?.[0];
        const last = focusable?.[focusable.length - 1];
        if (!dialog?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unregisterDialog();
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className={`dialog-backdrop overlay-modal-backdrop overlay-modal-backdrop--${layer}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="overlay-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={accessibleTitleId}
        tabIndex={-1}
      >
        <div className="overlay-modal__heading">
          <h2 id={accessibleTitleId}>{title}</h2>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
