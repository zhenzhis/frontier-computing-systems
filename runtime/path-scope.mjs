import path from 'node:path';

// Platform-aware path identity used by authorization boundaries. Windows path
// identities compare case-insensitively; POSIX identities compare exactly.
// `platform` is explicit so both semantics are unit-testable on either host.
const trailingSeparatorsTrimmed = (value, platform) => {
  const parse = platform === 'win32' ? path.win32.parse : path.posix.parse;
  const separator = platform === 'win32' ? '\\' : '/';
  const root = parse(value).root;
  let end = value.length;
  while (end > root.length && value[end - 1] === separator) end--;
  return value.slice(0, end);
};

export function pathIdentity(file, platform = process.platform) {
  if (typeof file !== 'string' || file.length === 0) throw TypeError('Path identity requires a non-empty path string');
  const win32 = platform === 'win32';
  const normalized = win32 ? path.win32.normalize(file) : path.posix.normalize(file);
  const trimmed = trailingSeparatorsTrimmed(normalized, platform);
  return win32 ? trimmed.toLowerCase() : trimmed;
}

export function samePath(left, right, platform = process.platform) {
  return pathIdentity(left, platform) === pathIdentity(right, platform);
}

// Strict containment: `root` itself is not inside; only a path below it with a
// real separator boundary is. Case folding follows the platform identity.
export function isStrictDescendant(root, candidate, platform = process.platform) {
  const separator = platform === 'win32' ? '\\' : '/';
  const rootIdentity = pathIdentity(root, platform);
  const candidateIdentity = pathIdentity(candidate, platform);
  const prefix = rootIdentity.endsWith(separator) ? rootIdentity : rootIdentity + separator;
  return candidateIdentity !== rootIdentity && candidateIdentity.startsWith(prefix);
}
