const SCREENS = {
  home: ['Blockfield', 'Gather supplies. Repair your shelter. Endure the night.'],
  single: ['Your Worlds', 'Pick up where you left off, or start a new adventure.'],
  create: ['Create a World', 'Choose a name and seed. Begin near a repairable outpost and renewable salvage sites.'],
  multi: ['Multiplayer', 'Join a shared world and build together.'],
  pause: ['Game menu', ''],
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
    this.show('home');
  }

  show(screen) {
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
