import { useState, useEffect, useRef } from "react";
import { Send, Settings, X } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { listen } from '@tauri-apps/api/event';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import './App.css';

interface Message {
  id: number;
  text: string;
  role: "user" | "assistant";
}

export default function App() {
  const [copiedText, setCopiedText] = useState<string>("");
  const [copiedImage, setCopiedImage] = useState<string>("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, text: "Hey! How can I help you?", role: "assistant" }
  ]);
  
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Step 2: Load the saved API key from disk on app boot
  useEffect(() => {
    const loadSettings = async () => {
      const store = await load('settings.json', { autoSave: true, defaults: {} });
      const savedKey = await store.get<string>('geminiApiKey');
      if (savedKey) setApiKey(savedKey);
    };
    loadSettings();
  }, []);

  // Step 3: Auto-save the API key to disk whenever it changes
  useEffect(() => {
    const saveKey = async () => {
      const store = await load('settings.json', { autoSave: true, defaults: {} });
      await store.set('geminiApiKey', apiKey);
    };
    // Don't save on the initial empty-string mount
    if (apiKey) saveKey();
  }, [apiKey]);

  // Listen for text capture from the OS hotkey
  useEffect(() => {
    const unlistenPromise = listen<string>('capture-text', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.status === 'success' && payload.result) {
          setCopiedText(payload.result);
          setCopiedImage(""); // Clear any previous image
          // Set initial greeting relative to the captured context
          setMessages([
            { id: Date.now(), text: "I've captured your selected text. What would you like me to do with it?", role: "assistant" }
          ]);
        }
      } catch {
        // Fallback if parsing fails
        setCopiedText(event.payload);
      }

      // Auto-focus input box
      setTimeout(() => inputRef.current?.focus(), 50);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for screen capture from the OS hotkey fallback
  useEffect(() => {
    const unlistenPromise = listen<string>('capture-screen', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.status === 'success' && payload.result) {
          setCopiedImage(payload.result);
          setCopiedText(""); // Clear any previous text
          setMessages([
            { id: Date.now(), text: "I've captured a screenshot of your selection. What would you like to know about it?", role: "assistant" }
          ]);
        }
      } catch (e) {
        console.error("Failed to parse screen capture", e);
      }

      setTimeout(() => inputRef.current?.focus(), 50);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Reset ephemeral session when Rust hides the window (click-away).
  // Do NOT use tauri://blur — drag/resize briefly blurs the webview on Windows.
  useEffect(() => {
    const unlistenPromise = listen('session-reset', () => {
      setMessages([
        { id: Date.now(), text: "Hey! How can I help you?", role: "assistant" }
      ]);
      setCopiedText("");
      setCopiedImage("");
      setInput("");
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for real-time AI stream chunks
  useEffect(() => {
    const unlistenChunk = listen<string>('chat-stream-chunk', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.token) {
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastMsg = newMsgs[newMsgs.length - 1];
            // Since your python script yields the FULL string on every chunk,
            // we just completely overwrite the current bubble text!
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.text = payload.token;
            }
            return newMsgs;
          });
        }
      } catch (e) {
        console.error("Failed to parse chunk", e);
      }
    });

    return () => {
      unlistenChunk.then((unlisten) => unlisten());
    };
  }, []);

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    
    // Format the prompt for the backend while keeping the UI clean
    const formattedPrompt = `Highlighted Text: ${copiedText}\n\nquestion:\n${text}`;
    
    const userMsg: Message = { id: Date.now(), text, role: "user" };
    // Add a placeholder loading message for the assistant
    const placeholderMsg: Message = { id: Date.now() + 1, text: "...", role: "assistant" };
    
    // Extract history before adding new user messages (state updates are async)
    const formattedHistory = messages
      .filter((_, index) => index > 0) // Skip initial greeting
      .map((m) => ({
        role: m.role,
        content: m.text
      }));

    setMessages((prev) => [...prev, userMsg, placeholderMsg]);
    setInput("");

    try {
      // Fire the command to Rust! Passing correct formatted history.
      await invoke('stream_from_python', { 
        message: formattedPrompt, 
        imagePath: copiedImage || null,
        history: formattedHistory
      });
    } catch (e) {
      console.error(e);
      setMessages(prev => {
        const newMsgs = [...prev];
        const lastMsg = newMsgs[newMsgs.length - 1];
        if (lastMsg.role === "assistant") {
          lastMsg.text = "Failed to reach AI Backend.";
        }
        return newMsgs;
      });
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="window-viewport">
      {/* Padded Container for Shadow rendering */}
      <div className="chat-card" onClick={(e) => e.stopPropagation()}>
        
        {/* Header (Tauri Drag Zone) */}
        <div className="chat-header" data-tauri-drag-region>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }} data-tauri-drag-region>
            <div className="pulse-dot" />
            <span className="header-title" data-tauri-drag-region>Buddy Chat</span>
          </div>
          <button 
            className="icon-button" 
            onClick={() => setShowSettings(!showSettings)}
          >
            {showSettings ? <X size={15} color="rgba(255,255,255,0.7)" /> : <Settings size={15} color="rgba(255,255,255,0.7)" />}
          </button>
        </div>

        {/* Main Content Area */}
        {showSettings ? (
          <div className="settings-view">
            <div className="settings-section">
              <label className="settings-label">Gemini API Key</label>
              <input 
                type="password" 
                className="settings-input" 
                placeholder="AIzaSy..." 
                value={apiKey} 
                onChange={(e) => setApiKey(e.target.value)} 
              />
              <span className="settings-hint">Stored securely on your device.</span>
            </div>
            {/* You can add more settings here later! */}
          </div>
        ) : (
          <>
            <div className="chat-body">
          {(copiedText || copiedImage) && (
            <div className="context-banner">
              <div className="context-banner-header">
                <span className="context-pill">Selected Context</span>
                <button className="context-clear" onClick={() => { setCopiedText(""); setCopiedImage(""); }}>×</button>
              </div>
              {copiedText && <div className="context-banner-text">{copiedText}</div>}
              {copiedImage && (
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
                  <img 
                    src={convertFileSrc(copiedImage)} 
                    alt="Context" 
                    style={{ maxHeight: '120px', borderRadius: '6px', objectFit: 'contain' }} 
                  />
                </div>
              )}
            </div>
          )}

          <div className="messages-container">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`message-row ${m.role === "user" ? "user-row" : "assistant-row"}`}
              >
                <div className={`message-bubble ${m.role === "user" ? "user-bubble" : "assistant-bubble"}`}>
                  {m.role === "assistant" ? (
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

            {/* Input Bar */}
            <div className="chat-footer">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Message…"
              />
              <button
                className={`send-button ${input.trim() ? "active" : ""}`}
                onClick={send}
                disabled={!input.trim()}
              >
                <Send size={13} color="rgba(255,255,255,0.85)" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
