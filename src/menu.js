const SCREENS = {
  home: ['Blockfield', 'Wander the woods. Break a block. Build something.'],
  single: ['Your Worlds', 'Pick up where you left off, or start a new adventure.'],
  create: ['Create a World', 'Choose a name, a mode, and a landscape to call your own.'],
  multi: ['Multiplayer', 'Join a shared world and build together.'],
  pause: ['Game paused', ''],
  settings: ['Settings', 'Make yourself at home. Changes apply immediately.'],
  controls: ['Controls', 'Everything you need for your next adventure.'],
};

export class MenuScreens {
  inWorld = false;
  worldDescription = '';

  constructor(root) {
    this.root = root;
    this.title = root.querySelector('#menu-title');
    this.description = root.querySelector('#menu-description');
    this.back = root.querySelector('#menu-back');
    this.back.addEventListener('click', () => this.goBack());
    for (const button of root.querySelectorAll('[data-menu-screen]')) {
      button.addEventListener('click', () => this.show(button.dataset.menuScreen));
    }
    this.show('home', false);
  }

  show(screen, focus = true) {
    if (!SCREENS[screen]) return;
    this.screen = screen;
    this.root.dataset.screen = screen;
    for (const panel of this.root.querySelectorAll('[data-menu-panel]')) {
      panel.hidden = !panel.dataset.menuPanel.split(' ').includes(screen);
    }
    const [title, description] = SCREENS[screen];
    this.title.textContent = title;
    this.description.textContent = screen === 'pause' ? this.worldDescription : description;
    this.back.hidden = screen === 'home' || screen === 'pause';
    this.back.textContent = screen === 'create' ? '← Your worlds' : '← Back';
    if (focus) {
      const target = this.back.hidden ? this.root.querySelector(screen === 'pause' ? '#play' : '[data-menu-screen="single"]') : this.back;
      target?.focus({ preventScroll: true });
    }
    this.root.querySelector('.menu-card').scrollTop = 0;
    this.onChange?.(screen);
  }

  goBack() {
    this.show(this.screen === 'create' ? 'single' : this.inWorld ? 'pause' : 'home');
  }

  setSession(active) {
    this.inWorld = active;
    this.show(active ? 'pause' : 'home');
  }

  describeWorld(description) {
    this.worldDescription = description;
    if (this.screen === 'pause') this.description.textContent = description;
  }
}
