import { useMemo, useState } from "react";

function toDateInput(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function RequestForm({ onCreate, onCancel }) {
  const [values, setValues] = useState({ task_name: "", episodes_requested: "", deadline: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const isValidDeadline = useMemo(() => {
    if (!values.deadline) return false;
    const today = toDateInput(new Date());
    return values.deadline >= today;
  }, [values.deadline]);

  const submitDisabled = loading || !values.task_name.trim() || !String(values.episodes_requested).trim() || Number(values.episodes_requested) < 1 || !isValidDeadline;

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!values.task_name.trim()) {
      setErrors({ task_name: "Task name is required." });
      return;
    }
    if (!String(values.episodes_requested).trim() || Number(values.episodes_requested) < 1) {
      setErrors({ episodes_requested: "Episodes requested must be at least 1." });
      return;
    }
    if (!values.deadline || !isValidDeadline) {
      setErrors({ deadline: "Deadline cannot be in the past." });
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      await onCreate({ ...values, episodes_requested: Number(values.episodes_requested) });
    } catch (error) {
      if (error.data && typeof error.data === "object") {
        const fieldErrors = Object.fromEntries(
          Object.entries(error.data).map(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : String(value)]),
        );
        setErrors({ ...fieldErrors, form: error.message });
      } else {
        setErrors({ form: error.message });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="form-panel" aria-labelledby="new-request-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New intake</p>
          <h2 id="new-request-title">Create request</h2>
        </div>
        <button className="button button--quiet" type="button" onClick={onCancel}>Close</button>
      </div>
      {errors.form && <div className="notice notice--error" role="alert">{errors.form}</div>}
      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="field field--wide">
          <span>Task name <span className="required-mark" aria-hidden="true">*</span></span>
          <input aria-label="Task name" maxLength="255" value={values.task_name} onChange={(event) => update("task_name", event.target.value)} required aria-invalid={Boolean(errors.task_name)} />
          {errors.task_name && <span className="field-error">{errors.task_name}</span>}
        </label>
        <label className="field">
          <span>Episodes requested <span className="required-mark" aria-hidden="true">*</span></span>
          <input aria-label="Episodes requested" type="number" min="1" step="1" value={values.episodes_requested} onChange={(event) => update("episodes_requested", event.target.value)} required aria-invalid={Boolean(errors.episodes_requested)} />
          {errors.episodes_requested && <span className="field-error">{errors.episodes_requested}</span>}
        </label>
        <label className="field">
          <span>Deadline <span className="required-mark" aria-hidden="true">*</span></span>
          <input aria-label="Deadline" type="date" value={values.deadline} onChange={(event) => update("deadline", event.target.value)} required aria-invalid={Boolean(errors.deadline) || !isValidDeadline} />
          {(errors.deadline || !isValidDeadline) && <span className="field-error">{errors.deadline || "Deadline cannot be in the past."}</span>}
        </label>
        <label className="field field--wide">
          Notes
          <textarea aria-label="Notes" rows="3" value={values.notes} onChange={(event) => update("notes", event.target.value)} />
          {errors.notes && <span className="field-error">{errors.notes}</span>}
        </label>
        <div className="form-actions field--wide">
          <button className="button button--primary" type="submit" disabled={submitDisabled}>
            {loading ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </section>
  );
}