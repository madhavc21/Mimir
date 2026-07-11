import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { listen } from '@tauri-apps/api/event'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import {
  createThread,
  loadThread,
  saveThreadMessages,
  threadNameFromContext,
  type StoredMessage,
} from '@/lib/chats'
import '../App.css'

interface Message {
  id: number
  text: string
  role: 'user' | 'assistant'
}

type ChatStatus = 'idle' | 'pending' | 'streaming'

const STREAM_IDLE_MS = 600
const CONTEXT_PREVIEW_LEN = 32

function contextPreview(text: string, image: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed) {
    return trimmed.length <= CONTEXT_PREVIEW_LEN
      ? trimmed
      : `${trimmed.slice(0, CONTEXT_PREVIEW_LEN).trimEnd()}…`
  }
  if (image) return 'Screenshot'
  return 'Context'
}

export interface ChatPanelProps {
  threadId: string | null
  onThreadCreated: (id: string) => void
  onThreadsChanged?: () => void
  copiedText?: string
  copiedImage?: string
  onClearContext?: () => void
  showContext?: boolean
  targetWindow?: string
  focusRequest?: number
  className?: string
  ghostMessage?: string | null
  scrollable?: boolean
}

function storedToMessages(stored: StoredMessage[]): Message[] {
  return stored.map((m, i) => {
    const ms = Number(m.createdAt)
    const ts = Number.isNaN(ms) ? Date.parse(m.createdAt) : ms
    return {
      id: ts + i,
      text: m.content,
      role: m.role,
    }
  })
}

function messagesToStored(messages: Message[]): StoredMessage[] {
  const now = Date.now()
  return messages
    .filter((m) => m.text !== '...')
    .map((m, i) => ({
      role: m.role,
      content: m.text,
      createdAt: new Date(now + i).toISOString(),
    }))
}

