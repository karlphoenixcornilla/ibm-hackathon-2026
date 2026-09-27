// fakes/FakeNotifier.ts — NotifierService that records every emitted event
import type { CoreEvent, NotifierService } from '../contracts/services';
import { Emitter } from '../util/events';

export class FakeNotifier implements NotifierService {
  readonly events: CoreEvent[] = [];
  private emitter = new Emitter<CoreEvent>();
  readonly onEvent = this.emitter.event;

  emit(event: CoreEvent): void {
    this.events.push(event);
    this.emitter.fire(event);
  }
}
