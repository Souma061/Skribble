import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, MessageCircle } from "lucide-react";
import type { ChatMessage } from "../types";

interface ChatBoxProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  closeGuessAlert?: string | null;
  disabled?: boolean;
}

export const ChatBox: React.FC<ChatBoxProps> = ({
  messages,
  onSendMessage,
  closeGuessAlert,
  disabled = false,
}) => {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, closeGuessAlert]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
  };

  return (
    <div className="w-full bg-white rounded-3xl border border-[#E9E4F7] pastel-card flex flex-col h-[400px] overflow-hidden shadow-sm">
      {/* Chat Header */}
      <div className="px-4 py-3 border-b border-[#F3F4F6] flex items-center justify-between bg-[#FAF5FF]">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[#6D28D9]">
          <MessageCircle className="w-4 h-4" />
          Live Guess Chat
        </div>
        <span className="text-[11px] font-semibold text-[#9CA3AF]">
          Type your guesses here!
        </span>
      </div>

      {/* Message Feed */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5 text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs font-semibold text-[#9CA3AF]">
            No messages yet. Type your first guess!
          </div>
        ) : (
          messages.map((m) => {
            if (m.type === "CORRECT_GUESS") {
              return (
                <div
                  key={m.id}
                  className="p-2.5 rounded-2xl bg-[#DCFCE7] border border-[#86EFAC] text-[#166534] font-black flex items-center gap-1.5 shadow-xs animate-bounce"
                >
                  <Sparkles className="w-4 h-4 text-[#15803D]" />
                  {m.message}
                </div>
              );
            }

            return (
              <div
                key={m.id}
                className="p-2 rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] flex items-start gap-1.5 shadow-2xs"
              >
                <span className="font-extrabold text-[#6D28D9]">{m.username}:</span>
                <span className="font-semibold text-[#374151] break-all">{m.message}</span>
              </div>
            );
          })
        )}

        {/* Private Close Guess Toast */}
        {closeGuessAlert && (
          <div className="p-2.5 rounded-2xl bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] font-bold shadow-xs animate-pulse">
            ⚠️ {closeGuessAlert}
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Message Input Box */}
      <form onSubmit={handleSend} className="p-2.5 border-t border-[#F3F4F6] flex items-center gap-2">
        <input
          type="text"
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? "You are drawing..." : "Type your guess..."}
          className="flex-1 px-3.5 py-2.5 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="p-2.5 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#D1D5DB] text-white btn-squishy cursor-pointer transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
