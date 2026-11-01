import type { ServerState } from '@/types/api'

export interface ServerSnapshotOptions {
  signal?: AbortSignal
}

/**
 * Pluggable data source abstraction.
 * Implementations: SLDataAPI (GitHub), Local API, Server API.
 * The UI only ever depends on this interface, so swapping backends
 * is a configuration change, not a code change.
 */
export interface DataSource {
  readonly id: string
  readonly label: string
  fetchServer(id: string, opts?: ServerSnapshotOptions): Promise<ServerState>
}
