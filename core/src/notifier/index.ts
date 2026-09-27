// notifier/ — broadcast CoreEvents to whoever is watching (replaces the extension's views)
// The backend subscribes with onEvent and relays events to the Review UI (e.g. over SSE).

import type { CoreEvent, NotifierService } from '../contracts/services';
import { Emitter } from '../util/events';

export function createNotifier(): NotifierService {
  const emitter = new Emitter<CoreEvent>();
  return {
    emit: (event) => emitter.fire(event),
    onEvent: emitter.event,
  };
}
