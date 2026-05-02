function resolvePort(argv, envPort) {
  const cliPort = getCliPort(argv);
  const candidate = cliPort ?? envPort ?? '3000';
  const parsed = Number.parseInt(String(candidate), 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port: ${candidate}. Use a value between 1 and 65535.`);
  }

  return parsed;
}

function getCliPort(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--port=')) {
      return arg.slice('--port='.length);
    }

    if (arg === '--port' && argv[i + 1]) {
      return argv[i + 1];
    }
  }

  return null;
}

module.exports = {
  resolvePort,
};
