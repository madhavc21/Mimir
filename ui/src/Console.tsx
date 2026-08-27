import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Home,
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings,
} from 'lucide-react'
import ChatPanel from '@/components/ChatPanel'
import SearchPicker from '@/components/SearchPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_SETTINGS,
  detectProviderFromApiKey,
  formatProviderLabel,
  listModels,
  listProviders,
  loadSettings,
  saveSettings,
  type AppSettings,
  type HotkeyOpens,
  type ModelInfo,
} from '@/lib/settings'
import { formatRecordedHotkey } from '@/lib/hotkey'
import { getModelCache, modelCacheKey, setModelCache } from '@/lib/modelCache'
import { formatThreadDate, listThreads, sortThreads, type ThreadMeta } from '@/lib/chats'
import FeatureGuide from '@/components/FeatureGuide'
import '@/App.css'

type ConsoleSection = 'home' | 'chats' | 'model' | 'system' | 'about'

const NAV: { id: ConsoleSection; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'system', label: 'System', icon: Settings },
  { id: 'about', label: 'About', icon: Info },
]

const SECTION_TITLES: Record<ConsoleSection, string> = {
  home: 'Home',
  chats: 'Chats',
  model: 'Model',
  system: 'System',
  about: 'About',
}

export default function Console() {
  const [section, setSection] = useState<ConsoleSection>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [listenerLive, setListenerLive] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [apiKeySaveMessage, setApiKeySaveMessage] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const apiKeyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apiKeyDirtyRef = useRef(false)
  const [hotkeyInput, setHotkeyInput] = useState(DEFAULT_SETTINGS.hotkey)
  const [recordingHotkey, setRecordingHotkey] = useState(false)
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)
  const [listenerBusy, setListenerBusy] = useState(false)
  const [threads, setThreads] = useState<ThreadMeta[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [chatSessionKey, setChatSessionKey] = useState(0)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [providerFilter, setProviderFilter] = useState('')
  const [providerInput, setProviderInput] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  const refreshListenerStatus = useCallback(async () => {
    const live = await invoke<boolean>('get_listener_status')
    setListenerLive(live)
  }, [])

  const refreshThreads = useCallback(async () => {
    try {
      const list = await listThreads()
      setThreads(list)
    } catch (e) {
      console.error('list_threads failed', e)
    }
  }, [])

  const detectedProvider = detectProviderFromApiKey(apiKeyInput)
  const activeProvider =
    providerInput ?? detectedProvider ?? settings.selectedProvider

  const fetchModels = useCallback(async (providerOverride?: string, force = false) => {
    const provider = providerOverride ?? activeProvider
    if (!settings.apiKey.trim()) {
      setModels([])
      setModelsError('Add your API key below first.')
      return
    }
    if (!provider) {
      setModels([])
      setModelsError('Select a provider (or paste a recognized API key).')
      return
    }

    const cacheKey = modelCacheKey(provider, settings.apiKey)
    const cached = !force ? getModelCache(cacheKey) : null

    if (cached?.fresh) {
      setModels(cached.models)
      setModelsError(null)
      return
    }

    if (cached) {
      setModels(cached.models)
    } else {
      setModelsError(null)
    }
    setModelsLoading(true)

    try {
      const list = await listModels(provider)
      setModelCache(cacheKey, list)
      setModels(list)
      setModelsError(null)
    } catch (e) {
      if (!cached) {
        setModels([])
      }
      setModelsError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelsLoading(false)
    }
  }, [settings.apiKey, activeProvider])

  const loadProviderCatalog = useCallback(async () => {
    try {
      const list = await listProviders()
      setProviders(list)
    } catch (e) {
      console.error('list_providers failed', e)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const loaded = await loadSettings()
      setSettings(loaded)
      setApiKeyInput(loaded.apiKey)
      setProviderInput(loaded.selectedProvider)
      setProviderFilter(
        loaded.selectedProvider ? formatProviderLabel(loaded.selectedProvider) : '',
      )
      setModelFilter(loaded.selectedModel || '')
      setHotkeyInput(loaded.hotkey)
      await refreshListenerStatus()
      await refreshThreads()

      if (loaded.autostart) {
        try {
          const osEnabled = await invoke<boolean>('is_autostart_enabled')
          if (!osEnabled) {
            await invoke('set_autostart', { enabled: true })
          }
        } catch (e) {
          console.error('autostart sync failed', e)
        }
      }
    }
    init()
  }, [refreshListenerStatus, refreshThreads])

  useEffect(() => {
    if (apiKeySaveStatus !== 'saved') return
    const t = window.setTimeout(() => {
      setApiKeySaveStatus('idle')
      setApiKeySaveMessage(null)
    }, 2500)
    return () => window.clearTimeout(t)
  }, [apiKeySaveStatus])

  useEffect(() => {
    if (!recordingHotkey) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setRecordingHotkey(false)
        return
      }
      const combo = formatRecordedHotkey(e)
      if (combo) {
        setHotkeyInput(combo)
        setRecordingHotkey(false)
        setHotkeyError(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [recordingHotkey])

  const selectSection = (id: ConsoleSection) => {
    setSection(id)
    if (id === 'home') refreshListenerStatus()
    if (id === 'chats') refreshThreads()
    if (id === 'model') {
      void loadProviderCatalog()
      if (settings.apiKey && activeProvider) {
        void fetchModels()
      }
    }
  }

  const handleStart = async () => {
    setListenerBusy(true)
    try {
      const live = await invoke<boolean>('start_listener')
      setListenerLive(live)
    } catch (e) {
      console.error(e)
    } finally {
      setListenerBusy(false)
    }
  }

  const handleSleep = async () => {
    setListenerBusy(true)
    try {
      const live = await invoke<boolean>('stop_listener')
      setListenerLive(live)
    } catch (e) {
      console.error(e)
    } finally {
      setListenerBusy(false)
    }
  }

  const doSaveApiKey = useCallback(async (key: string) => {
    const provider = activeProvider
    if (!key.trim() || !provider) return
    setApiKeySaving(true)
    setApiKeySaveStatus('idle')
    setApiKeySaveMessage(null)
    try {
      const modelMatches = settings.selectedModel.startsWith(`${provider}/`)
      const next = await saveSettings({
        apiKey: key.trim(),
        selectedProvider: provider,
        selectedModel: modelMatches ? settings.selectedModel : '',
      })
      setSettings(next)
      setProviderInput(provider)
      setModelsError(null)
      setApiKeySaveStatus('saved')
      setApiKeySaveMessage('Saved')
      void fetchModels(provider)
    } catch (e) {
      setApiKeySaveStatus('error')
      setApiKeySaveMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setApiKeySaving(false)
    }
  }, [activeProvider, settings.selectedModel, fetchModels])

  useEffect(() => {
    if (!apiKeyDirtyRef.current) return
    if (apiKeyDebounceRef.current) window.clearTimeout(apiKeyDebounceRef.current)
    apiKeyDebounceRef.current = window.setTimeout(() => {
      doSaveApiKey(apiKeyInput)
    }, 600)
    return () => {
      if (apiKeyDebounceRef.current) window.clearTimeout(apiKeyDebounceRef.current)
    }
  }, [apiKeyInput, doSaveApiKey])

  const handleProviderChange = async (provider: string) => {
    setProviderInput(provider)
    setProviderFilter(formatProviderLabel(provider))
    const modelMatches = settings.selectedModel.startsWith(`${provider}/`)
    const next = await saveSettings({
      selectedProvider: provider,
      selectedModel: modelMatches ? settings.selectedModel : '',
    })
    setSettings(next)
    setModelFilter('')
    if (settings.apiKey.trim()) void fetchModels(provider)
  }

  const handleModelChange = async (model: string) => {
    setModelFilter(model)
    const next = await saveSettings({ selectedModel: model })
    setSettings(next)
  }

  const handleAutostartChange = async (enabled: boolean) => {
    await invoke('set_autostart', { enabled })
    const next = await saveSettings({ autostart: enabled })
    setSettings(next)
  }

  const handleSaveHotkey = async () => {
    setHotkeyError(null)
    try {
      await invoke('set_hotkey', { hotkey: hotkeyInput })
      const next = await saveSettings({ hotkey: hotkeyInput })
      setSettings(next)
      setRecordingHotkey(false)
    } catch (e) {
      setHotkeyError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleHotkeyOpensChange = async (value: HotkeyOpens) => {
    const next = await saveSettings({ hotkeyOpens: value })
    setSettings(next)
  }

  const handleQuit = () => {
    invoke('quit_app')
  }

  const sortedThreads = sortThreads(threads)
  const isChats = section === 'chats'
  const activeProviderLabel = activeProvider ? formatProviderLabel(activeProvider) : null
  const filteredProviders = providers.filter((p) =>
    p.toLowerCase().includes(providerFilter.toLowerCase()),
  )
  const filteredModels = models.filter((m) =>
    m.id.toLowerCase().includes(modelFilter.toLowerCase()),
  )

  return (
    <div className="console-shell text-foreground">
      <div
        className={`console-sidebar-wrap ${sidebarCollapsed ? 'console-sidebar-wrap--collapsed' : ''}`}
      >
        <aside
          className={`console-sidebar ${sidebarCollapsed ? 'console-sidebar--collapsed' : ''}`}
          aria-label="Console navigation"
        >
          <div className="console-sidebar-brand">
            <img src="/mimir_logo.png" alt="" className="console-sidebar-logo" />
            <div className="console-sidebar-brand-text">
              <span className="console-sidebar-title">ᛗᛁᛗᛁᚱ</span>
              <span className="console-sidebar-sub">Console</span>
            </div>
          </div>

          <nav className="console-sidebar-nav">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`console-nav-item ${section === id ? 'console-nav-item--active' : ''}`}
                onClick={() => selectSection(id)}
                title={label}
                aria-label={label}
                aria-current={section === id ? 'page' : undefined}
              >
                <span className="console-nav-icon">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="console-nav-label">{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <button
          type="button"
          className="console-sidebar-collapse"
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={14} strokeWidth={2} />
          ) : (
            <ChevronLeft size={14} strokeWidth={2} />
          )}
        </button>
      </div>

      <main className={`console-main ${isChats ? 'console-main--chats' : ''}`}>
        {!isChats && (
          <header className="console-main-header">
            <h2 className="console-main-title">{SECTION_TITLES[section]}</h2>
          </header>
        )}

        <div className={`console-content ${isChats ? 'console-content--fill' : ''}`}>
          {section === 'home' && (
            <div className="console-content-inner space-y-4">
              <section className="console-panel console-panel--accent space-y-3">
                <div className="console-status-row">
                  <div className="console-status-label">
                    <span
                      className={`status-dot ${listenerLive ? 'status-dot--live' : 'status-dot--sleep'}`}
                      aria-hidden
                    />
                    <span>{listenerLive ? 'Mimir is live' : 'Mimir is sleeping'}</span>
                  </div>
                  {listenerLive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSleep}
                      disabled={listenerBusy}
                    >
                      Sleep
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleStart} disabled={listenerBusy}>
                      Start listening
                    </Button>
                  )}
                </div>
                <p className="console-panel-desc">
                  {listenerLive
                    ? `Capture hotkey active — press ${settings.hotkey} from any app.`
                    : 'Hotkey capture is paused. Start listening to use Mimir on demand.'}
                </p>
              </section>

              <div className="console-meta-badges">
                <Badge variant={settings.apiKey ? 'default' : 'secondary'}>
                  {activeProviderLabel ?? 'No API key'}
                </Badge>
                <Badge variant="outline">{settings.selectedModel}</Badge>
                <Badge variant="outline">
                  Hotkey opens {settings.hotkeyOpens === 'new' ? 'new chat' : 'latest'}
                </Badge>
              </div>

              <section className="console-panel space-y-3">
                <p className="console-panel-title">Quick start</p>
                <ol className="console-steps">
                  <li>Paste your API key and pick a provider.</li>
                  <li>Pick a model (vision required for screen-region capture).</li>
                  <li>
                    Press <kbd>{settings.hotkey}</kbd> with text selected, or draw a region if
                    nothing is highlighted.
                  </li>
                  <li>Ask a question — context is attached automatically.</li>
                </ol>
              </section>

              <section className="console-panel">
                <FeatureGuide hotkey={settings.hotkey} />
              </section>
            </div>
          )}

          {section === 'chats' && (
            <div className="console-chats-layout">
              <aside className="console-thread-list">
                <div className="console-thread-list-header">
                  <span className="text-sm font-medium text-foreground/90">Threads</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedThreadId(null)
                      setChatSessionKey((k) => k + 1)
                    }}
                  >
                    New
                  </Button>
                </div>
                <div className="console-thread-list-items">
                  {sortedThreads.length === 0 && (
                    <p className="console-thread-empty">
                      No chats yet. Press your hotkey to start one.
                    </p>
                  )}
                  {sortedThreads.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`console-thread-item ${selectedThreadId === t.id ? 'console-thread-item--active' : ''}`}
                      onClick={() => setSelectedThreadId(t.id)}
                    >
                      {t.thumbnailPath && (
                        <img
                          src={convertFileSrc(t.thumbnailPath)}
                          alt=""
                          className="thread-thumb"
                        />
                      )}
                      <span className="console-thread-item-body">
                        <span className="console-thread-name">{t.name}</span>
                        <span className="console-thread-date">
                          {formatThreadDate(t.updatedAt)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
              <div className="console-chat-panel">
                <ChatPanel
                  key={chatSessionKey}
                  threadId={selectedThreadId}
                  onThreadCreated={(id) => {
                    setSelectedThreadId(id)
                    refreshThreads()
                  }}
                  onThreadsChanged={refreshThreads}
                  targetWindow="console"
                  scrollable
                  className="console-chat-panel-inner"
                />
              </div>
            </div>
          )}

          {section === 'model' && (
            <div className="console-content-inner space-y-4">
              <section className="console-panel space-y-4">
                <div>
                  <p className="console-panel-title">Model & API key</p>
                  <p className="console-panel-desc mt-1">
                    Paste your API key, pick a provider (140+ available), then choose a
                    model. Vision models are required for screen-region capture.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api-key">API key</Label>
                  <div className="flex gap-2 max-w-md">
                    <Input
                      id="api-key"
                      type={showApiKey ? 'text' : 'password'}
                      placeholder="Your provider API key"
                      value={apiKeyInput}
                      onChange={(e) => {
                        apiKeyDirtyRef.current = true
                        setApiKeyInput(e.target.value)
                      }}
                    />
                    <Button variant="outline" onClick={() => setShowApiKey((v) => !v)}>
                      {showApiKey ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                  {(apiKeySaving || apiKeySaveMessage || detectedProvider) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {apiKeySaving && (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Loader2 size={13} className="animate-spin" />
                          Saving…
                        </span>
                      )}
                      {!apiKeySaving && apiKeySaveMessage && (
                        <span
                          className={
                            apiKeySaveStatus === 'error'
                              ? 'text-sm text-destructive'
                              : 'text-sm text-[var(--mimir-accent)]'
                          }
                        >
                          {apiKeySaveMessage}
                        </span>
                      )}
                      {detectedProvider && (
                        <Badge variant="outline">
                          Suggested: {formatProviderLabel(detectedProvider)}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                <SearchPicker
                  id="provider-search"
                  label="Provider"
                  placeholder="Search providers…"
                  query={providerFilter}
                  onQueryChange={setProviderFilter}
                  items={filteredProviders}
                  getKey={(p) => p}
                  getLabel={formatProviderLabel}
                  selectedKey={activeProvider}
                  onSelect={(p) => handleProviderChange(p)}
                  emptyMessage={providers.length === 0 ? 'Loading providers…' : 'No providers match'}
                  renderItem={(p) => formatProviderLabel(p)}
                />

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchModels(undefined, true)}
                    disabled={modelsLoading || !settings.apiKey || !activeProvider}
                  >
                    <RefreshCw size={14} className={modelsLoading ? 'animate-spin' : ''} />
                    Refresh models
                  </Button>
                  {modelsLoading}
                </div>
                {modelsError && (
                  <p className="text-sm text-destructive">{modelsError}</p>
                )}
                <SearchPicker
                  id="model-search"
                  label="Model"
                  placeholder="Search models…"
                  query={modelFilter}
                  onQueryChange={setModelFilter}
                  items={filteredModels}
                  getKey={(m) => m.id}
                  getLabel={(m) => m.id}
                  selectedKey={settings.selectedModel || null}
                  onSelect={(m) => handleModelChange(m.id)}
                  disabled={models.length === 0 && !modelsLoading}
                  emptyMessage={
                    modelsLoading
                      ? 'Loading models…'
                      : !settings.apiKey
                        ? 'Save an API key to load models'
                        : !activeProvider
                          ? 'Select a provider first'
                          : 'No models match'
                  }
                  renderItem={(m) => (
                    <span className="search-picker-item-label">{m.id}</span>
                  )}
                />
              </section>
            </div>
          )}

          {section === 'system' && (
            <div className="console-content-inner space-y-4">
              <section className="console-panel divide-y divide-border/50">
                <div className="console-setting-row">
                  <div className="console-setting-copy">
                    <Label>Run on startup</Label>
                    <p className="console-panel-desc">Launch Mimir when you sign in to Windows</p>
                  </div>
                  <Switch
                    checked={settings.autostart}
                    onCheckedChange={handleAutostartChange}
                  />
                </div>

                <div className="console-setting-row">
                  <div className="console-setting-copy">
                    <Label>Hotkey opens</Label>
                    <p className="console-panel-desc">
                      What happens when you press the capture hotkey
                    </p>
                  </div>
                  <Select
                    value={settings.hotkeyOpens}
                    onValueChange={(v) => handleHotkeyOpensChange(v as HotkeyOpens)}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New chat</SelectItem>
                      <SelectItem value="latest">Latest chat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="console-panel space-y-3">
                <div>
                  <Label>Capture hotkey</Label>
                  <p className="console-panel-desc mt-1">
                    Click Record, press your shortcut (include Ctrl, Shift, or Alt), then Save.
                    Windows rejects shortcuts already taken by another app; copy/paste shortcuts
                    like Ctrl+C are separate and usually still work.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-md"
                    value={hotkeyInput}
                    readOnly
                    aria-label="Hotkey"
                  />
                  <Button
                    type="button"
                    variant={recordingHotkey ? 'default' : 'outline'}
                    onClick={() => {
                      setRecordingHotkey((v) => !v)
                      setHotkeyError(null)
                    }}
                  >
                    {recordingHotkey ? 'Press keys… (Esc to cancel)' : 'Record'}
                  </Button>
                  <Button variant="outline" onClick={handleSaveHotkey}>
                    Save hotkey
                  </Button>
                </div>
                {hotkeyError && (
                  <p className="text-sm text-destructive">{hotkeyError}</p>
                )}
              </section>

              <section className="console-panel">
                <Button variant="destructive" onClick={handleQuit}>
                  Quit Mimir
                </Button>
              </section>
            </div>
          )}

          {section === 'about' && (
            <div className="console-content-inner space-y-4">
              <section className="console-panel space-y-2">
                <p className="console-panel-title">Mimir v1.1.1</p>
                <p className="console-panel-desc">
                  A desktop assistant that appears on demand — highlight text or draw a region,
                  press your hotkey, and ask without leaving the app you&apos;re in.
                </p>
              </section>

              <section className="console-panel space-y-3">
                <p className="console-panel-title">The myth</p>
                <p className="console-panel-desc">
                  In Norse mythology, Mímir was the keeper of wisdom. He guarded Mímisbrunnr — the
                  Well of Wisdom beneath the world-tree Yggdrasil — where knowledge pooled in its
                  deepest roots. Odin sacrificed an eye to drink from that well, trading flesh for
                  understanding.
                </p>
                <p className="console-panel-desc">
                  After the war between the Æsir and the Vanir, Mímir was sent as a hostage. The Vanir
                  distrusted him, beheaded him, and returned only his head to Odin. Odin preserved it
                  with herbs and charms. The head lived on — no body, no court, no throne — yet it
                  still spoke. When the gods needed counsel, they came to Mímir&apos;s head.
                </p>
              </section>

              <section className="console-panel space-y-3">
                <p className="console-panel-title">A bodyless entity</p>
                <p className="console-panel-desc">
                  This app takes that shape deliberately. Mimir has no window that sits in your
                  workflow, no body taking up screen estate. It stays out of the way until you call
                  it — then a small card appears at your cursor, answers, and vanishes again.
                </p>
                <p className="console-panel-desc">
                  Like the severed head that saw without standing among the gods, Mimir sees through
                  your context: the text you highlighted, the region you boxed on screen. It does not
                  live inside a document or browser tab. It observes what you point it at and speaks
                  from that view alone.
                </p>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
