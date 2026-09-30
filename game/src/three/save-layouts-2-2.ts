// Copies of the chassis grids at format 2.1 and 2.2, for step 1 to 2 in save-migrations.ts. They are frozen, since
// the chassis table changes later. Cores lists the cab, the transmission and the tank of each chassis. The wheels
// never moved. The nth core of CORES_2_1 becomes the nth core of CORES_2_2.

export type Core = { defId: string; x: number; y: number; rot: number };

export const CORES_2_1: Record<string, readonly Core[]> = {
  scout: [
    { defId: 'cabPickup', x: 1, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 5, rot: 0 },
    { defId: 'tank', x: 4, y: 5, rot: 0 },
  ],
  hauler: [
    { defId: 'cabOver', x: 5, y: 1, rot: 0 },
    { defId: 'transmissionMid', x: 3, y: 3, rot: 0 },
    { defId: 'tankMid', x: 5, y: 6, rot: 0 },
  ],
  buggy: [
    { defId: 'cab', x: 1, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 5, rot: 0 },
    { defId: 'tank', x: 4, y: 3, rot: 0 },
  ],
  wagon: [
    { defId: 'cab', x: 2, y: 1, rot: 0 },
    { defId: 'transmissionHeavy', x: 2, y: 4, rot: 0 },
    { defId: 'tankHeavy', x: 4, y: 4, rot: 0 },
  ],
  courier: [
    { defId: 'cab', x: 2, y: 5, rot: 0 },
    { defId: 'transmission', x: 2, y: 1, rot: 0 },
    { defId: 'tank', x: 4, y: 3, rot: 0 },
  ],
  van: [
    { defId: 'cabRow', x: 2, y: 3, rot: 0 },
    { defId: 'transmissionMid', x: 4, y: 4, rot: 0 },
    { defId: 'tankMid', x: 4, y: 6, rot: 0 },
  ],
  longbed: [
    { defId: 'cabWide', x: 2, y: 3, rot: 0 },
    { defId: 'transmissionHeavy', x: 3, y: 6, rot: 0 },
    { defId: 'tankHeavy', x: 5, y: 6, rot: 0 },
  ],
  carrier: [
    { defId: 'cab', x: 5, y: 2, rot: 0 },
    { defId: 'transmissionHeavy', x: 4, y: 3, rot: 0 },
    { defId: 'tankHeavy', x: 4, y: 5, rot: 0 },
  ],
  tractor: [
    { defId: 'cabWide', x: 2, y: 3, rot: 0 },
    { defId: 'transmissionHeavy', x: 2, y: 6, rot: 0 },
    { defId: 'tankHeavy', x: 4, y: 5, rot: 0 },
  ],
  jeep: [
    { defId: 'cab', x: 2, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 1, rot: 0 },
    { defId: 'tank', x: 2, y: 7, rot: 1 },
  ],
  convertible: [
    { defId: 'cabHardtop', x: 3, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 1, rot: 0 },
    { defId: 'tankLong', x: 4, y: 1, rot: 0 },
  ],
  bus: [
    { defId: 'cabNarrow', x: 2, y: 1, rot: 0 },
    { defId: 'transmissionMid', x: 3, y: 6, rot: 0 },
    { defId: 'tankMid', x: 5, y: 6, rot: 0 },
  ],
  loader: [
    { defId: 'cabPickup', x: 3, y: 2, rot: 0 },
    { defId: 'transmissionHeavy', x: 5, y: 6, rot: 0 },
    { defId: 'tankHeavy', x: 2, y: 5, rot: 0 },
  ],
};

