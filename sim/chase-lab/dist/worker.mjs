import { suite, train, games, diagnostics } from './experiments.mjs';
self.onmessage = async ({ data }) => {
  try {
    const gen = data.kind === 'train' ? train(data.config, data.options) : suite(data.config, data.options);
    let r, last = 0;
    do {
      r = gen.next();
      if (!r.done && performance.now() - last > 200) { self.postMessage({ type: 'progress', ...r.value }); last = performance.now(); await new Promise(resolve => setTimeout(resolve, 0)); }
    } while (!r.done);
    self.postMessage({ type: 'done', report: data.kind === 'train' ? r.value : { ...r.value, games: games(r.value), diagnostics: diagnostics(r.value) } });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
