// Character screen: skill levels, XP to the next level and today's XP against the daily cap.

import { MAX_SKILL_LEVEL, SKILL_IDS, SKILL_INFO, XP_RULES, XP_TO_REACH } from '../data/skills';
import { RULES } from '../data/rules';
import { levelOf } from '../sim/progress';
import type { SkillId } from '../sim/types';
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
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Close [C]'),
      el('h3', {}, 'Character'),
      el('div', { class: 'dim' }, `Health ${p.health}/${RULES.maxHealth}   Knockouts ${p.knockouts}`),
      el('table', {}, ...SKILL_IDS.map((id) => this.row(id, p.skills[id], p.xpToday[id]))),
    );
  }

  private row(id: SkillId, xp: number, today: number): HTMLElement {
    const lvl = levelOf(xp);
    const next = lvl < MAX_SKILL_LEVEL ? `${Math.floor(xp)}/${XP_TO_REACH[lvl + 1]} XP` : 'max';
    return el('tr', {},
      el('td', {}, SKILL_INFO[id].name),
      el('td', {}, `${'#'.repeat(lvl)}${'.'.repeat(MAX_SKILL_LEVEL - lvl)}`),
      el('td', {}, next),
      el('td', { class: 'dim' }, `today ${Math.floor(today)}/${XP_RULES.dailyCap}`),
      el('td', { class: 'dim' }, `grows from ${SKILL_INFO[id].grows}`),
    );
  }
}
