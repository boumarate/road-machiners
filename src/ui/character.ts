// Character screen: level, XP and skills.

import { RULES } from '../data/rules';
import { SKILL_IDS, SKILLS } from '../data/skills';
import { spendSkillPoint, xpForLevel } from '../sim/progress';
import { update } from '../sim/world';
import { el, panel } from './dom';
import type { UiHost } from './host';

export class CharacterScreen {
  private root = panel('modal');

  constructor(private host: UiHost) {
    this.root.style.display = 'none';
  }

  isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(): void {
    if (this.isOpen()) return this.close();
    this.root.style.display = '';
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const p = this.host.world().player;
    const rows = SKILL_IDS.map((id) => {
      const lvl = p.skills[id];
      const canRaise = p.skillPoints > 0 && lvl < RULES.maxSkillLevel;
      return el('tr', {},
        el('td', {}, SKILLS[id].name),
        el('td', {}, `${'#'.repeat(lvl)}${'.'.repeat(RULES.maxSkillLevel - lvl)}`),
        el('td', { class: 'dim' }, SKILLS[id].effect),
        el('td', {}, el('button', { disabled: !canRaise, onclick: () => this.raise(id) }, '+')),
      );
    });
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Close [C]'),
      el('h3', {}, 'Character'),
      el('div', {}, `Level ${p.level}   XP ${p.xp}/${xpForLevel(p.level + 1)}   Skill points ${p.skillPoints}`),
      el('div', { class: 'dim' }, `Health ${p.health}/${RULES.maxHealth}   Knockouts ${p.knockouts}`),
      el('table', {}, ...rows),
    );
  }

  private raise(id: (typeof SKILL_IDS)[number]): void {
    this.host.apply(update(this.host.world(), (w) => spendSkillPoint(w, id)));
    this.render();
  }
}
