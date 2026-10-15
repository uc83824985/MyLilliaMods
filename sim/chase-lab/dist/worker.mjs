import { suite, train, games, diagnostics } from './experiments.mjs';
self.onmessage = ({ data }) => {
  try {
    const gen = data.kind === 'train' ? train(data.config, data.options) : suite(data.config, data.options);
    let r, last = 0;
    do {
      r = gen.next();
      // This is a dedicated worker; the UI remains responsive on its own thread.
      // Cancellation terminates the worker. Timer yields here get throttled in
      // background tabs and can turn seconds of batch work into minutes.
      if (!r.done && performance.now() - last > 200) { self.postMessage({ type: 'progress', ...r.value }); last = performance.now(); }
    } while (!r.done);
    self.postMessage({ type: 'done', report: data.kind === 'train' ? r.value : { ...r.value, games: games(r.value), diagnostics: diagnostics(r.value) } });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