export const CORES_2_2: Record<string, readonly Core[]> = {
  scout: [
    { defId: 'cabPickup', x: 2, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 5, rot: 0 },
    { defId: 'tank', x: 4, y: 5, rot: 0 },
  ],
  hauler: [
    { defId: 'cabPickup', x: 5, y: 1, rot: 1 },
    { defId: 'transmissionMid', x: 3, y: 3, rot: 0 },
    { defId: 'tankMid', x: 5, y: 6, rot: 0 },
  ],
  buggy: [
    { defId: 'cab', x: 3, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 5, rot: 0 },
    { defId: 'tank', x: 4, y: 3, rot: 0 },
  ],
  wagon: [
    { defId: 'cab', x: 2, y: 1, rot: 1 },
    { defId: 'transmissionHeavy', x: 3, y: 4, rot: 0 },
    { defId: 'tankHeavy', x: 2, y: 4, rot: 0 },
  ],
  courier: [
    { defId: 'cab', x: 2, y: 5, rot: 1 },
    { defId: 'transmission', x: 2, y: 1, rot: 0 },
    { defId: 'tank', x: 4, y: 3, rot: 0 },
  ],
  van: [
    { defId: 'cabPickup', x: 2, y: 3, rot: 1 },
    { defId: 'transmissionMid', x: 2, y: 6, rot: 0 },
    { defId: 'tankMid', x: 4, y: 6, rot: 0 },
  ],
  longbed: [
    { defId: 'cabPickup', x: 3, y: 3, rot: 0 },
    { defId: 'transmissionHeavy', x: 3, y: 6, rot: 0 },
    { defId: 'tankHeavy', x: 5, y: 6, rot: 0 },
  ],
  carrier: [
    { defId: 'cabPickup', x: 4, y: 3, rot: 1 },
    { defId: 'transmissionHeavy', x: 3, y: 1, rot: 0 },
    { defId: 'tankHeavy', x: 4, y: 6, rot: 1 },
  ],
  tractor: [
    { defId: 'cabPickup', x: 3, y: 3, rot: 0 },
    { defId: 'transmissionHeavy', x: 3, y: 6, rot: 0 },
    { defId: 'tankHeavy', x: 5, y: 5, rot: 0 },
  ],
  jeep: [
    { defId: 'cab', x: 2, y: 3, rot: 0 },
    { defId: 'transmission', x: 2, y: 1, rot: 0 },
    { defId: 'tank', x: 2, y: 7, rot: 1 },
  ],
  convertible: [
    { defId: 'cabHardtop', x: 2, y: 3, rot: 1 },
    { defId: 'transmission', x: 2, y: 1, rot: 0 },
    { defId: 'tankLong', x: 4, y: 1, rot: 0 },
  ],
  bus: [
    { defId: 'cabPickup', x: 2, y: 1, rot: 0 },
    { defId: 'transmissionMid', x: 3, y: 6, rot: 0 },
    { defId: 'tankMid', x: 5, y: 6, rot: 0 },
  ],
  loader: [
    { defId: 'cabPickup', x: 2, y: 2, rot: 1 },
    { defId: 'transmissionHeavy', x: 4, y: 3, rot: 0 },
    { defId: 'tankHeavy', x: 2, y: 5, rot: 0 },
  ],
};

export const LAYOUTS_2_2: Record<string, readonly string[]> = {
  scout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXXDR', 'LDXXXDR', 'LXXXXXR', 'LXXXXXR', ' BBBBB '],
  hauler: [' FFFFFFF ', 'LXDEEXXXR', 'LXDEEXXXR', 'LDDXXXXDR', 'LDDXXDDDR', 'LDDDDDDDR', 'LXDDDXDXR', 'LXDDDXDXR', ' BBBBBBB '],
  buggy: [' FFFF ', 'LXEEXR', 'LXEEXR', 'LDDXXR', 'LDDXXR', 'LXXXXR', 'LXXXXR', ' BBBB '],
  wagon: [' FFFFFF ', 'LXXXDDXR', 'LXEEDDXR', 'LDEEDDDR', 'LXXXXDXR', 'LXXXXDXR', ' BBBBBB '],
  courier: [' FFFF ', 'LXXXXR', 'LXXXXR', 'LDEEXR', 'LDEEXR', 'LDXXDR', 'LXDDXR', 'LXDDXR', ' BBBB '],
  van: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXDDR', 'LDXXDDR', 'LDXXDDR', 'LXXXXXR', 'LXXXXXR', ' BBBBB '],
  longbed: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEDDXR', 'LDDXXXDDR', 'LDDXXXDDR', 'LDDDDDDDR', 'LDDXXXDDR', 'LDDXXXDDR', 'LXDDDDDXR', 'LXDDDDDXR', ' BBBBBBB '],
  carrier: [' FFFFFF ', 'LXDXXDXR', 'LXDXXDXR', 'LDEEXXDR', 'LDEEXXDR', 'LDDDXXDR', 'LXDDXXXR', 'LXDDDDXR', ' BBBBBB '],
  tractor: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEDDXR', 'LDDXXXDDR', 'LDDXXXDDR', 'LDDDDXDDR', 'LXDXXXDXR', 'LXDXXDDXR', ' BBBBBBB '],
  jeep: [' FFFF ', 'LXXXXR', 'LXXXXR', 'LDXDDR', 'LDXDDR', 'LXEEXR', 'LXEEXR', 'LDXXDR', ' BBBB '],
  convertible: [' FFFFF ', 'LXXXXXR', 'LXXXXXR', 'LDXXDDR', 'LDXXDDR', 'LDXXDDR', 'LXEEDXR', 'LXEEDXR', ' BBBBB '],
  bus: [' FFFFFF ', 'LXXXXDXR', 'LXXXXDXR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDXXXDR', 'LDDXXXDR', 'LDDEEDDR', 'LXDEEDXR', 'LXDDDDXR', ' BBBBBB '],
  loader: [' FFFFFFF ', 'LXDDDDDXR', 'LXXXDDDXR', 'LDXXXXDDR', 'LDXXXXDDR', 'LDXEEDDDR', 'LXXEEDDXR', 'LXDDDDDXR', ' BBBBBBB '],

};
