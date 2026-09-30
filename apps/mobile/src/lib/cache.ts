import { File, Paths } from 'expo-file-system';

/** Tiny JSON cache on disk, so the kid side keeps working offline (rules, current book, reading position). */
export function readJson<T>(name: string, fallback: T): T {
  try {
    const file = new File(Paths.document, `${name}.json`);
    return file.exists ? (JSON.parse(file.textSync()) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown) {
  try {
    const file = new File(Paths.document, `${name}.json`);
    if (!file.exists) file.create();
    file.write(JSON.stringify(value));
  } catch (err) {
    console.warn(`[cache] could not write ${name}`, err);
  }
}
