import test from 'node:test';
import assert from 'node:assert/strict';
import { MenuScreens } from '../src/menu.js';

function fixture() {
  const element = (dataset = {}) => Object.assign(new EventTarget(), { dataset, hidden: false, textContent: '', focus() {} });
  const back = element(), card = { scrollTop: 0 };
  const buttons = ['single', 'create', 'settings'].map(menuScreen => element({ menuScreen }));
  const panels = ['home', 'single create multi', 'single', 'create', 'pause', 'settings'].map(menuPanel => element({ menuPanel }));
  const nodes = new Map([['#menu-title', element()], ['#menu-description', element()], ['#menu-back', back], ['.menu-card', card], ['#play', element()], ['[data-menu-screen="single"]', buttons[0]]]);
  const root = { dataset: {}, querySelector: selector => nodes.get(selector), querySelectorAll: selector => selector === '[data-menu-screen]' ? buttons : panels };
  return { screens: new MenuScreens(root), root, back, buttons, panels };
}

test('world creation is separate from the library and Back returns to saved worlds', () => {
  const { screens, root, back, buttons, panels } = fixture();
  buttons[0].dispatchEvent(new Event('click'));
  assert.equal(root.dataset.screen, 'single');
  assert.equal(panels[2].hidden, false);
  assert.equal(panels[3].hidden, true, 'creation fields must not occupy library space');
  buttons[1].dispatchEvent(new Event('click'));
  assert.equal(root.dataset.screen, 'create');
  assert.equal(panels[1].hidden, false, 'the parent panel must remain visible for creation');
  assert.equal(panels[2].hidden, true);
  assert.equal(panels[3].hidden, false);
  back.dispatchEvent(new Event('click'));
  assert.equal(screens.screen, 'single');
  screens.goBack();
  assert.equal(screens.screen, 'home');
});

test('library navigation refreshes its contents while settings retain the pause destination', () => {
  const { screens } = fixture(), visited = [];
  screens.onChange = screen => visited.push(screen);
  screens.show('create');
  screens.goBack();
  assert.deepEqual(visited, ['create', 'single']);
  screens.setSession(true);
  screens.show('settings');
  screens.goBack();
  assert.equal(screens.screen, 'pause');
});
