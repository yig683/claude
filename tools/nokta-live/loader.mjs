// Lets Node import the mod's TypeScript the way the engine's bundler does: relative paths without an extension.
//   node --import ./loader.mjs build.mjs
import { register } from 'node:module'

register('./loader-hooks.mjs', import.meta.url)
