import React, { useState } from "react";
import {
  Palette,
  Users,
  Eye,
  Sparkles,
  Clipboard,
  AlertCircle,
  HelpCircle,
  Trophy,
  MessageSquare,
} from "lucide-react";
import type { PlayerRole } from "../types";

interface LobbyViewProps {
  onCreateRoom: (username: string, roomName: string, role: PlayerRole) => void;
  onJoinRoom: (username: string, roomId: string, role: PlayerRole) => void;
  errorMessage: string | null;
  onClearError: () => void;
  loading: boolean;
}

const AVATARS = ["🐱", "🐶", "🦊", "🐼", "🐸", "🦄", "🐙", "🦁"];
const PASTEL_BG = [
  "bg-[#E9E4F7]",
  "bg-[#E2F7ED]",
  "bg-[#FEF7D6]",
  "bg-[#FCE6EB]",
  "bg-[#E3F1FD]",
  "bg-[#FFF0E6]",
  "bg-[#EDE9FE]",
  "bg-[#DCFCE7]",
];

export const LobbyView: React.FC<LobbyViewProps> = ({
  onCreateRoom,
  onJoinRoom,
  errorMessage,
  onClearError,
  loading,
}) => {
  const [username, setUsername] = useState("");
  const [roomName, setRoomName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [selectedAvatarIdx, setSelectedAvatarIdx] = useState(0);
  const [createRole, setCreateRole] = useState<PlayerRole>("player");
  const [joinRole, setJoinRole] = useState<PlayerRole>("player");
  const [activeTab, setActiveTab] = useState<"create" | "join">("create");

  const isUsernameValid =
    username.trim().length >= 3 &&
    username.trim().length <= 20 &&
    /^[A-Za-z0-9 _]{3,20}$/.test(username.trim());

  const handlePasteRoomId = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setJoinRoomId(text.trim());
    } catch {
      // ignore clipboard read error
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUsernameValid) return;
    onClearError();
    onCreateRoom(username.trim(), roomName.trim(), createRole);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUsernameValid || !joinRoomId.trim()) return;
    onClearError();
    onJoinRoom(username.trim(), joinRoomId.trim(), joinRole);
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 flex flex-col items-center gap-8">
      {/* Hero Title & Mascot */}
      <div className="text-center space-y-2 max-w-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E9E4F7] text-[#6D28D9] text-xs font-bold tracking-wide uppercase shadow-xs">
          <Sparkles className="w-3.5 h-3.5" />
          Realtime Multiplayer Drawing
        </div>
        <h2 className="text-4xl md:text-5xl font-extrabold text-[#2E1065] tracking-tight">
          Welcome to <span className="text-[#7C3AED]">Skribble Party</span>
        </h2>
        <p className="text-base text-[#6B7280] font-medium">
          Create a cozy private room or paste a code to join your friends in live drawing & guessing madness!
        </p>
      </div>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="w-full max-w-md bg-[#FEE2E2] border border-[#FCA5A5] text-[#991B1B] px-4 py-3 rounded-2xl flex items-center justify-between gap-3 shadow-sm animate-shake">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm font-bold">{errorMessage}</span>
          </div>
          <button
            onClick={onClearError}
            className="text-xs font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Avatar & Username Card */}
      <div className="w-full max-w-2xl bg-white rounded-3xl p-6 border border-[#E9E4F7] pastel-card space-y-4">
        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* Avatar Selector */}
          <div className="flex flex-col items-center gap-2">
            <div
              className={`w-20 h-20 rounded-3xl ${PASTEL_BG[selectedAvatarIdx]} border-2 border-[#DDD6FE] flex items-center justify-center text-4xl shadow-inner transition-transform hover:scale-105`}
            >
              {AVATARS[selectedAvatarIdx]}
            </div>
            <div className="flex gap-1">
              {AVATARS.map((emoji, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedAvatarIdx(idx)}
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center transition-all ${
                    selectedAvatarIdx === idx
                      ? "ring-2 ring-[#7C3AED] scale-110"
                      : "opacity-60 hover:opacity-100"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Username Input */}
          <div className="flex-1 w-full space-y-2">
            <label className="block text-sm font-bold text-[#374151]">
              Choose Your Display Name <span className="text-[#EF4444]">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. DoodleMaster_99"
                maxLength={20}
                className="w-full px-4 py-3 rounded-2xl bg-[#FDF8F9] border-2 border-[#E5E7EB] focus:border-[#8B5CF6] focus:bg-white focus:outline-none text-base font-bold text-[#1F2937] placeholder-[#9CA3AF] transition-colors"
              />
              <span
                className={`absolute right-3.5 top-3.5 text-xs font-bold px-2 py-0.5 rounded-full ${
                  isUsernameValid
                    ? "bg-[#D1FAE5] text-[#065F46]"
                    : "bg-[#F3F4F6] text-[#9CA3AF]"
                }`}
              >
                {username.length}/20
              </span>
            </div>
            <p className="text-xs text-[#6B7280]">
              3–20 characters (letters, numbers, spaces, underscores).
            </p>
          </div>
        </div>
      </div>

      {/* Main Tabs Container: Create Room vs Join Room */}
      <div className="w-full max-w-2xl bg-white rounded-3xl border border-[#E9E4F7] pastel-card overflow-hidden">
        {/* Segmented Tab Headers */}
        <div className="flex bg-[#F9FAFB] p-2 border-b border-[#F3F4F6] gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("create")}
            className={`flex-1 py-3 px-4 rounded-2xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all ${
              activeTab === "create"
                ? "bg-white text-[#6D28D9] shadow-sm"
                : "text-[#6B7280] hover:text-[#374151]"
            }`}
          >
            <Sparkles className="w-4 h-4 text-[#8B5CF6]" />
            Create Game Room
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("join")}
            className={`flex-1 py-3 px-4 rounded-2xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all ${
              activeTab === "join"
                ? "bg-white text-[#059669] shadow-sm"
                : "text-[#6B7280] hover:text-[#374151]"
            }`}
          >
            <Users className="w-4 h-4 text-[#10B981]" />
            Join Existing Room
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6">
          {activeTab === "create" ? (
            <form onSubmit={handleCreateSubmit} className="space-y-5">
              {/* Room Name */}
              <div className="space-y-1.5">
                <label className="block text-sm font-bold text-[#374151]">
                  Room Name (Optional)
                </label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder={
                    username.trim()
                      ? `${username.trim()}'s Fun Room`
                      : "My Cozy Party Room"
                  }
                  className="w-full px-4 py-3 rounded-2xl bg-[#FDF8F9] border-2 border-[#E5E7EB] focus:border-[#8B5CF6] focus:bg-white focus:outline-none text-base font-semibold text-[#1F2937] placeholder-[#9CA3AF] transition-colors"
                />
              </div>

              {/* Role Preference */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-[#374151]">
                  Join As
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCreateRole("player")}
                    className={`p-3.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${
                      createRole === "player"
                        ? "border-[#8B5CF6] bg-[#F5F3FF] text-[#5B21B6]"
                        : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#EDE9FE] flex items-center justify-center text-[#7C3AED]">
                      <Palette className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">Active Player</div>
                      <div className="text-xs text-[#6B7280]">Draw & guess for points</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreateRole("spectator")}
                    className={`p-3.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${
                      createRole === "spectator"
                        ? "border-[#8B5CF6] bg-[#F5F3FF] text-[#5B21B6]"
                        : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#E0E7FF] flex items-center justify-center text-[#4F46E5]">
                      <Eye className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">Spectator</div>
                      <div className="text-xs text-[#6B7280]">Watch & chat along</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Room Capacity Perks Note */}
              <div className="p-3.5 rounded-2xl bg-[#F3F4F6] text-xs font-semibold text-[#4B5563] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#8B5CF6]" />
                  Max 15 Active Players + 15 Spectators (30 max)
                </span>
                <span className="bg-[#E9E4F7] text-[#6D28D9] px-2.5 py-0.5 rounded-full font-bold">
                  120s Rounds
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!isUsernameValid || loading}
                className="w-full py-4 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#D1D5DB] disabled:cursor-not-allowed text-white text-base font-extrabold tracking-wide shadow-md btn-squishy flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Sparkles className="w-5 h-5" />
                {loading ? "Creating Room..." : "Create & Enter Party Room"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoinSubmit} className="space-y-5">
              {/* Room ID Code Input */}
              <div className="space-y-1.5">
                <label className="block text-sm font-bold text-[#374151]">
                  Room ID / Code <span className="text-[#EF4444]">*</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value)}
                    placeholder="Paste room UUID or code here..."
                    className="w-full px-4 py-3 pr-24 rounded-2xl bg-[#FDF8F9] border-2 border-[#E5E7EB] focus:border-[#10B981] focus:bg-white focus:outline-none text-base font-semibold text-[#1F2937] placeholder-[#9CA3AF] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handlePasteRoomId}
                    className="absolute right-2 px-3 py-1.5 rounded-xl bg-[#E5E7EB] hover:bg-[#D1D5DB] text-xs font-bold text-[#374151] flex items-center gap-1 transition-colors"
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                    Paste
                  </button>
                </div>
              </div>

              {/* Role Selection */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-[#374151]">
                  Join As
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setJoinRole("player")}
                    className={`p-3.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${
                      joinRole === "player"
                        ? "border-[#10B981] bg-[#ECFDF5] text-[#065F46]"
                        : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#D1FAE5] flex items-center justify-center text-[#059669]">
                      <Palette className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">Active Player</div>
                      <div className="text-xs text-[#6B7280]">Compete on board</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setJoinRole("spectator")}
                    className={`p-3.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${
                      joinRole === "spectator"
                        ? "border-[#10B981] bg-[#ECFDF5] text-[#065F46]"
                        : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#E0E7FF] flex items-center justify-center text-[#4F46E5]">
                      <Eye className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">Spectator</div>
                      <div className="text-xs text-[#6B7280]">Spectate & cheer</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Join Submit Button */}
              <button
                type="submit"
                disabled={!isUsernameValid || !joinRoomId.trim() || loading}
                className="w-full py-4 rounded-2xl bg-[#059669] hover:bg-[#047857] disabled:bg-[#D1D5DB] disabled:cursor-not-allowed text-white text-base font-extrabold tracking-wide shadow-md btn-squishy flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Users className="w-5 h-5" />
                {loading ? "Joining Room..." : "Join Game Room"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* How to Play Pastel Doodle Cards */}
      <div className="w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-[#4B5563] uppercase tracking-wider">
          <HelpCircle className="w-4 h-4 text-[#8B5CF6]" />
          How to Play in 3 Simple Steps
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-3xl bg-[#E9E4F7] border border-[#DDD6FE] space-y-2">
            <div className="w-9 h-9 rounded-2xl bg-white flex items-center justify-center text-lg font-extrabold text-[#7C3AED] shadow-xs">
              1
            </div>
            <h4 className="text-base font-bold text-[#3B0764] flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-[#7C3AED]" /> Pick & Draw
            </h4>
            <p className="text-xs text-[#5B21B6] leading-relaxed">
              When it's your turn, choose a secret word and doodle it on the canvas before time runs out!
            </p>
          </div>

          <div className="p-5 rounded-3xl bg-[#FEF7D6] border border-[#FDE68A] space-y-2">
            <div className="w-9 h-9 rounded-2xl bg-white flex items-center justify-center text-lg font-extrabold text-[#D97706] shadow-xs">
              2
            </div>
            <h4 className="text-base font-bold text-[#78350F] flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-[#D97706]" /> Fast Guessing
            </h4>
            <p className="text-xs text-[#92400E] leading-relaxed">
              Type guesses in the live chat. Faster correct answers earn more bonus points!
            </p>
          </div>

          <div className="p-5 rounded-3xl bg-[#E2F7ED] border border-[#A7F3D0] space-y-2">
            <div className="w-9 h-9 rounded-2xl bg-white flex items-center justify-center text-lg font-extrabold text-[#059669] shadow-xs">
              3
            </div>
            <h4 className="text-base font-bold text-[#064E3B] flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-[#059669]" /> Crown the Winner
            </h4>
            <p className="text-xs text-[#065F46] leading-relaxed">
              Climb the leaderboard across rounds and take the #1 winner podium trophy!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
