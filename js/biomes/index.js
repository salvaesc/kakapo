// Biome registry. The MVP ships only the native forest.
// Planned (same interface as createForestBiome): 'coast' (beaches, pōhutukawa cliffs),
// 'alpine' (snowy peaks, lakes), 'fjords' (sheer walls, waterfalls, mist).
import { createForestBiome } from './forest.js';

const factories = {
  forest: createForestBiome,
};

export function createBiome(id = 'forest', seed = 7) {
  return (factories[id] || createForestBiome)(seed);
}
