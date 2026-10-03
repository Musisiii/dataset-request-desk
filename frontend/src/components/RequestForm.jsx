import { useState } from "react";

export default function RequestForm({ onCreate, onCancel }) {
  const [values, setValues] = useState({ task_name: "", episodes_requested: "", deadline: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
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
          Task name
          <input maxLength="255" value={values.task_name} onChange={(event) => update("task_name", event.target.value)} required />
          {errors.task_name && <span className="field-error">{errors.task_name}</span>}
        </label>
        <label className="field">
          Episodes requested
          <input type="number" min="1" step="1" value={values.episodes_requested} onChange={(event) => update("episodes_requested", event.target.value)} required />
          {errors.episodes_requested && <span className="field-error">{errors.episodes_requested}</span>}
        </label>
        <label className="field">
          Deadline
          <input type="date" value={values.deadline} onChange={(event) => update("deadline", event.target.value)} required />
          {errors.deadline && <span className="field-error">{errors.deadline}</span>}
        </label>
        <label className="field field--wide">
          Notes
          <textarea rows="3" value={values.notes} onChange={(event) => update("notes", event.target.value)} />
          {errors.notes && <span className="field-error">{errors.notes}</span>}
        </label>
        <div className="form-actions field--wide">
          <button className="button button--primary" type="submit" disabled={loading}>
            {loading ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </section>
  );
}