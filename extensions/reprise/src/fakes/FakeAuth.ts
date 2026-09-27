// fakes/FakeAuth.ts — in-memory fake AuthService (always signed in)
import type { AuthService } from '../contracts/services';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import * as runtime from '../contracts/runtime';

export class FakeAuth implements AuthService {
  private token = 'fake-github-token-abc123';
  private signedIn = true;
  private emitter = new runtime.EventEmitter<{ signedIn: boolean }>();
  readonly onDidChangeSession = this.emitter.event;

  async signIn(): Promise<Result<string, string>> {
    this.signedIn = true;
    this.emitter.fire({ signedIn: true });
    return R.ok(this.token);
  }

  async signOut(): Promise<void> {
    this.signedIn = false;
    this.emitter.fire({ signedIn: false });
  }

  getToken(): string | null {
    return this.signedIn ? this.token : null;
  }

  isSignedIn(): boolean {
    return this.signedIn;
  }
}
