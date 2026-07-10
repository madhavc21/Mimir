import type { ReactNode } from 'react'
import { History, Lock, Maximize2, MousePointerClick, Plus } from 'lucide-react'

interface FeatureGuideProps {
  hotkey: string
  compact?: boolean
}

function MockIconButton({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span className={`icon-button guide-mock-icon ${active ? 'icon-button--active' : ''}`}>
      {children}
    </span>
  )
}

export default function FeatureGuide({ hotkey, compact = false }: FeatureGuideProps) {
  return (
    <div className={`feature-guide ${compact ? 'feature-guide--compact' : ''}`}>
      {!compact && (
        <section className="feature-guide-section">
          <h3 className="feature-guide-heading">Capture context</h3>
          <ul className="feature-guide-list">
            <li>
              <strong>Text selected</strong> — press <kbd>{hotkey}</kbd>. Mimir grabs the
              highlight as chat context.
            </li>
            <li>
              <strong>Nothing selected</strong> — same hotkey opens a screen overlay. Drag a box
              around anything you want to ask about.
            </li>
            <li>
              Click outside the card to dismiss it (unless locked — see below).
            </li>
          </ul>
        </section>
      )}

      <section className="feature-guide-section">
        <h3 className="feature-guide-heading">Chat card header</h3>
        <p className="feature-guide-lead">
          The floating card looks like this. Match the icons to the controls on the right.
        </p>

        <div className="guide-preview-wrap">
          <div className="chat-card guide-preview-card">
            <div className="guide-preview-header-block">
              <div className="chat-header guide-header-mock">
                <div className="header-brand guide-mock-brand">
                  <img src="/mimir_logo.png" alt="" className="header-logo" />
                  <span className="header-title">ᛗᛁᛗᛁᚱ</span>
                </div>
                <div className="chat-header-spacer" />
                <MockIconButton>
                  <Plus size={15} color="rgba(255,255,255,0.7)" />
                </MockIconButton>
                <MockIconButton active>
                  <History size={15} color="rgba(255,255,255,0.9)" />
                </MockIconButton>
                <MockIconButton>
                  <Maximize2 size={15} color="rgba(255,255,255,0.7)" />
                </MockIconButton>
              </div>
              <p className="guide-header-hint">
                <Lock size={11} />
                Double-click header to lock
              </p>
            </div>
            <div className="guide-preview-body">
              <p className="guide-preview-watermark">New Chat</p>
            </div>
          </div>

          <ul className="guide-legend">
            <li className="guide-legend-item">
              <span className="guide-legend-icon guide-legend-icon--brand">
                <img src="/mimir_logo.png" alt="" />
              </span>
              <span>
                <strong>Logo / title</strong> — opens this Console window.
              </span>
            </li>
            <li className="guide-legend-item">
              <span className="guide-legend-icon">
                <Plus size={14} color="rgba(255,255,255,0.75)" />
              </span>
              <span>
                <strong>New chat</strong> — fresh chat, keeps capture context if present.
              </span>
            </li>
            <li className="guide-legend-item">
              <span className="guide-legend-icon icon-button--active">
                <History size={14} color="rgba(255,255,255,0.9)" />
              </span>
              <span>
                <strong>History</strong> — resume old chats from the dropdown.
              </span>
            </li>
            <li className="guide-legend-item">
              <span className="guide-legend-icon">
                <Maximize2 size={14} color="rgba(255,255,255,0.75)" />
              </span>
              <span>
                <strong>Expand</strong> — full screen; click again to restore size.
              </span>
            </li>
            <li className="guide-legend-item">
              <span className="guide-legend-icon guide-legend-icon--gesture">
                <MousePointerClick size={14} color="rgba(255,255,255,0.75)" />
              </span>
              <span>
                <strong>Drag</strong> the header to move. <strong>Double-click</strong> to lock —
                card stays open and on top. Double click again to unlock.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {!compact && (
        <section className="feature-guide-section">
          <h3 className="feature-guide-heading">Console &amp; history</h3>
          <ul className="feature-guide-list">
            <li>
              <strong>Chats tab</strong> — full thread list, search-by-scan, and a larger chat
              panel for longer conversations.
            </li>
            <li>
              <strong>System tab → Hotkey opens</strong> — choose whether {hotkey} starts a{' '}
              <em>new</em> chat or resumes your <em>latest</em> thread.
            </li>
            <li>
              Threads auto-save as you chat. Names come from the first message.
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
