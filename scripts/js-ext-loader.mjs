import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
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
