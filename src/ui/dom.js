// Building DOM without a framework, and the shared pieces every screen uses.

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

/** h('button', { class: 'chip', onclick }, 'Label', child, null) — null, undefined and false are skipped. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Replaces an element's children (never inserts "null"). */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/**
 * A radio group of chips, for picking a value. options: [{ value, label, icon? }], icon a function
 * returning a fresh node. Returns the group;
 * group.set(value) changes the selection without calling onChange.
 */
export function chips({ label, options, value, onChange, className = '' }) {
  return radioGroup({ label, options, value, onChange, groupClass: 'chips', itemClass: `chip ${className}` });
}

/**
 * A segmented control, for switching what the screen shows. Same options as chips().
 */
export function segmented({ label, options, value, onChange, className = '' }) {
  return radioGroup({ label, options, value, onChange, groupClass: `segmented ${className}`.trim(), itemClass: 'segment' });
}

function radioGroup({ label, options, value, onChange, groupClass, itemClass }) {
  const group = h('div', { class: groupClass, role: 'radiogroup', 'aria-label': label });
  const render = (current) => {
    fill(group, options.map((o) => h('button', {
      type: 'button',
      class: itemClass,
      role: 'radio',
      'aria-checked': String(o.value === current),
      dataset: { value: o.value ?? '' },
      onclick: () => { render(o.value); onChange(o.value); },
    }, o.icon?.(), o.label)));
  };
  render(value);
  group.set = render;
  return group;
}

/**
 * A labelled control. Only a text box, select or textarea goes inside a <label>: a label passes a
 * tap on itself to its first control, so around a chip group every tap picked the first chip (the
 * chips redraw on a tap, and the tapped one is gone by the time the label acts). Chips and
 * segmented controls get a plain box, named by their own aria-label.
 */
export function field(label, control, hint) {
  const labelable = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement;
  return h(labelable ? 'label' : 'div', { class: 'field' },
    h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
}

/** A bottom sheet on a native <dialog>. Returns { close, dialog }. onClose runs however it closes. */
export function sheet(title, ...content) {
  return openSheet({ title }, ...content);
}

export function openSheet({ title, onClose = null }, ...content) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    content);
  let closed = false;
  const done = () => { if (closed) return; closed = true; dialog.remove(); onClose?.(); };
  const close = () => { if (dialog.open) dialog.close(); done(); };
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('cancel', done);
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog };
}

let toastTimer;
/** A message above the tab bar for 5 seconds, with an optional action ({ label, run }). */
export function toast(message, action) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  fill(el, h('span', {}, message), action && h('button', {
    type: 'button',
    class: 'toast-action',
    onclick: async () => { el.classList.remove('show'); await action.run(); },
  }, action.label));
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

const ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  camera: '<path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

/** Smooth scrolling explains a jump, unless the phone asks for less motion. */
export const scrollBehaviour = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