export default function ChatPanel({
  threadId,
  onThreadCreated,
  onThreadsChanged,
  copiedText = '',
  copiedImage = '',
  onClearContext,
  showContext = false,
  targetWindow = 'main',
  focusRequest = 0,
  className = '',
  ghostMessage = null,
  scrollable: _scrollable = false,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle')
  const [contextMinimized, setContextMinimized] = useState(false)

  const hasContext = Boolean(copiedText || copiedImage)

  const inputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const justCreatedRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const pendingSaveThreadRef = useRef<string | null>(null)
  const lastImagePathRef = useRef<string | undefined>(undefined)
  const autoScrollRef = useRef(true)
  const streamIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearStreamIdleTimer = () => {
    if (streamIdleTimerRef.current) {
      clearTimeout(streamIdleTimerRef.current)
      streamIdleTimerRef.current = null
    }
  }

  const scheduleStreamEnd = () => {
    clearStreamIdleTimer()
    streamIdleTimerRef.current = setTimeout(() => {
      streamIdleTimerRef.current = null
      setChatStatus('idle')
    }, STREAM_IDLE_MS)
  }

  useEffect(() => {
    if (hasContext) setContextMinimized(false)
  }, [copiedText, copiedImage])

  useEffect(() => {
    if (threadId !== null && threadId === justCreatedRef.current) {
      justCreatedRef.current = null
      return
    }

    let cancelled = false

    async function load() {
      if (threadId === null) {
        setMessages([])
        setInput('')
        setChatStatus('idle')
        dirtyRef.current = false
        autoScrollRef.current = true
        return
      }

      try {
        const thread = await loadThread(threadId)
        if (!cancelled) {
          setMessages(storedToMessages(thread.messages))
          setInput('')
          setChatStatus('idle')
          autoScrollRef.current = true
        }
      } catch (e) {
        console.error('load_thread failed', e)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [threadId])

  useEffect(() => {
    const unlistenChunk = listen<string>('chat-stream-chunk', (event) => {
      try {
        const payload = JSON.parse(event.payload) as {
          token?: string
          status?: string
          message?: string
        }

        if (payload.status === 'error') {
          clearStreamIdleTimer()
          const errText = payload.message ?? 'Stream error'
          setMessages((prev) => {
            const newMsgs = [...prev]
            const lastMsg = newMsgs[newMsgs.length - 1]
            if (lastMsg?.role === 'assistant') {
              lastMsg.text = errText
            }
            return newMsgs
          })
          setChatStatus('idle')
          return
        }

        if (payload.token !== undefined) {
          setChatStatus('streaming')
          setMessages((prev) => {
            const newMsgs = [...prev]
            const lastMsg = newMsgs[newMsgs.length - 1]
            if (lastMsg?.role === 'assistant') {
              lastMsg.text = payload.token!
            }
            return newMsgs
          })
          scheduleStreamEnd()
        }
      } catch (e) {
        console.error('Failed to parse chunk', e)
      }
    })

    return () => {
      clearStreamIdleTimer()
      unlistenChunk.then((unlisten) => unlisten())
    }
  }, [])

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    autoScrollRef.current = distanceFromBottom < 48
    if (hasContext && !contextMinimized) setContextMinimized(true)
  }

  useEffect(() => {
    if (chatStatus === 'pending' || chatStatus === 'streaming') {
      if (hasContext) setContextMinimized(true)
    }
    if (autoScrollRef.current || chatStatus === 'streaming' || chatStatus === 'pending') {
      scrollToBottom(chatStatus === 'streaming' ? 'auto' : 'smooth')
    }
  }, [messages, chatStatus, hasContext])

  useEffect(() => {
    if (focusRequest > 0) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [focusRequest])

  useEffect(() => {
    if (!dirtyRef.current || chatStatus === 'pending' || chatStatus === 'streaming') return
    const saveId = pendingSaveThreadRef.current ?? threadId
    if (!saveId || messages.length === 0) return

    const last = messages[messages.length - 1]
    if (last?.role !== 'assistant' || last.text === '...') return

    const timer = setTimeout(() => {
      const stored = messagesToStored(messages)
      const lastUser = [...stored].reverse().find((m) => m.role === 'user')
      if (lastUser && lastImagePathRef.current) {
        lastUser.imagePath = lastImagePathRef.current
      }
      saveThreadMessages(saveId, stored)
        .then(() => {
          dirtyRef.current = false
          pendingSaveThreadRef.current = null
          lastImagePathRef.current = undefined
          onThreadsChanged?.()
        })
        .catch((e) => console.error('save_thread_messages failed', e))
    }, 400)

    return () => clearTimeout(timer)
  }, [messages, threadId, chatStatus, onThreadsChanged])

  const send = async () => {
    const text = input.trim()
    if (!text || chatStatus === 'pending' || chatStatus === 'streaming') return

    const formattedPrompt = copiedText || copiedImage
      ? `Highlighted Text: ${copiedText}\n\nquestion:\n${text}`
      : text

    const userMsg: Message = { id: Date.now(), text, role: 'user' }
    const placeholderMsg: Message = { id: Date.now() + 1, text: '...', role: 'assistant' }

    const historyForLlm = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }))

    clearStreamIdleTimer()
    autoScrollRef.current = true
    setMessages((prev) => [...prev, userMsg, placeholderMsg])
    setInput('')
    setChatStatus('pending')
    dirtyRef.current = true
    lastImagePathRef.current = copiedImage || undefined

    let resolvedThreadId = threadId

    try {
      if (!resolvedThreadId) {
        const isFirstSend = messages.length === 0
        const created = await createThread({
          name: isFirstSend ? threadNameFromContext(copiedText) : undefined,
          thumbnailPath: isFirstSend && copiedImage ? copiedImage : undefined,
        })
        resolvedThreadId = created.id
        justCreatedRef.current = created.id
        pendingSaveThreadRef.current = created.id
        onThreadCreated(created.id)
      } else {
        pendingSaveThreadRef.current = resolvedThreadId
      }

      await invoke('stream_from_python', {
        message: formattedPrompt,
        imagePath: copiedImage || null,
        history: historyForLlm,
        targetWindow,
      })
    } catch (e) {
      clearStreamIdleTimer()
      const errMsg = e instanceof Error ? e.message : String(e)
      setMessages((prev) => {
        const newMsgs = [...prev]
        const lastMsg = newMsgs[newMsgs.length - 1]
        if (lastMsg?.role === 'assistant') {
          lastMsg.text = errMsg
        }
        return newMsgs
      })
      setChatStatus('idle')
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isStreaming = chatStatus === 'pending' || chatStatus === 'streaming'
  const sendDisabled = !input.trim() || isStreaming
  const isDraft = threadId === null && messages.length === 0

  return (
    <div className={`chat-panel ${className}`.trim()}>
      {showContext && hasContext && (
        <div className={`context-banner ${contextMinimized ? 'context-banner--minimized' : ''}`}>
          <div className="context-banner-header">
            <button
              type="button"
              className="context-toggle"
              onClick={() => setContextMinimized((v) => !v)}
              aria-expanded={!contextMinimized}
            >
              {contextMinimized ? (
                <ChevronDown size={12} strokeWidth={2.5} aria-hidden />
              ) : (
                <ChevronUp size={12} strokeWidth={2.5} aria-hidden />
              )}
              <span className="context-pill">Context</span>
              {contextMinimized && (
                <span className="context-preview">{contextPreview(copiedText, copiedImage)}</span>
              )}
              {contextMinimized && copiedImage && (
                <img
                  src={convertFileSrc(copiedImage)}
                  alt=""
                  className="context-thumb-mini"
                />
              )}
            </button>
            <button
              type="button"
              className="context-clear"
              onClick={onClearContext}
              aria-label="Clear context"
            >
              ×
            </button>
          </div>
          {!contextMinimized && (
            <div className="context-banner-body">
              {copiedText && <div className="context-banner-text">{copiedText}</div>}
              {copiedImage && (
                <div className="context-banner-image">
                  <img src={convertFileSrc(copiedImage)} alt="Context" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div
        ref={messagesContainerRef}
        className="messages-container messages-container--relative"
        onScroll={handleMessagesScroll}
      >
        {isDraft && <p className="new-chat-watermark">new chat</p>}
        {ghostMessage && <p className="chat-ghost-toast">{ghostMessage}</p>}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`message-row ${m.role === 'user' ? 'user-row' : 'assistant-row'}`}
          >
            <div className={`message-bubble ${m.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>
              {m.role === 'assistant' ? (
                m.text === '...' ? (
                  <span className="typing-dots" aria-label="Thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                )
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-footer">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message…"
          disabled={isStreaming}
        />
        <button
          type="button"
          className={`send-button ${input.trim() && !isStreaming ? 'active' : ''}`}
          onClick={send}
          disabled={sendDisabled}
        >
          <Send size={13} color="rgba(255,255,255,0.85)" />
        </button>
      </div>
    </div>
  )
}
