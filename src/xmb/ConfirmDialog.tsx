import { useEffect, useRef } from "react";
import { blip } from "./audio";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 0 = confirm, 1 = cancel. Owned by the console so the controller can move it too. */
  choice: 0 | 1;
  onChoice: (choice: 0 | 1) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The console's confirmation dialog: the wallpaper dims and softens, the
 * question stands in the middle without a box, two answers below it.
 * ◀ ▶ move, Enter confirms, Esc cancels.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel = "Yes", cancelLabel = "No", choice, onChoice, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]')?.focus({ preventScroll: true });
  }, [open, choice]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.repeat) { event.preventDefault(); return; }
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown":
          event.preventDefault();
          onChoice(choice === 0 ? 1 : 0);
          blip("move");
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (choice === 0) onConfirm(); else onCancel();
          break;
        case "Escape":
        case "Backspace":
          event.preventDefault();
          onCancel();
          break;
        case "Tab":
          event.preventDefault();
          onChoice(choice === 0 ? 1 : 0);
          break;
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, choice, onChoice, onConfirm, onCancel]);

  if (!open) return null;
  return (
    <div className="console-dialog-backdrop" onPointerDown={onCancel}>
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="console-dialog-title"
        aria-describedby="console-dialog-message"
        className="console-dialog"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="console-dialog-title" className="console-dialog-title">{title}</h2>
        <p id="console-dialog-message" className="console-dialog-message">{message}</p>
        <div className="console-dialog-choices">
          <button
            type="button"
            className="console-dialog-choice"
            data-selected={choice === 0}
            onMouseEnter={() => { if (choice !== 0) { onChoice(0); blip("move"); } }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="console-dialog-choice"
            data-selected={choice === 1}
            onMouseEnter={() => { if (choice !== 1) { onChoice(1); blip("move"); } }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
