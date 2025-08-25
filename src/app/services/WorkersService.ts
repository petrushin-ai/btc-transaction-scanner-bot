import type { WatchedAddress } from "@/types/blockchain";

function hashToBigInt(input: string): bigint {
  // Simple FNV-1a 64-bit hash implementation for deterministic scoring
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for ( let i = 0; i < input.length; i++ ) {
    hash ^= BigInt( input.charCodeAt( i ) );
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * Rendezvous (HRW) hashing-based worker assignment.
 * Given a stable set of worker IDs, consistently assigns an address to exactly one worker.
 */
export class WorkersService {
  private readonly selfId: string;
  private readonly members: string[];

  constructor(selfId: string, members: string[]) {
    if ( !selfId ) throw new Error( "WorkersService requires selfId" );
    if ( !members || members.length === 0 ) members = [ selfId ];
    this.selfId = selfId;
    this.members = Array.from( new Set( members ) );
    if ( !this.members.includes( selfId ) ) this.members.push( selfId );
  }

  /** Returns the worker id responsible for a given key (e.g., address). */
  assign(key: string): string {
    let bestMember = this.members[0];
    let bestScore = -1n;
    for ( const m of this.members ) {
      const score = hashToBigInt( `${ key }::${ m }` );
      if ( score > bestScore ) {
        bestScore = score;
        bestMember = m;
      }
    }
    return bestMember;
  }

  isResponsibleForAddress(address: string): boolean {
    return this.assign( address ) === this.selfId;
  }

  filterWatched(watch: WatchedAddress[]): WatchedAddress[] {
    return watch.filter( (w) => this.isResponsibleForAddress( w.address ) );
  }
}


