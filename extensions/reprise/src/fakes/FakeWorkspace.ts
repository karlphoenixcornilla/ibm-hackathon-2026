// fakes/FakeWorkspace.ts — in-memory fake WorkspaceService
import type { WorkspaceService } from '../contracts/services';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import * as vscode from 'vscode';

export class FakeWorkspace implements WorkspaceService {
  private files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Result<Uint8Array, string>> {
    const data = this.files.get(path);
    if (!data) {
      return R.err(`File not found: ${path}`);
    }
    return R.ok(data);
  }

  async writeFile(path: string, content: Uint8Array): Promise<Result<void, string>> {
    this.files.set(path, content);
    return R.ok(undefined);
  }

  async sha256(bytes: Uint8Array): Promise<string> {
    const buffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  getRootUri(): vscode.Uri | null {
    return vscode.Uri.parse('fake:///workspace');
  }
}
