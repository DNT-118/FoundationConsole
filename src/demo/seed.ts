import { useServersStore } from '@/store/serversStore'
import { DEMO_URL_PREFIX } from './mode'

const SEEDED_KEY = 'fdc-demo.seeded'

/** 演示版首次打开时，自动添加一台本地模拟服务器，方便直接体验。只做一次。 */
export function seedDemoServer(): void {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return
    localStorage.setItem(SEEDED_KEY, '1')
  } catch {
    return
  }
  const { servers, add } = useServersStore.getState()
  if (servers.length > 0) return
  add({
    label: '演示服务器（模拟）',
    baseUrl: `${DEMO_URL_PREFIX}sample`,
    token: 'demo',
    refetchInterval: 3000,
  })
}
