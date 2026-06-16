import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
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
} from '@/lib/settings'

export default function Console() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [listenerLive, setListenerLive] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [hotkeyInput, setHotkeyInput] = useState(DEFAULT_SETTINGS.hotkey)
  const [listenerBusy, setListenerBusy] = useState(false)

  const refreshListenerStatus = useCallback(async () => {
    const live = await invoke<boolean>('get_listener_status')
    setListenerLive(live)
  }, [])

  useEffect(() => {
    const init = async () => {
      const loaded = await loadSettings()
      setSettings(loaded)
      setApiKeyInput(loaded.geminiApiKey)
      setHotkeyInput(loaded.hotkey)
      await refreshListenerStatus()

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
  }, [refreshListenerStatus])

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

  const handleQuit = () => {
    invoke('quit_app')
  }

  return (
    <div className="min-h-screen bg-[#0b0b10] text-foreground p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <header className="flex items-center gap-3">
          <img src="/mimir_logo.png" alt="" className="h-8 w-8 object-contain" />
          <div>
            <h1 className="text-xl font-semibold">Mimir</h1>
            <p className="text-sm text-muted-foreground">Console</p>
          </div>
        </header>

        <Tabs defaultValue="home" onValueChange={(v) => v === 'home' && refreshListenerStatus()}>
          <TabsList className="w-full">
            <TabsTrigger value="home">Home</TabsTrigger>
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
            <p className="text-sm">Mimir v0.1.0</p>
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
