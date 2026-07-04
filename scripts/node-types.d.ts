// Minimal ambient Node.js type declarations for repo scripts.
// The P0 toolchain scaffold has no @types/node devDependency; this local shim keeps
// `tsc -p jsconfig.json --noEmit` strict-clean for the small Node API surface the
// scripts use, without adding an npm dependency. If @types/node is ever added,
// delete this file and the triple-slash references to it.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module "node:path" {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: string[];
  exit(code?: number): never;
};
