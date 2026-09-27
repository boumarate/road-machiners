// Character screen: skill levels, XP to the next level, today's XP against the daily cap, and perks. An open perk
// pair shows both perks as buttons, and a picked pair shows its perk.

import { MAX_SKILL_LEVEL, PERK_LEVELS, PERKS, type PerkId, SKILL_IDS, SKILL_INFO, XP_RULES, XP_TO_REACH } from '../data/skills';
import { maxHealthOf } from '../sim/health';
import { choosePerk, hasPerk, levelOf, pendingPerkPairs, perkPair, type PerkPair } from '../sim/progress';
import type { SkillId, World } from '../sim/types';
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
    const world = this.host.world();
    const p = world.player;
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Close [C]'),
      el('h3', {}, 'Character'),
      el('div', { class: 'dim' }, `Health ${p.health}/${maxHealthOf(world)}   Knockouts ${p.knockouts}`),
      el('table', {}, ...SKILL_IDS.flatMap((id) => [this.row(id, p.skills[id], p.xpToday[id]), this.perkRow(world, id)])),
    );
  }

  // One cell per perk pair the skill has reached: the picked perk, or both perks as buttons.
  private perkRow(world: World, skill: SkillId): HTMLElement | null {
    const open = pendingPerkPairs(world);
    const cells = PERK_LEVELS.map((level) => perkPair(skill, level)).flatMap((pair) => {
      const picked = pair.perks.find((id) => hasPerk(world, id));
      if (picked) return [el('div', {}, `${PERKS[picked].name}: ${PERKS[picked].rule}`)];
      if (!open.some((o) => o.skill === pair.skill && o.level === pair.level)) return [];
      return [this.choice(world, pair)];
    });
    return cells.length === 0 ? null : el('tr', {}, el('td', {}), el('td', { colspan: 4 }, ...cells));
  }

  private choice(world: World, pair: PerkPair): HTMLElement {
    const canPick = world.player.state === 'active';
    const button = (id: PerkId) => el('button', {
      disabled: !canPick,
      onclick: () => this.host.apply(choosePerk(this.host.world(), id)),
      title: PERKS[id].rule,
    }, `${PERKS[id].name}: ${PERKS[id].rule}`);
    return el('div', {}, el('span', { class: 'good' }, `Level ${pair.level} perk: `), ...pair.perks.map(button));
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
