import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryMoveScale} from '../../dist/core.mjs';
import {presetConfig} from '../geometry-fixture.mjs';
test('historical constant recovery remains readable',()=>{const c=presetConfig('rhythm-flat-recovery');assert.equal(recoveryMoveScale(c,{elapsed:.6,used:false}),.35);});
