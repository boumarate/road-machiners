// The saved shape of a new game on the test map, which npm run save:shape writes and the save test checks.

import { startKit } from '../data/start';
import { newWorld } from '../sim/world';
import { saveOf } from '../three/save';
import { shapeOf, type Shape } from '../three/save-shape';
import { TEST_MAP } from './map';

export function newGameShape(): Shape {
  return shapeOf(JSON.parse(JSON.stringify(saveOf(newWorld(1337, startKit('standard'), TEST_MAP)).world)));
}
