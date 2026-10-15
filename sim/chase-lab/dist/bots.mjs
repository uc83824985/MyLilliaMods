// Simulator entry point. Shared decision logic receives only a restricted Context.
import {Bot as ScriptBot} from './bot-mind.mjs';
import {buildAIContext} from './ai-context.mjs';
export {POLICIES} from './bot-mind.mjs';
export class Bot extends ScriptBot {
  action(world){return this.step(buildAIContext(world,'player'));}
}
