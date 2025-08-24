import fs from "fs";
import path from "path";

import { logger } from "@/infrastructure/logger";

export type FeatureFlags = {
  parseRawBlocks: boolean;
  resolveInputAddresses: boolean;
};

export type FeatureFlagsSource = {
  filePath?: string;
  reloadIntervalMs?: number;
};

type Listener = (flags: FeatureFlags) => void;

/**
 * Centralized feature flags with optional file-based live reload.
 *
 * File format (JSON):
 * {
 *   "parseRawBlocks": true,
 *   "resolveInputAddresses": false
 * }
 */
export class FeatureFlagsService {
  private current: FeatureFlags;
  private listeners: Set<Listener> = new Set();
  private timer?: NodeJS.Timer;
  private readonly log = logger( "feature_flags" );
  private readonly source?: FeatureFlagsSource;
  private lastLoadedContent?: string;

  constructor(initial: FeatureFlags, source?: FeatureFlagsSource) {
    this.current = { ...initial };
    this.source = normalizeSource( source );
    if ( this.source?.filePath ) {
      this.startWatcher( this.source.filePath, this.source.reloadIntervalMs ?? 2000 );
    }
  }

  getFlags(): FeatureFlags {
    return { ...this.current };
  }

  update(partial: Partial<FeatureFlags>): void {
    const next = { ...this.current, ...partial } as FeatureFlags;
    if ( !deepEqualFlags( this.current, next ) ) {
      this.current = next;
      this.emit();
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add( listener );
    return () => this.listeners.delete( listener );
  }

  dispose(): void {
    if ( this.timer ) clearInterval( this.timer );
    this.timer = undefined;
    this.listeners.clear();
  }

  private emit(): void {
    for ( const l of this.listeners ) {
      try {
        l( { ...this.current } );
      } catch { /* ignore */
      }
    }
  }

  private startWatcher(filePath: string, intervalMs: number): void {
    try {
      const absolute = path.isAbsolute( filePath )
        ? filePath
        : path.join( process.cwd(), filePath
        );
      this.timer = setInterval( () => {
        try {
          if ( !fs.existsSync( absolute ) ) return;
          const content = fs.readFileSync( absolute, "utf8" );
          if ( content === this.lastLoadedContent ) return;
          this.lastLoadedContent = content;
          const json = JSON.parse( content || "{}" ) as Partial<FeatureFlags>;
          const next: FeatureFlags = {
            parseRawBlocks: typeof json.parseRawBlocks === "boolean"
              ? json.parseRawBlocks
              : this.current.parseRawBlocks,
            resolveInputAddresses: typeof json.resolveInputAddresses === "boolean"
              ? json.resolveInputAddresses
              : this.current.resolveInputAddresses,
          };
          if ( !deepEqualFlags( this.current, next ) ) {
            this.current = next;
            this.log.info( {
              type: "flags.updated",
              source: "file",
              filePath: absolute,
              flags: next
            } );
            this.emit();
          }
        } catch ( err ) {
          const message = err instanceof Error ? err.message : String( err );
          this.log.warn( { type: "flags.reload_error", msg: message } );
        }
      }, intervalMs );
      // Do not keep process alive because of the timer
      this.timer.unref?.();
      this.log.info( { type: "flags.watching", filePath: absolute, intervalMs } );
    } catch ( err ) {
      const message = err instanceof Error ? err.message : String( err );
      this.log.warn( { type: "flags.watch_error", msg: message } );
    }
  }
}

function deepEqualFlags(a: FeatureFlags, b: FeatureFlags): boolean {
  return a.parseRawBlocks === b.parseRawBlocks
    && a.resolveInputAddresses === b.resolveInputAddresses;
}

function normalizeSource(src?: FeatureFlagsSource): FeatureFlagsSource | undefined {
  const fromEnv = process.env.FEATURE_FLAGS_FILE?.toString().trim();
  const filePath = src?.filePath || (fromEnv && fromEnv.length > 0 ? fromEnv : undefined);
  const reloadIntervalMs = src?.reloadIntervalMs
    ?? (process.env.FEATURE_FLAGS_RELOAD_MS
      ? Number( process.env.FEATURE_FLAGS_RELOAD_MS )
      : undefined);
  if ( !filePath ) return undefined;
  return { filePath, reloadIntervalMs };
}


