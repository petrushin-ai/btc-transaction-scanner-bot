import type { AppLogger } from "@/infrastructure/logger";
import { logger } from "@/infrastructure/logger";
import type { DomainEvent, DomainEventType, EventOfType } from "@/types/events";

export type RetryPolicy = {
  maxRetries: number;
  backoffMs: (attempt: number) => number;
};

export type Subscription<T extends DomainEventType> = {
  event: T;
  handler: (event: EventOfType<T>) => Promise<void> | void;
  concurrency?: number;
  retry?: RetryPolicy;
  name?: string;
};

type InternalSubscription = {
  type: DomainEventType;
  name: string;
  concurrency: number;
  active: number;
  retry: RetryPolicy;
  handler: (event: DomainEvent) => Promise<void> | void;
};

export type EventServiceOptions = {
  maxQueueSize?: number;
  log?: AppLogger;
};

export class EventService {
  private queues: Map<DomainEventType, DomainEvent[]> = new Map();
  private subs: Map<DomainEventType, InternalSubscription[]> = new Map();
  private drainingWaiters: Map<DomainEventType, Array<() => void>> = new Map();
  private inflightByType: Map<DomainEventType, number> = new Map();
  private maxQueueSize: number;
  private log: AppLogger;
  private stopped: boolean = false;

  constructor(opts?: EventServiceOptions) {
    this.maxQueueSize = opts?.maxQueueSize ?? 1000;
    this.log = opts?.log ?? logger( "event_service" );
  }

  /** Returns current backlog depth (queued + in-flight) for a specific event type. */
  public getBacklogDepth(type: DomainEventType): number {
    return this.getDepth( type );
  }

  /** Returns sum backlog across all types to drive global backpressure decisions. */
  public getTotalBacklogDepth(): number {
    let total = 0;
    for ( const [ type ] of this.queues ) {
      total += this.getDepth( type );
    }
    return total;
  }

  /** Wait until the backlog for given type goes below a threshold (default: maxQueueSize/2). */
  public async waitForCapacity(type: DomainEventType, threshold?: number): Promise<void> {
    const target = Math.max( 0, Math.floor( (threshold ?? (this.maxQueueSize / 2)) ) );
    while ( this.getDepth( type ) > target ) {
      await this.waitForDrain( type );
    }
  }

  subscribe<T extends DomainEventType>(sub: Subscription<T>): void {
    const s: InternalSubscription = {
      type: sub.event,
      name: sub.name || `sub:${ sub.event }`,
      concurrency: sub.concurrency && sub.concurrency > 0 ? sub.concurrency : 1,
      active: 0,
      retry: sub.retry || { maxRetries: 0, backoffMs: () => 0 },
      handler: sub.handler as (e: DomainEvent) => Promise<void> | void,
    };
    const list = this.subs.get( sub.event ) || [];
    list.push( s );
    this.subs.set( sub.event, list );
    if ( !this.queues.has( sub.event ) ) this.queues.set( sub.event, [] );
    if ( !this.drainingWaiters.has( sub.event ) ) this.drainingWaiters.set( sub.event, [] );
    if ( !this.inflightByType.has( sub.event ) ) this.inflightByType.set( sub.event, 0 );
    // Start a dispatcher loop for this type if not already processing
    this.ensureDispatcher( sub.event );
  }

  async publish<E extends DomainEvent>(event: E): Promise<void> {
    if ( this.stopped ) return; // drop new events when stopped
    const type = event.type as DomainEventType;
    if ( !this.queues.has( type ) ) this.queues.set( type, [] );
    if ( !this.drainingWaiters.has( type ) ) this.drainingWaiters.set( type, [] );
    if ( !this.inflightByType.has( type ) ) this.inflightByType.set( type, 0 );
    const q = this.queues.get( type )!;
    // backpressure: wait until there is capacity
    while ( this.getDepth( type ) >= this.maxQueueSize ) {
      await this.waitForDrain( type );
    }
    q.push( event );
    // nudge dispatcher
    this.ensureDispatcher( type );
  }

  private ensureDispatcher(type: DomainEventType): void {
    // Fire-and-forget async loop
    void this.dispatchLoop( type );
  }

  private async dispatchLoop(type: DomainEventType): Promise<void> {
    const q = this.queues.get( type );
    if ( !q ) return;
    // Process until queue is empty at the moment; new items will schedule another tick
    while ( q.length > 0 ) {
      const ev = q.shift() as DomainEvent;
      // Count this event as in-flight to participate in backpressure
      this.inflightByType.set( type, (this.inflightByType.get( type ) || 0) + 1 );
      const subs = this.subs.get( type ) || [];
      if ( subs.length === 0 ) {
        // Nothing to handle; drop
        this.notifyDrain( type );
        // done with this in-flight event
        this.inflightByType.set( type, Math.max( 0, (this.inflightByType.get( type ) || 1) - 1 ) );
        this.notifyDrain( type );
        continue;
      }
      await Promise.all( subs.map( (s) => this.runWithConcurrencyAndRetry( s, ev ) ) );
      this.notifyDrain( type );
      // Finished processing this event across all subs
      this.inflightByType.set( type, Math.max( 0, (this.inflightByType.get( type ) || 1) - 1 ) );
      this.notifyDrain( type );
    }
  }

  private async runWithConcurrencyAndRetry(
    sub: InternalSubscription,
    ev: DomainEvent
  ): Promise<void> {
    // If we have free concurrency slots, run now; else wait until a slot frees
    while ( sub.active >= sub.concurrency ) {
      await this.sleep( 1 );
    }
    sub.active += 1;
    try {
      let attempt = 0;
      for ( ; ; ) {
        try {
          await sub.handler( ev );
          return;
        } catch ( err ) {
          attempt += 1;
          const message = err instanceof Error ? err.message : String( err );
          this.log.warn( {
            type: "event.handler.error",
            sub: sub.name,
            eventType: ev.type,
            attempt,
            message
          } );
          if ( attempt > sub.retry.maxRetries ) {
            this.log.error( {
              type: "event.handler.failed",
              sub: sub.name,
              eventType: ev.type,
              attempts: attempt
            } );
            return;
          }
          const delay = Math.max( 0, sub.retry.backoffMs( attempt ) );
          await this.sleep( delay );
        }
      }
    } finally {
      sub.active -= 1;
    }
  }

  private waitForDrain(type: DomainEventType): Promise<void> {
    return new Promise( (resolve) => {
      const arr = this.drainingWaiters.get( type )!;
      arr.push( resolve );
    } );
  }

  private notifyDrain(type: DomainEventType): void {
    const arr = this.drainingWaiters.get( type );
    if ( !arr || arr.length === 0 ) return;
    const toResolve = arr.splice( 0, arr.length );
    for ( const fn of toResolve ) fn();
  }

  private getDepth(type: DomainEventType): number {
    const q = this.queues.get( type );
    const queued = q ? q.length : 0;
    const inflight = this.inflightByType.get( type ) || 0;
    return queued + inflight;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise( (res) => setTimeout( res, ms ) );
  }

  /**
   * Stop accepting new events and wait until all queues are drained and in-flight handlers complete
   */
  public async waitUntilIdle(checkIntervalMs: number = 10): Promise<void> {
    this.stopped = true;
    for ( ; ; ) {
      let total = 0;
      for ( const [ type ] of this.queues ) {
        total += this.getDepth( type );
      }
      if ( total === 0 ) return;
      await this.sleep( checkIntervalMs );
    }
  }
}


