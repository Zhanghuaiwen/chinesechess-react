import { useRef, useEffect } from 'react';

export default function ConsolePanel({ entries }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div className="console-panel">
      <div className="console-header">🤖 AI 控制台</div>
      <div className="console-body">
        {entries.length === 0 && (
          <div className="console-line console-info">
            <span className="console-time">[--:--:--]</span>
            <span className="console-msg">等待AI走棋...</span>
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={i}>
            {entry.type === 'separator' ? (
              <div className="console-separator">────────────────────</div>
            ) : entry.type === 'input' ? (
              <details className="console-details" open={i === entries.length - 1 || entry._open}>
                <summary className="console-line console-input">
                  <span className="console-time">[{entry.time}]</span>
                  <span className="console-label">📤 PROMPT</span>
                </summary>
                <pre className="console-pre">{entry.content}</pre>
              </details>
            ) : entry.type === 'output' ? (
              <details className="console-details" open={i === entries.length - 1 || entry._open}>
                <summary className="console-line console-output">
                  <span className="console-time">[{entry.time}]</span>
                  <span className="console-label">📥 RESPONSE</span>
                </summary>
                <pre className="console-pre">{entry.content}</pre>
              </details>
            ) : entry.type === 'move' ? (
              <div className="console-line console-move">
                <span className="console-time">[{entry.time}]</span>
                <span className="console-msg">➡️ {entry.content}</span>
              </div>
            ) : (
              <div className="console-line console-info">
                <span className="console-time">[{entry.time}]</span>
                <span className="console-msg">{entry.content}</span>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
