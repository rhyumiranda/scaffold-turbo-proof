// Returns no deploymentId key when unset, so strict exactOptionalPropertyTypes configs accept the spread.
export function deploymentSettings(env: NodeJS.ProcessEnv = process.env): { deploymentId?: string } {
  const replicas = Number(env.DEPLOYMENT_REPLICAS ?? '1');
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 10000) throw new Error('Invalid DEPLOYMENT_REPLICAS');
  const deploymentId = env.APP_DEPLOYMENT_ID;
  if (deploymentId && !/^[a-zA-Z0-9._-]{1,100}$/.test(deploymentId)) throw new Error('Invalid APP_DEPLOYMENT_ID');
  if (replicas > 1) {
    const key = env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ?? '';
    if (
      !deploymentId ||
      ![16, 24, 32].includes(Buffer.from(key, 'base64').length) ||
      Buffer.from(key, 'base64').toString('base64') !== key
    )
      throw new Error('Replicas require APP_DEPLOYMENT_ID and a valid shared action key at build time');
  }
  return deploymentId ? { deploymentId } : {};
}

type ChunkableWebpackConfig = {
  optimization?: { splitChunks?: false | { maxSize?: number } };
};

// Bound the shared Next runtime chunks so mobile browsers can yield between evaluations. The total-byte budget
// still catches duplication; React DOM can remain larger because webpack cannot split a single module.
export function limitClientChunkSize<T extends ChunkableWebpackConfig>(config: T, isServer: boolean): T {
  if (!isServer && config.optimization?.splitChunks) config.optimization.splitChunks.maxSize = 20_000;
  return config;
}
