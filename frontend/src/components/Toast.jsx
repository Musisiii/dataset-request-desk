import { useEffect } from "react";

const LABELS = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  info: "Information",
};

export default function Toast({ id, message, type = "info", onDismiss, duration = 4500 }) {
  useEffect(() => {
    if (duration <= 0) return undefined;
    const timeout = window.setTimeout(() => onDismiss(id), duration);
    return () => window.clearTimeout(timeout);
  }, [duration, id, onDismiss]);

  return (
    <div className={`toast toast--${type}`} role={type === "error" ? "alert" : "status"} aria-live={type === "error" ? "assertive" : "polite"}>
      <span className="toast__label">{LABELS[type] || LABELS.info}</span>
      <span className="toast__message">{message}</span>
      <button className="icon-button toast__close" type="button" aria-label="Dismiss notification" onClick={() => onDismiss(id)}>×</button>
    </div>
  );
}