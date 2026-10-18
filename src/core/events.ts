/**
 * Magistrală de evenimente în proces. În producție ar fi un broker (ex. Kafka);
 * aici păstrează aceeași formă: publish / subscribe pe tip de eveniment.
 */
export type Handler<T> = (payload: T) => void | Promise<void>;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Handler<any>[]>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const l = this.handlers.get(type) ?? [];
      this.handlers.set(type, l.filter((h) => h !== handler));
    };
  }

  async emit<K extends keyof Events>(type: K, payload: Events[K]): Promise<void> {
    for (const h of this.handlers.get(type) ?? []) await h(payload);
  }
}
