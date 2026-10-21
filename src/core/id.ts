export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
