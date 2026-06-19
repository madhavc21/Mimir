import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { listen } from '@tauri-apps/api/event'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import {
  createThread,
  loadThread,
  saveThreadMessages,
  type StoredMessage,
} from '@/lib/chats'
import '../App.css'

interface Message {
  id: number
  text: string
  role: 'user' | 'assistant'
}

type ChatStatus = 'idle' | 'pending' | 'streaming'

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
  scrollable = false,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle')

  const inputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const justCreatedRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const pendingSaveThreadRef = useRef<string | null>(null)
  const lastImagePathRef = useRef<string | undefined>(undefined)
  const autoScrollRef = useRef(true)

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
        const payload = JSON.parse(event.payload)
        if (payload.token) {
          setChatStatus('streaming')
          setMessages((prev) => {
            const newMsgs = [...prev]
            const lastMsg = newMsgs[newMsgs.length - 1]
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.text = payload.token
            }
            return newMsgs
          })
        }
      } catch (e) {
        console.error('Failed to parse chunk', e)
      }
    })

    return () => {
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
  }

  useEffect(() => {
    if (autoScrollRef.current || chatStatus === 'streaming' || chatStatus === 'pending') {
      scrollToBottom(chatStatus === 'streaming' ? 'auto' : 'smooth')
    }
  }, [messages, chatStatus])

  useEffect(() => {
    if (focusRequest > 0) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [focusRequest])

  useEffect(() => {
    if (!dirtyRef.current || chatStatus === 'pending') return
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
    if (!text || chatStatus === 'pending') return

    const formattedPrompt = copiedText || copiedImage
      ? `Highlighted Text: ${copiedText}\n\nquestion:\n${text}`
      : text

    const userMsg: Message = { id: Date.now(), text, role: 'user' }
    const placeholderMsg: Message = { id: Date.now() + 1, text: '...', role: 'assistant' }

    const historyForLlm = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }))

    autoScrollRef.current = true
    setMessages((prev) => [...prev, userMsg, placeholderMsg])
    setInput('')
    setChatStatus('pending')
    dirtyRef.current = true
    lastImagePathRef.current = copiedImage || undefined

    let resolvedThreadId = threadId

    try {
      if (!resolvedThreadId) {
        const created = await createThread()
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

      setChatStatus('idle')
    } catch (e) {
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

  const sendDisabled = !input.trim() || chatStatus === 'pending'
  const isDraft = threadId === null && messages.length === 0

  return (
    <div className={`chat-panel ${className}`.trim()}>
      {showContext && (copiedText || copiedImage) && (
        <div className="context-banner">
          <div className="context-banner-header">
            <span className="context-pill">Selected Context</span>
            <button
              type="button"
              className="context-clear"
              onClick={onClearContext}
            >
              ×
            </button>
          </div>
          {copiedText && <div className="context-banner-text">{copiedText}</div>}
          {copiedImage && (
            <div className="context-banner-image">
              <img
                src={convertFileSrc(copiedImage)}
                alt="Context"
              />
            </div>
          )}
        </div>
      )}

      <div
        ref={messagesContainerRef}
        className={`messages-container messages-container--relative ${scrollable ? 'messages-container--scrollable' : ''}`.trim()}
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
                <ReactMarkdown>{m.text}</ReactMarkdown>
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
          disabled={chatStatus === 'pending'}
        />
        <button
          type="button"
          className={`send-button ${input.trim() && chatStatus !== 'pending' ? 'active' : ''}`}
          onClick={send}
          disabled={sendDisabled}
        >
          <Send size={13} color="rgba(255,255,255,0.85)" />
        </button>
      </div>
    </div>
  )
}
