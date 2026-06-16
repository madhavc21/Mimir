import { useState, useEffect, useRef } from "react";
import { Send, Settings } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { listen } from '@tauri-apps/api/event';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import './App.css';

interface Message {
  id: number;
  text: string;
  role: "user" | "assistant";
}

type ChatStatus = 'idle' | 'pending' | 'streaming';

export default function App() {
  const [copiedText, setCopiedText] = useState<string>("");
  const [copiedImage, setCopiedImage] = useState<string>("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, text: "Hey! How can I help you?", role: "assistant" }
  ]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle');

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlistenPromise = listen<string>('capture-text', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.status === 'success' && payload.result) {
          setCopiedText(payload.result);
          setCopiedImage("");
          setMessages([
            { id: Date.now(), text: "I've captured your selected text. What would you like me to do with it?", role: "assistant" }
          ]);
        }
      } catch {
        setCopiedText(event.payload);
      }
      setChatStatus('idle');
      setTimeout(() => inputRef.current?.focus(), 50);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<string>('capture-screen', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.status === 'success' && payload.result) {
          setCopiedImage(payload.result);
          setCopiedText("");
          setMessages([
            { id: Date.now(), text: "I've captured a screenshot of your selection. What would you like to know about it?", role: "assistant" }
          ]);
        }
      } catch (e) {
        console.error("Failed to parse screen capture", e);
      }
      setChatStatus('idle');
      setTimeout(() => inputRef.current?.focus(), 50);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen('session-reset', () => {
      setMessages([
        { id: Date.now(), text: "Hey! How can I help you?", role: "assistant" }
      ]);
      setCopiedText("");
      setCopiedImage("");
      setInput("");
      setChatStatus('idle');
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenChunk = listen<string>('chat-stream-chunk', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.token) {
          setChatStatus('streaming');
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastMsg = newMsgs[newMsgs.length - 1];
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openConsole = async () => {
    try {
      await invoke('open_console');
    } catch (e) {
      console.error('open_console failed', e);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || chatStatus === 'pending') return;

    const formattedPrompt = `Highlighted Text: ${copiedText}\n\nquestion:\n${text}`;

    const userMsg: Message = { id: Date.now(), text, role: "user" };
    const placeholderMsg: Message = { id: Date.now() + 1, text: "...", role: "assistant" };

    const formattedHistory = messages
      .filter((_, index) => index > 0)
      .map((m) => ({
        role: m.role,
        content: m.text
      }));

    setMessages((prev) => [...prev, userMsg, placeholderMsg]);
    setInput("");
    setChatStatus('pending');

    try {
      await invoke('stream_from_python', {
        message: formattedPrompt,
        imagePath: copiedImage || null,
        history: formattedHistory
      });
      setChatStatus('idle');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages(prev => {
        const newMsgs = [...prev];
        const lastMsg = newMsgs[newMsgs.length - 1];
        if (lastMsg.role === "assistant") {
          lastMsg.text = errMsg;
        }
        return newMsgs;
      });
      setChatStatus('idle');
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const sendDisabled = !input.trim() || chatStatus === 'pending';

  return (
    <div className="window-viewport">
      <div className="chat-card" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <div
            className="chat-header-drag"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}
            data-tauri-drag-region
          >
            <img src="/mimir_logo.png" alt="" className="header-logo" />
            <span className="header-title">Mimir</span>
          </div>
          <button
            type="button"
            className="icon-button"
            data-tauri-drag-region={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openConsole();
            }}
          >
            <Settings size={15} color="rgba(255,255,255,0.7)" />
          </button>
        </div>

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
            className={`send-button ${input.trim() && chatStatus !== 'pending' ? "active" : ""}`}
            onClick={send}
            disabled={sendDisabled}
          >
            <Send size={13} color="rgba(255,255,255,0.85)" />
          </button>
        </div>
      </div>
    </div>
  );
}
