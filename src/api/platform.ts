import { requestJson } from './request'
/**
 * 平台后端 API 客户端（/api/*）。
 * 统一封装：JSON 序列化、会话 token、错误翻译。
 * 所有业务错误（success:false）抛 Error(message)。
 */
export const API_BASE = '/api'

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  token?: string
}

export async function api<T = { success: boolean; message?: string }>(
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`

  return requestJson<T>(API_BASE + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

/** 公告配置（服务端存储，双语标题/正文；管理员在设置中维护）。 */
export interface AnnouncementData {
  enabled: boolean
  popupEnabled: boolean
  version: number
  title: { zh: string; en: string }
  content: { zh: string; en: string }
  updatedAt: number
}

/** 读取公告配置（需登录；管理员与普通用户同源）。 */
export async function getAnnouncement(token?: string): Promise<AnnouncementData> {
  const r = await api<{ announcement: AnnouncementData }>('/announcement', { token })
  return r.announcement
}

/** 保存公告配置（仅管理员；内容变更时服务端自动提升 version）。 */
export async function saveAnnouncement(data: AnnouncementData, token?: string): Promise<AnnouncementData> {
  const r = await api<{ announcement: AnnouncementData }>('/admin/announcement', {
    method: 'PUT', token, body: data,
  })
  return r.announcement
}

/** 正式公告页条目（多公告，markdown 内容）。 */
export interface AnnouncementItem {
  id: string
  title: string
  content: string
  author: string
  createdAt: number
}

/** 公告列表（按创建时间倒序）。 */
export async function getAnnouncements(token?: string): Promise<AnnouncementItem[]> {
  const r = await api<{ items: AnnouncementItem[] }>('/announcements', { token })
  return r.items
}

/** 新增公告（仅管理员）。 */
export async function addAnnouncement(data: { title: string; content: string }, token?: string): Promise<AnnouncementItem> {
  const r = await api<{ item: AnnouncementItem }>('/admin/announcements', { method: 'POST', token, body: data })
  return r.item
}

/** 删除公告（仅管理员）。 */
export async function deleteAnnouncement(id: string, token?: string): Promise<void> {
  await api(`/admin/announcements/${encodeURIComponent(id)}`, { method: 'DELETE', token })
}

/** 关于页内容（鸣谢/赞助，管理员可改）。 */
export interface AboutData {
  thanks: string[]
  sponsors: string[]
}

export async function getAbout(token?: string): Promise<AboutData> {
  const r = await api<{ about: AboutData }>('/about', { token })
  return r.about
}

export async function saveAbout(data: AboutData, token?: string): Promise<AboutData> {
  const r = await api<{ about: AboutData }>('/admin/about', { method: 'PUT', token, body: data })
  return r.about
}
