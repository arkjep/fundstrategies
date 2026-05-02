const path = require('node:path');
const livereload = require('livereload');
const connectLivereload = require('connect-livereload');

function isDevReloadEnabled() {
  return process.env.npm_lifecycle_event === 'dev' || process.argv.includes('--live-reload');
}

function attachDevReload(app) {
  if (!isDevReloadEnabled()) {
    return () => {};
  }

  const liveReloadServer = livereload.createServer({
    exts: ['html', 'css', 'js'],
    delay: 120,
  });

  liveReloadServer.watch([
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'src'),
  ]);

  app.use(connectLivereload());

  return () => {
    liveReloadServer.close();
  };
}

module.exports = {
  attachDevReload,
};
