import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, History, Maximize2, Minimize2 } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import ChatPanel from '@/components/ChatPanel'
import {
  formatThreadDate,
  listThreads,
  sortThreads,
  type ThreadMeta,
} from '@/lib/chats'
import { loadSettings } from '@/lib/settings'
import './App.css'

export default function App() {
  const [copiedText, setCopiedText] = useState('')
  const [copiedImage, setCopiedImage] = useState('')
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [chatSessionKey, setChatSessionKey] = useState(0)
  const [isLocked, setIsLocked] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  const [threads, setThreads] = useState<ThreadMeta[]>([])
  const [ghostMessage, setGhostMessage] = useState<string | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  const refreshThreads = useCallback(async () => {
    try {
      const list = await listThreads()
      setThreads(sortThreads(list))
    } catch (e) {
      console.error('list_threads failed', e)
    }
  }, [])

  const startNewChat = useCallback(() => {
    setActiveThreadId(null)
    setChatSessionKey((k) => k + 1)
    setShowHistory(false)
    setFocusRequest((n) => n + 1)
  }, [])

  const applyCaptureContext = useCallback(
    async (text?: string, image?: string) => {
      const settings = await loadSettings()

      if (!isLocked) {
        if (settings.hotkeyOpens === 'latest') {
          try {
            const list = await listThreads()
            const latest = sortThreads(list)[0]
            setActiveThreadId(latest?.id ?? null)
          } catch (e) {
            console.error('list_threads failed', e)
            startNewChat()
          }
        } else {
          startNewChat()
        }
      }

      if (text) {
        setCopiedText(text)
        setCopiedImage('')
      }
      if (image) {
        setCopiedImage(image)
        setCopiedText('')
      }

      setFocusRequest((n) => n + 1)
    },
    [isLocked, startNewChat],
  )

  useEffect(() => {
    const init = async () => {
      try {
        const [locked, expanded] = await invoke<[boolean, boolean]>('get_card_state')
        setIsLocked(locked)
        setIsExpanded(expanded)
      } catch (e) {
        console.error('get_card_state failed', e)
      }
      await refreshThreads()
    }
    init()
  }, [refreshThreads])

  useEffect(() => {
    if (!ghostMessage) return
    const timer = setTimeout(() => setGhostMessage(null), 1000)
    return () => clearTimeout(timer)
  }, [ghostMessage])

  useEffect(() => {
    if (!showHistory) return
    const onDocClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showHistory])

  useEffect(() => {
    const unlistenText = listen<string>('capture-text', (event) => {
      try {
        const payload = JSON.parse(event.payload)
        if (payload.status === 'success' && payload.result) {
          applyCaptureContext(payload.result)
        } else if (payload.status === 'error' && payload.message) {
          setGhostMessage(String(payload.message))
        }
      } catch {
        applyCaptureContext(event.payload)
      }
    })

    const unlistenScreen = listen<string>('capture-screen', (event) => {
      try {
        const payload = JSON.parse(event.payload)
        if (payload.status === 'success' && payload.result) {
          applyCaptureContext(undefined, payload.result)
        }
      } catch (e) {
        console.error('Failed to parse screen capture', e)
      }
    })

    const unlistenReset = listen('session-reset', () => {
      startNewChat()
      setCopiedText('')
      setCopiedImage('')
    })

    const unlistenLock = listen<boolean>('card-lock-changed', (event) => {
      setIsLocked(event.payload)
    })

    const unlistenExpand = listen<boolean>('card-expanded-changed', (event) => {
      setIsExpanded(event.payload)
    })

    return () => {
      unlistenText.then((fn) => fn())
      unlistenScreen.then((fn) => fn())
      unlistenReset.then((fn) => fn())
      unlistenLock.then((fn) => fn())
      unlistenExpand.then((fn) => fn())
    }
  }, [applyCaptureContext, startNewChat])

  const openConsole = async () => {
    try {
      await invoke('open_console')
    } catch (e) {
      console.error('open_console failed', e)
    }
  }

  const setCardLocked = async (locked: boolean) => {
    try {
      await invoke('set_card_locked', { locked })
      setIsLocked(locked)
      setGhostMessage(locked ? 'Locked' : 'Unlocked')
    } catch (e) {
      console.error('set_card_locked failed', e)
    }
  }

  const toggleLock = () => setCardLocked(!isLocked)

  const toggleExpanded = async () => {
    try {
      const expanded = await invoke<boolean>('toggle_card_expanded')
      setIsExpanded(expanded)
    } catch (e) {
      console.error('toggle_card_expanded failed', e)
    }
  }

  const selectThread = (id: string) => {
    setActiveThreadId(id)
    setShowHistory(false)
    setFocusRequest((n) => n + 1)
  }

  const handleHeaderMouseDown = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    const target = e.target as HTMLElement
    if (target.closest('button, .history-dropdown, [data-header-no-drag]')) {
      return
    }

    if (e.detail === 2) {
      e.preventDefault()
      toggleLock()
      return
    }

    if (e.detail === 1) {
      try {
        await getCurrentWindow().startDragging()
      } catch (err) {
        console.error('startDragging failed', err)
      }
    }
  }

  return (
    <div className="window-viewport">
      <div className="chat-card" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header" onMouseDown={handleHeaderMouseDown}>
          <button
            type="button"
            className="header-brand"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              openConsole()
            }}
            title="Open Console"
            aria-label="Open Console"
          >
            <img src="/mimir_logo.png" alt="" className="header-logo" />
            <span className="header-title">ᛗᛁᛗᛁᚱ</span>
          </button>
          <div className="chat-header-spacer" aria-hidden="true" />
          <button
            type="button"
            className="icon-button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              startNewChat()
            }}
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={15} strokeWidth={2} />
          </button>
          <div className="history-menu-wrap" ref={historyRef} data-header-no-drag>
            <button
              type="button"
              className={`icon-button ${showHistory ? 'icon-button--active' : ''}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={async (e) => {
                e.stopPropagation()
                if (!showHistory) await refreshThreads()
                setShowHistory((v) => !v)
              }}
              title="Chat history"
              aria-label="Chat history"
              aria-expanded={showHistory}
            >
              <History size={15} strokeWidth={2} />
            </button>
            {showHistory && (
              <div className="history-dropdown">
                {threads.length === 0 ? (
                  <p className="history-dropdown-empty">No chats yet</p>
                ) : (
                  threads.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`history-dropdown-item ${activeThreadId === t.id ? 'history-dropdown-item--active' : ''}`}
                      onClick={() => selectThread(t.id)}
                    >
                      {t.thumbnailPath && (
                        <img
                          src={convertFileSrc(t.thumbnailPath)}
                          alt=""
                          className="thread-thumb"
                        />
                      )}
                      <span className="history-dropdown-item-body">
                        <span className="history-dropdown-name">{t.name}</span>
                        <span className="history-dropdown-date">
                          {formatThreadDate(t.updatedAt)}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`icon-button ${isExpanded ? 'icon-button--active' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleExpanded()
            }}
            title={isExpanded ? 'Restore size' : 'Expand to monitor'}
            aria-label={isExpanded ? 'Restore size' : 'Expand to monitor'}
          >
            {isExpanded ? (
              <Minimize2 size={15} strokeWidth={2} />
            ) : (
              <Maximize2 size={15} strokeWidth={2} />
            )}
          </button>
        </div>

        <div className="chat-body">
          <ChatPanel
            key={chatSessionKey}
            threadId={activeThreadId}
            onThreadCreated={setActiveThreadId}
            onThreadsChanged={refreshThreads}
            copiedText={copiedText}
            copiedImage={copiedImage}
            onClearContext={() => {
              setCopiedText('')
              setCopiedImage('')
            }}
            showContext
            targetWindow="main"
            focusRequest={focusRequest}
            ghostMessage={ghostMessage}
          />
        </div>
      </div>
    </div>
  )
}
