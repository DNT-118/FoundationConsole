import { create } from 'zustand'

export interface SlServerEvent {
  id: string
  serverId: string
  event: string
  utc: string
  data: Record<string, unknown>
}

export type EventStreamState = 'idle' | 'connecting' | 'connected' | 'disconnected'

interface EventStatus {
  state: EventStreamState
  message?: string
}

interface WsEventsState {
  byServer: Record<string, SlServerEvent[]>
  statusByServer: Record<string, EventStatus>
  append: (event: Omit<SlServerEvent, 'id'>) => void
  setStatus: (serverId: string, state: EventStreamState, message?: string) => void
  clear: (serverId: string) => void
  reset: () => void
}

const MAX_EVENTS_PER_SERVER = 250
let eventSequence = 0

/** 仅保存当前浏览器会话中的实时事件；刷新后不恢复，避免把旧事件误当成实时状态。 */
export const useWsEventsStore = create<WsEventsState>()((set) => ({
  byServer: {},
  statusByServer: {},
  append: (event) =>
    set((state) => {
      const current = state.byServer[event.serverId] ?? []
      const next: SlServerEvent = {
        ...event,
        id: `${event.serverId}:${event.utc}:${eventSequence++}`,
      }
      return {
        byServer: {
          ...state.byServer,
          [event.serverId]: [next, ...current].slice(0, MAX_EVENTS_PER_SERVER),
        },
      }
    }),
  setStatus: (serverId, streamState, message) =>
    set((state) => ({
      statusByServer: {
        ...state.statusByServer,
        [serverId]: { state: streamState, message },
      },
    })),
  clear: (serverId) =>
    set((state) => ({
      byServer: { ...state.byServer, [serverId]: [] },
    })),
  reset: () => set({ byServer: {}, statusByServer: {} }),
}))
