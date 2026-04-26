import { useEffect } from 'react';

const CONTROL_SELECTOR = 'input:not([type="hidden"]), select, textarea';
const GENERIC_OPTION_RE = /^(all|any|none|select|choose|yes|no|-|n\/a)$/i;

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:\.{3}|\u2026)\s*$/u, '')
    .trim();
}

function humanizeToken(value) {
  return normalizeText(value)
    .replace(/^_+|_+$/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function hasExplicitName(control) {
  const id = control.getAttribute('id');
  return Boolean(
    control.getAttribute('aria-label')
    || control.getAttribute('aria-labelledby')
    || control.getAttribute('title')
    || control.closest('label')
    || (id && document.querySelector(`label[for="${cssEscape(id)}"]`))
  );
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function selectedOptionText(select) {
  const selected = select.options?.[select.selectedIndex];
  const text = normalizeText(selected?.textContent);
  if (text && !GENERIC_OPTION_RE.test(text)) return text;
  const firstSpecific = [...(select.options || [])]
    .map(option => normalizeText(option.textContent))
    .find(option => option && !GENERIC_OPTION_RE.test(option));
  return firstSpecific || '';
}

function nearbyText(control) {
  const candidates = [];
  let previous = control.previousElementSibling;
  while (previous && candidates.length < 2) {
    if (!previous.matches(CONTROL_SELECTOR)) candidates.push(previous.textContent);
    previous = previous.previousElementSibling;
  }

  const parent = control.parentElement;
  if (parent) {
    for (const child of parent.children) {
      if (child === control) break;
      if (!child.matches(CONTROL_SELECTOR)) candidates.push(child.textContent);
    }
  }

  return candidates
    .map(normalizeText)
    .find(text => text && text.length <= 64 && !/^(all|active|open)$/i.test(text));
}

function inferControlLabel(control) {
  const placeholder = normalizeText(control.getAttribute('placeholder'));
  if (placeholder) return placeholder;

  const name = humanizeToken(control.getAttribute('name'));
  if (name) return name;

  const id = humanizeToken(control.getAttribute('id'));
  if (id && !/^_?r_?\d+/i.test(id)) return id;

  const nearby = nearbyText(control);
  if (nearby) return nearby;

  if (control.tagName === 'SELECT') {
    const option = selectedOptionText(control);
    return option ? `${option} filter` : 'Filter';
  }

  const type = (control.getAttribute('type') || '').toLowerCase();
  if (type === 'date') return 'Date';
  if (type === 'month') return 'Month';
  if (type === 'time') return 'Time';
  if (type === 'number') return 'Number';
  if (control.tagName === 'TEXTAREA') return 'Notes';
  return 'Text input';
}

export default function useAutoFormControlLabels() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const applyLabels = () => {
      for (const control of document.querySelectorAll(CONTROL_SELECTOR)) {
        if (hasExplicitName(control)) continue;
        control.setAttribute('aria-label', inferControlLabel(control));
        control.setAttribute('data-auto-a11y-label', 'true');
      }
    };

    applyLabels();
    const observer = new MutationObserver(applyLabels);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'name', 'placeholder', 'aria-label', 'aria-labelledby', 'title'],
    });

    return () => observer.disconnect();
  }, []);
}
