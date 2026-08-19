for (const key of Object.keys(process.env)) {
  if (key.startsWith('PYTHINKER_CODE_EXPERIMENTAL_')) {
    delete process.env[key];
  }
}

process.env['PYTHINKER_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL'] = 'false';
