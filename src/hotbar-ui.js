import { MATERIALS } from './inventory.js';

const names = new Map(MATERIALS.map(item => [item.id, item.name]));
const pickupHighlights = new WeakMap();

export function highlightHotbarPickup(container, slots) {
  const until = pickupHighlights.get(container) || new Map();
  pickupHighlights.set(container, until);
  for (const index of slots) {
    if (!Number.isInteger(index) || index < 0 || index > 8) continue;
    const button = container.querySelector(`[data-slot="${index}"]`);
    if (!button?.querySelector('.block-icon')) continue;
    until.set(index, performance.now() + 300);
    button.classList.remove('slot-pickup');
    void button.offsetWidth;
    button.classList.add('slot-pickup');
  }
}

export function fitHotbarLabels(container) {
  for (const label of container.querySelectorAll('.slot-name')) {
    const text = label.firstElementChild;
    text.style.fontSize = '10px'; text.style.letterSpacing = ''; text.style.transform = '';
    const available = Math.max(0, label.getBoundingClientRect().width - .5);
    if (!available) continue;
    const natural = text.getBoundingClientRect().width;
    if (natural <= available) continue;
    text.style.fontSize = `${Math.max(7, 10 * available / natural)}px`;
    if (text.getBoundingClientRect().width > available) text.style.letterSpacing = '-.35px';
    const width = text.getBoundingClientRect().width;
    if (width > available) text.style.transform = `scaleX(${available / width})`;
  }
}

export function renderHotbarSlots(container, inventory, icon) {
  container.replaceChildren(...inventory.hotbar.map((block, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'slot';
    button.dataset.slot = index; button.dataset.block = block;
    const count = inventory.slotCount(index), name = names.get(block) || 'Empty';
    button.setAttribute('aria-label', `${name}, slot ${index + 1}, ${count} collected`);
    button.title = `${name} · Slot ${index + 1}${block ? ` · ${count} items` : ''}`;
    button.setAttribute('aria-pressed', String(index === inventory.selected)); button.classList.toggle('selected', index === inventory.selected);
    button.classList.toggle('depleted', count === 0);
    button.classList.toggle('slot-pickup', (pickupHighlights.get(container)?.get(index) || 0) > performance.now());
    const key = document.createElement('span'); key.className = 'slot-key'; key.textContent = index + 1; key.setAttribute('aria-hidden', 'true');
    const supply = document.createElement('span'); supply.className = 'slot-supply'; supply.textContent = count; supply.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'slot-name';
    const text = document.createElement('span'); text.textContent = name; label.append(text);
    button.append(key); if (block) button.append(supply, icon(block)); button.append(label);
    return button;
  }));
  fitHotbarLabels(container);
}
