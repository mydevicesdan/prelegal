"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  MAX_TEXT_CHARS,
  sendChat,
  type ChatContext,
  type ChatMessage,
  type ChatReply,
} from "@/lib/chat";

export const GREETING =
  "Hi! I can help you draft a legal agreement from Common Paper's standard templates. What do you need? For example an NDA, a cloud service agreement, a professional services agreement or a data processing agreement, or just describe the situation and I'll suggest one.";

interface ChatPanelProps {
  /** The document as it currently stands, sent with each message so the assistant knows what is filled in. */
  context: ChatContext;
  onTurn: (reply: ChatReply) => void;
}

export function ChatPanel({ context, onTurn }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo?.({ top: log.current.scrollHeight });
  }, [messages, pending, error]);

  /** Asks the assistant to answer `history` (which must end with a user message). */
  const ask = async (history: ChatMessage[]) => {
    setPending(true);
    setError(null);
    try {
      const turn = await sendChat(history, context);
      onTurn(turn);
      setMessages([...history, { role: "assistant", content: turn.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;
    const history: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    void ask(history);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while composing (e.g. confirming an IME candidate) must not send the half-typed text.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <section
      aria-label="Chat with the assistant"
      className="flex h-[32rem] flex-col rounded-lg border border-gray-200 bg-white lg:h-[calc(100vh-12rem)]"
    >
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <p
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                message.role === "user"
                  ? "bg-brand-navy text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              <span className="sr-only">
                {message.role === "user" ? "You: " : "Assistant: "}
              </span>
              {message.content}
            </p>
          </div>
        ))}
        {pending && <p className="text-sm italic text-gray-600">Assistant is thinking…</p>}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void ask(messages)}
              disabled={pending}
              className="mt-2 font-semibold underline underline-offset-2 disabled:opacity-50"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-gray-200 p-3">
        <label htmlFor="chat-message" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-message"
          rows={2}
          maxLength={MAX_TEXT_CHARS}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your answer…"
          className="min-w-0 flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-600 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded-md bg-brand-purple px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-purple/90 focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
