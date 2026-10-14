import {presetConfig as currentPreset} from '../dist/presets.mjs';
// These fixed-coordinate action/perception unit tests use the original clear central street.
// Actual ring geometry, spawns, drills and navigation are covered in ring-map.test.mjs.
export function presetConfig(id){return {...currentPreset(id),mapLayout:'grid'};}
