"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ate/design/components/Button";
import { Card } from "@ate/design/components/Card";
import { initials } from "../../../../lib/avatar";

interface ChatMessage {
  id: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  text: string;
  sender: string;
  status?: "queued" | "sending" | "sent" | "failed";
}

export function ChatPanel({
  employeeId,
  employeeName,
  initialPaused = false,
  className,
  style,
}: {
  employeeId: string;
  employeeName: string;
  initialPaused?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const firstName = employeeName.split(" ")[0];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(initialPaused);
  const [error, setError] = useState<string | null>(null);
  const [showTechnicalError, setShowTechnicalError] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  const queueRef = useRef<{ id: string; text: string }[]>([]);
  const isProcessingRef = useRef(false);
  const isPausedRef = useRef(initialPaused);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setIsPaused(initialPaused);
    isPausedRef.current = initialPaused;
  }, [initialPaused]);

  useEffect(() => {
    function onPausedChange(e: Event) {
      const custom = e as CustomEvent<{ employeeId: string; paused: boolean }>;
      if (custom.detail?.employeeId === employeeId) {
        setIsPaused(custom.detail.paused);
        isPausedRef.current = custom.detail.paused;
      }
    }
    window.addEventListener("employee-paused-change", onPausedChange);
    return () => {
      window.removeEventListener("employee-paused-change", onPausedChange);
    };
  }, [employeeId]);

  useEffect(() => {
    let ignore = false;
    async function loadHistory() {
      try {
        const res = await fetch(`/api/employees/${employeeId}/chat`);
        if (!res.ok) throw new Error("Failed to load chat history");
        const data = await res.json();
        if (!ignore && Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      } catch (err) {
        console.warn("[chat] load history failed", err);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    loadHistory();
    return () => {
      ignore = true;
    };
  }, [employeeId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending, queueCount]);

  async function processNextInQueue() {
    if (isProcessingRef.current || isPausedRef.current) return;
    if (queueRef.current.length === 0) {
      setIsSending(false);
      setQueueCount(0);
      return;
    }

    isProcessingRef.current = true;
    setIsSending(true);
    const item = queueRef.current[0];

    // Mark current item as actively sending
    setMessages((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, status: "sending" } : m))
    );

    try {
      const res = await fetch(`/api/employees/${employeeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: item.text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not send message");
      }

      const data = await res.json();
      const replyMessage: ChatMessage = {
        id: `reply-${Date.now()}`,
        createdAt: data.createdAt ?? new Date().toISOString(),
        direction: "outbound",
        text: data.reply ?? "",
        sender: firstName,
        status: "sent",
      };

      // Dequeue completed item
      queueRef.current.shift();
      setQueueCount(queueRef.current.length);

      setMessages((prev) => [
        ...prev.map((m) => (m.id === item.id ? { ...m, status: "sent" as const } : m)),
        replyMessage,
      ]);
      setLastFailedMessage(null);
      setError(null);
      setShowTechnicalError(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Message failed";
      setError(msg);
      setLastFailedMessage(item.text);
      setMessages((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, status: "failed" as const } : m))
      );
      queueRef.current.shift();
      setQueueCount(queueRef.current.length);
      isProcessingRef.current = false;
      setIsSending(false);
      return;
    }

    isProcessingRef.current = false;
    if (queueRef.current.length > 0) {
      processNextInQueue();
    } else {
      setIsSending(false);
    }
  }

  function handleSend(retryText?: string) {
    const textToSend = retryText ?? input.trim();
    if (!textToSend || isPaused) return;

    setError(null);
    setShowTechnicalError(false);
    if (!retryText) {
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "44px";
      }
    }

    const tempId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isCurrentlyBusy = isProcessingRef.current;

    const optimisticMessage: ChatMessage = {
      id: tempId,
      createdAt: new Date().toISOString(),
      direction: "inbound",
      text: textToSend,
      sender: "You",
      status: isCurrentlyBusy ? "queued" : "sending",
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    queueRef.current.push({ id: tempId, text: textToSend });
    setQueueCount(queueRef.current.length);

    if (!isCurrentlyBusy) {
      processNextInQueue();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "44px";
    if (el.scrollHeight > 44) {
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(iso: string) {
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  return (
    <Card className={`profile-card conversation-card ${className ?? ""}`} style={style}>
      <div className="conversation-header">
        <div>
          <h2 className="conversation-title">Conversation</h2>
          <p className="conversation-subtitle">Direct messages with {firstName}</p>
        </div>
        <span className="conversation-badge">Today</span>
      </div>

      <div ref={scrollRef} className="conversation-messages-scroll">
        {isLoading ? (
          <p className="conversation-empty-state">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="conversation-empty-state">
            No messages yet. Send a message to start working with {firstName}!
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.direction === "inbound";
            return (
              <div
                key={m.id}
                className={`conversation-bubble-row ${isUser ? "user" : "assistant"}`}
              >
                <div className="conversation-bubble-meta">
                  <span>
                    {isUser ? `You, ${formatTime(m.createdAt)}` : `${firstName}, ${formatTime(m.createdAt)}`}
                  </span>
                  {m.status === "queued" && (
                    <span className="conversation-queued-badge">Queued</span>
                  )}
                </div>
                <div
                  className={`conversation-bubble ${isUser ? "user" : "assistant"} ${
                    m.status === "queued" ? "queued" : ""
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })
        )}

        {isSending && (
          <div className="conversation-bubble-row assistant">
            <div className="conversation-bubble-meta">
              <span>{firstName}</span>
            </div>
            <div className="conversation-working-pill">
              <div className="conversation-working-avatar">
                {initials(employeeName)}
              </div>
              <span>
                {firstName} is working…
                {queueCount > 1 ? ` (${queueCount - 1} in queue)` : ""}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="conversation-error-card">
            <strong>{firstName} couldn&rsquo;t reply just now.</strong>
            <p>
              Something went wrong on our side. Your message is saved and nothing was lost.
            </p>
            {showTechnicalError && (
              <pre className="conversation-tech-details">{error}</pre>
            )}
            <div className="conversation-error-actions">
              <button
                type="button"
                className="conversation-retry-btn"
                onClick={() => handleSend(lastFailedMessage ?? undefined)}
              >
                Try again
              </button>
              <button
                type="button"
                className="conversation-details-btn"
                onClick={() => setShowTechnicalError((prev) => !prev)}
              >
                {showTechnicalError ? "Hide details" : "Technical details"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="conversation-input-container">
        <div className="conversation-input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isPaused
                ? `${firstName} is paused`
                : isSending
                ? `Message ${firstName} (adds to queue)…`
                : `Message ${firstName}`
            }
            disabled={isPaused}
            rows={1}
            className="conversation-textarea"
          />
          <Button
            type="button"
            variant="blue"
            disabled={!input.trim() || isPaused}
            onClick={() => handleSend()}
            className="conversation-send-btn"
          >
            {isSending ? "Queue" : "Send"}
          </Button>
        </div>
        {isPaused ? (
          <div className="conversation-paused-banner">
            <span>⏸️ {firstName} is paused. Resume above to chat or assign tasks.</span>
          </div>
        ) : (
          <span className="conversation-input-hint">
            Enter to {isSending ? "queue" : "send"}. Shift and Enter for a new line.
          </span>
        )}
      </div>
    </Card>
  );
}
