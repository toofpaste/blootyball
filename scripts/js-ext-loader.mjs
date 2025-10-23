import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (error.code === 'ERR_IMPORT_ASSERTION_TYPE_MISSING' && specifier.endsWith('.json')) {
      const parentURL = context.parentURL || pathToFileURL(process.cwd() + '/').href;
      const resolved = specifier.startsWith('.')
        ? pathToFileURL(resolvePath(dirname(fileURLToPath(parentURL)), specifier)).href
        : pathToFileURL(resolvePath(process.cwd(), specifier)).href;
      return { url: resolved, shortCircuit: true };
    }

    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    if (specifier.startsWith('node:') || specifier.startsWith('data:')) throw error;

    const parentURL = context.parentURL || pathToFileURL(process.cwd() + '/').href;
    const resolved = specifier.startsWith('.')
      ? pathToFileURL(resolvePath(dirname(fileURLToPath(parentURL)), `${specifier}.js`)).href
      : null;

    if (!resolved) throw error;
    return await defaultResolve(resolved, context, defaultResolve);
  }
}

const shouldTreatAsModule = (url) => {
  if (!url.startsWith('file://')) return false;
  if (!url.endsWith('.js')) return false;

  const filename = fileURLToPath(url);
  return !filename.includes(`${resolvePath('node_modules')}`);
};

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${source};`,
    };
  }

  if (shouldTreatAsModule(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}
