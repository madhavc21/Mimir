import { invoke } from '@tauri-apps/api/core'

export interface ThreadMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  imagePath?: string
  createdAt: string
}

export interface Thread extends ThreadMeta {
  messages: StoredMessage[]
}

export async function listThreads(): Promise<ThreadMeta[]> {
  return invoke<ThreadMeta[]>('list_threads')
}

export async function loadThread(id: string): Promise<Thread> {
  return invoke<Thread>('load_thread', { id })
}

export async function createThread(): Promise<ThreadMeta> {
  return invoke<ThreadMeta>('create_thread')
}

export async function saveThreadMessages(
  id: string,
  messages: StoredMessage[],
): Promise<void> {
  return invoke('save_thread_messages', { id, messages })
}

function threadSortKey(t: ThreadMeta): number {
  const ms = Number(t.updatedAt)
  return Number.isNaN(ms) ? new Date(t.updatedAt).getTime() : ms
}

export function sortThreads(threads: ThreadMeta[]): ThreadMeta[] {
  return [...threads].sort((a, b) => threadSortKey(b) - threadSortKey(a))
}

export function latestThread(threads: ThreadMeta[]): ThreadMeta | null {
  const sorted = sortThreads(threads)
  return sorted[0] ?? null
}

export function formatThreadDate(iso: string): string {
  const ms = Number(iso)
  const d = Number.isNaN(ms) ? new Date(iso) : new Date(ms)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
