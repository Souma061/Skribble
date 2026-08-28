import React, { useState } from "react";
import { Copy, Check, Volume2, VolumeX, Sparkles, Pencil } from "lucide-react";

interface HeaderProps {
  connected: boolean;
  roomId?: string;
  roomName?: string;
}

export const Header: React.FC<HeaderProps> = ({ connected, roomId, roomName }) => {
  const [copied, setCopied] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const handleCopyRoom = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="w-full max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
      {/* Brand Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#E9E4F7] to-[#FCE6EB] border border-[#DDD6FE] flex items-center justify-center shadow-sm">
          <Pencil className="w-6 h-6 text-[#7C3AED] rotate-[-15deg]" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#2E1065] flex items-center gap-1">
              Skribble <span className="text-[#8B5CF6]">Party</span>
            </h1>
            <Sparkles className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <p className="text-xs font-semibold text-[#6B7280]">
            Draw, Guess & Laugh in Pastel
          </p>
        </div>
      </div>

      {/* Room Badge (if inside a room) */}
      {roomId && (
        <div className="flex items-center gap-2 bg-[#F3E8FF] border border-[#E9D5FF] px-4 py-2 rounded-full shadow-sm">
          <span className="text-xs font-bold text-[#6B21A8] uppercase tracking-wider">
            {roomName || "Room"}:
          </span>
          <span className="font-mono text-sm font-bold text-[#4C1D95]">
            {roomId.slice(0, 8)}...
          </span>
          <button
            onClick={handleCopyRoom}
            className="p-1 rounded-full hover:bg-[#E9D5FF] text-[#6B21A8] transition-colors"
            title="Copy Room ID"
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}

      {/* Right Controls: Sound & Connection Status */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-2 rounded-full bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[#4B5563] shadow-xs transition-colors"
          title={soundEnabled ? "Mute Sound" : "Enable Sound"}
        >
          {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-[#9CA3AF]" />}
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#E5E7EB] shadow-xs">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              connected ? "bg-[#10B981] animate-pulse" : "bg-[#EF4444]"
            }`}
          />
          <span className="text-xs font-bold text-[#374151]">
            {connected ? "Connected" : "Reconnecting..."}
          </span>
        </div>
      </div>
    </header>
  );
};
