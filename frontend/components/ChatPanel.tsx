"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  MAX_TEXT_CHARS,
  sendChat,
  type ChatContext,
  type ChatMessage,
  type ChatReply,
} from "@/lib/chat";
import { Button } from "./ui";

export const GREETING =
  "Hi! I can help you draft a legal agreement from Common Paper's standard templates. What do you need? For example an NDA, a cloud service agreement, a professional services agreement or a data processing agreement, or just describe the situation and I'll suggest one.";

interface ChatPanelProps {
  /** The document as it currently stands, sent with each message so the assistant knows what is filled in. */
  context: ChatContext;
  /** Called after each answer with the reply and the whole conversation so far (so it can be saved). */
  onTurn: (reply: ChatReply, conversation: ChatMessage[]) => void;
  /** A saved conversation to carry on from. */
  initialMessages?: ChatMessage[];
}

const OPENING: ChatMessage[] = [{ role: "assistant", content: GREETING }];

export function ChatPanel({ context, onTurn, initialMessages }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages && initialMessages.length > 0 ? initialMessages : OPENING,
  );
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
      const conversation: ChatMessage[] = [...history, { role: "assistant", content: turn.reply }];
      setMessages(conversation);
      onTurn(turn, conversation);
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
      className="flex h-[34rem] flex-col rounded-lg border border-gray-200 bg-white lg:h-[calc(100vh-11rem)]"
    >
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-display text-lg font-semibold text-brand-navy">Assistant</h2>
        <p className="text-sm text-gray-600">Describe what you need. It fills in the agreement as you talk.</p>
      </div>

      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <p
              className={`max-w-[88%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15px] leading-relaxed ${
                message.role === "user"
                  ? "rounded-2xl rounded-br-sm bg-brand-navy text-white"
                  : "rounded-2xl rounded-bl-sm bg-gray-100 text-gray-900"
              }`}
            >
              <span className="sr-only">{message.role === "user" ? "You: " : "Assistant: "}</span>
              {message.content}
            </p>
          </div>
        ))}
        {pending && <p className="text-sm italic text-gray-600">Assistant is thinking…</p>}
        {error && (
          <div role="alert" className="rounded-md border-l-4 border-red-600 bg-red-50 px-3.5 py-3 text-sm text-red-900">
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_TEXT_CHARS}
          placeholder="Type your answer…"
          className="min-w-0 flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-[15px] text-gray-900 placeholder:text-gray-600 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
        />
        <Button type="submit" disabled={pending || !draft.trim()}>
          Send
        </Button>
      </form>
    </section>
  );
}
