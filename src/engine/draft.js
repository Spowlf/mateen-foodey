// The Log screen's form (also the shape of the offline draft).

/** A blank form. id is chosen when the form starts, so a retried save updates instead of adding a copy. */
export function emptyLogForm({ id = null, date, meal } = {}) {
  return { id, date, meal, text: '', lines: [] };
}

/** Nothing worth keeping has been typed or picked. */
export const isBlank = (form) => !form || (!form.text?.trim() && !form.lines?.length);
