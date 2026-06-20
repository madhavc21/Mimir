import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ChatPanel from '@/components/ChatPanel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_SETTINGS,
  GEMINI_MODELS,
  loadSettings,
  saveSettings,
  type AppSettings,
  type HotkeyOpens,
} from '@/lib/settings'
import { formatThreadDate, listThreads, sortThreads, type ThreadMeta } from '@/lib/chats'
import '@/App.css'

export default function Console() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [listenerLive, setListenerLive] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [hotkeyInput, setHotkeyInput] = useState(DEFAULT_SETTINGS.hotkey)
  const [listenerBusy, setListenerBusy] = useState(false)
  const [threads, setThreads] = useState<ThreadMeta[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [chatSessionKey, setChatSessionKey] = useState(0)

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

  useEffect(() => {
    const init = async () => {
      const loaded = await loadSettings()
      setSettings(loaded)
      setApiKeyInput(loaded.geminiApiKey)
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

  const handleSaveApiKey = async () => {
    const next = await saveSettings({ geminiApiKey: apiKeyInput })
    setSettings(next)
  }

  const handleModelChange = async (model: string) => {
    const next = await saveSettings({ geminiModel: model })
    setSettings(next)
  }

  const handleAutostartChange = async (enabled: boolean) => {
    await invoke('set_autostart', { enabled })
    const next = await saveSettings({ autostart: enabled })
    setSettings(next)
  }

  const handleSaveHotkey = async () => {
    const next = await saveSettings({ hotkey: hotkeyInput })
    setSettings(next)
  }

  const handleHotkeyOpensChange = async (value: HotkeyOpens) => {
    const next = await saveSettings({ hotkeyOpens: value })
    setSettings(next)
  }

  const handleQuit = () => {
    invoke('quit_app')
  }

  const sortedThreads = sortThreads(threads)

  return (
    <div className="min-h-screen bg-[#0b0b10] text-foreground p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex items-center gap-3">
          <img src="/mimir_logo.png" alt="" className="h-8 w-8 object-contain" />
          <div>
            <h1 className="text-xl font-semibold">Mimir</h1>
            <p className="text-sm text-muted-foreground">Console</p>
          </div>
        </header>

        <Tabs
          defaultValue="home"
          onValueChange={(v) => {
            if (v === 'home') refreshListenerStatus()
            if (v === 'chats') refreshThreads()
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="api">API Keys</TabsTrigger>
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="space-y-4 pt-2">
            <section className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block size-2.5 rounded-full ${listenerLive ? 'bg-green-500' : 'bg-muted-foreground'}`}
                  />
                  <span className="font-medium">
                    {listenerLive ? 'Mimir is Live' : 'Mimir is Sleeping'}
                  </span>
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
                    Start
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {listenerLive
                  ? `Hotkey active (${settings.hotkey})`
                  : 'Not listening for hotkey'}
              </p>
            </section>

            <section className="flex flex-wrap gap-2">
              <Badge variant={settings.geminiApiKey ? 'default' : 'secondary'}>
                API key {settings.geminiApiKey ? 'set' : 'missing'}
              </Badge>
              <Badge variant="outline">Model: {settings.geminiModel}</Badge>
            </section>

            <section className="text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">How to use</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Set your Gemini API key in the API Keys tab.</li>
                <li>Select text anywhere, press {settings.hotkey}.</li>
                <li>Ask Mimir about the captured context.</li>
              </ol>
            </section>
          </TabsContent>

          <TabsContent value="chats" className="pt-2">
            <div className="console-chats-layout rounded-lg border border-border overflow-hidden">
              <aside className="console-thread-list">
                <div className="console-thread-list-header">
                  <span className="text-sm font-medium">Threads</span>
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
                    <p className="console-thread-empty">No chats yet</p>
                  )}
                  {sortedThreads.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`console-thread-item ${selectedThreadId === t.id ? 'console-thread-item--active' : ''}`}
                      onClick={() => setSelectedThreadId(t.id)}
                    >
                      <span className="console-thread-name">{t.name}</span>
                      <span className="console-thread-date">
                        {formatThreadDate(t.updatedAt)}
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
          </TabsContent>

          <TabsContent value="api" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="gemini-key">Gemini API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="gemini-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="AIzaSy..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <Button variant="outline" onClick={() => setShowApiKey((v) => !v)}>
                  {showApiKey ? 'Hide' : 'Show'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Stored locally on your device.</p>
              <Button onClick={handleSaveApiKey}>Save</Button>
            </div>
          </TabsContent>

          <TabsContent value="model" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Gemini model</Label>
              <Select value={settings.geminiModel} onValueChange={handleModelChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="system" className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Run on startup</Label>
                <p className="text-xs text-muted-foreground">Launch Mimir when you sign in</p>
              </div>
              <Switch
                checked={settings.autostart}
                onCheckedChange={handleAutostartChange}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Hotkey opens</Label>
              <Select
                value={settings.hotkeyOpens}
                onValueChange={(v) => handleHotkeyOpensChange(v as HotkeyOpens)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New chat</SelectItem>
                  <SelectItem value="latest">Latest chat</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                What happens when you press the capture hotkey.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="hotkey">Hotkey</Label>
              <Input
                id="hotkey"
                value={hotkeyInput}
                onChange={(e) => setHotkeyInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Saved to settings. Restart required to apply — runtime rebind coming later.
              </p>
              <Button variant="outline" onClick={handleSaveHotkey}>
                Save hotkey
              </Button>
            </div>

            <Separator />

            <Button variant="destructive" onClick={handleQuit}>
              Quit Mimir
            </Button>
          </TabsContent>

          <TabsContent value="about" className="space-y-2 pt-2">
            <p className="text-sm">Mimir v0.2.0</p>
            <p className="text-sm text-muted-foreground">
              A desktop assistant that appears on demand. Highlight text, press your hotkey,
              and ask.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
