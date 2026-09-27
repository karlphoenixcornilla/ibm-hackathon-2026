// fakes/FakeFileSystem.ts — in-memory FileSystem (host interface) for tests and demos
import type { FileSystem } from '../contracts/host';

export class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, Uint8Array>();

  constructor(
    initial: Record<string, string> = {},
    private readonly root: string | null = 'memory:///repo',
  ) {
    for (const [path, text] of Object.entries(initial)) {
      this.files.set(path, new TextEncoder().encode(text));
    }
  }

  getRoot(): string | null {
    return this.root;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) { throw new Error(`File not found: ${path}`); }
    return data;
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
  }
}
