import {
  Check,
  Copy,
  Crown,
  Eye,
  LogOut,
  Palette,
  Play,
  Trash2,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import type { ChatMessage, RoomState } from "../types";
import { ChatBox } from "./ChatBox";
import { DrawingCanvas } from "./DrawingCanvas";
import { GameOverModal } from "./GameOverModal";
import { RoundEndModal } from "./RoundEndModal";
import { WordBanner } from "./WordBanner";
import { WordModal } from "./WordModal";

interface RoundTimerSync {
  timeLeft: number;
  roundEndsAt: number;
  serverNow: number;
}

interface RoomViewProps {
  socket: Socket | null;
  room: RoomState;
  currentSocketId: string | null;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onStartGame?: () => void;
}

const PASTEL_CARD_BG = [
  "bg-[#E9E4F7] border-[#DDD6FE] text-[#5B21B6]",
  "bg-[#E2F7ED] border-[#A7F3D0] text-[#065F46]",
  "bg-[#FEF7D6] border-[#FDE68A] text-[#92400E]",
  "bg-[#FCE6EB] border-[#FBCFE8] text-[#9D174D]",
  "bg-[#E3F1FD] border-[#BAE6FD] text-[#075985]",
  "bg-[#FFF0E6] border-[#FED7AA] text-[#9A3412]",
  "bg-[#EDE9FE] border-[#DDD6FE] text-[#6D28D9]",
  "bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]",
];

export const RoomView: React.FC<RoomViewProps> = ({
  socket,
  room,
  currentSocketId,
  onLeaveRoom,
  onDeleteRoom,
  onStartGame,
}) => {
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Word Selection State
  const [isWordModalOpen, setIsWordModalOpen] = useState(false);
  const [wordSuggestions, setWordSuggestions] = useState<string[]>([]);
  const [wordSelectionTimeLimit, setWordSelectionTimeLimit] =
    useState<number>(20);
  const [assignedWord, setAssignedWord] = useState<string | undefined>();
  const [maskedBlanks, setMaskedBlanks] = useState<string>("");
  const [letterCount, setLetterCount] = useState<number | undefined>();
  const [currentHint, setCurrentHint] = useState<string | undefined>();
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(
    room.roundEndsAt ?? null,
  );
  const [timeLeft, setTimeLeft] = useState<number>(room.timeLeft ?? 120);
  const serverClockOffsetRef = useRef(0);

  // Round End / Game Over Modals State
  const [roundEndData, setRoundEndData] = useState<{
    word: string;
    reason: string;
  } | null>(null);

  // Chat & Guess State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [closeGuessAlert, setCloseGuessAlert] = useState<string | null>(null);

  const isOwner = room.ownerId === currentSocketId;
  const isDrawer = room.game.currentDrawerId === currentSocketId;
  const activePlayers = room.players.filter((p) => p.role === "player");
  const spectators = room.players.filter((p) => p.role === "spectator");

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (room.serverNow !== undefined) {
      serverClockOffsetRef.current = room.serverNow - Date.now();
    }
  }, [room.serverNow]);

  useEffect(() => {
    if (room.game.status !== "ACTIVE_ROUND" || roundEndsAt === null) return;

    const timer = window.setInterval(() => {
      const serverAdjustedNow = Date.now() + serverClockOffsetRef.current;
      const nextTimeLeft = Math.max(
        0,
        Math.ceil((roundEndsAt - serverAdjustedNow) / 1000),
      );
      setTimeLeft((current) =>
        current === nextTimeLeft ? current : nextTimeLeft,
      );
    }, 250);

    return () => window.clearInterval(timer);
  }, [room.game.status, roundEndsAt]);

  // Socket listeners for game flow
  useEffect(() => {
    if (!socket) return;

    // 1. Drawer Prompt
    const handlePromptWord = (payload: {
      suggestions: string[];
      timeLimitSeconds?: number;
    }) => {
      setWordSuggestions(payload.suggestions);
      setWordSelectionTimeLimit(payload.timeLimitSeconds ?? 20);
      setIsWordModalOpen(true);
      setRoundEndData(null);
    };

    const syncRoundTimer = (payload: RoundTimerSync) => {
      serverClockOffsetRef.current = payload.serverNow - Date.now();
      setRoundEndsAt(payload.roundEndsAt);
      setTimeLeft(payload.timeLeft);
    };

    // 2. Assigned Word for Drawer
    const handleWordAssigned = (
      payload: { word: string; hint?: string } & RoundTimerSync,
    ) => {
      setAssignedWord(payload.word);
      setCurrentHint(payload.hint);
      syncRoundTimer(payload);
      setIsWordModalOpen(false);
      setRoundEndData(null);
    };

    // 3. Masked Word for Guessers
    const handleWordMasked = (
      payload: {
        blanks: string;
        letterCount: number;
        hint?: string;
      } & RoundTimerSync,
    ) => {
      setMaskedBlanks(payload.blanks);
      setLetterCount(payload.letterCount);
      setCurrentHint(payload.hint);
      syncRoundTimer(payload);
      setRoundEndData(null);
    };

    // 4. Timer Tick
    const handleTimerTick = (payload: RoundTimerSync) => {
      syncRoundTimer(payload);
    };

    // 5. Letter Reveal
    const handleHintReveal = (payload: { blanks: string }) => {
      setMaskedBlanks(payload.blanks);
    };

    // 6. Round Ended
    const handleRoundEnded = (payload: { word: string; reason: string }) => {
      setRoundEndsAt(null);
      setTimeLeft(0);
      setRoundEndData(payload);
    };

    // 7. Chat messages — capped at 200 to prevent unbounded state growth
    const handleChatMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev.slice(-199), msg]);
    };

    // 8. Close Guess
    const handleCloseGuess = (payload: { message: string }) => {
      setCloseGuessAlert(payload.message);
      setTimeout(() => setCloseGuessAlert(null), 3000);
    };

    socket.on("round:prompt-word", handlePromptWord);
    socket.on("round:word-assigned", handleWordAssigned);
    socket.on("round:word-masked", handleWordMasked);
    socket.on("timer:tick", handleTimerTick);
    socket.on("round:hint-reveal", handleHintReveal);
    socket.on("round:ended", handleRoundEnded);
    socket.on("chat:message", handleChatMessage);
    socket.on("guess:close", handleCloseGuess);

    return () => {
      socket.off("round:prompt-word", handlePromptWord);
      socket.off("round:word-assigned", handleWordAssigned);
      socket.off("round:word-masked", handleWordMasked);
      socket.off("timer:tick", handleTimerTick);
      socket.off("round:hint-reveal", handleHintReveal);
      socket.off("round:ended", handleRoundEnded);
      socket.off("chat:message", handleChatMessage);
      socket.off("guess:close", handleCloseGuess);
    };
  }, [socket]);

  const handleSubmitWord = (word: string, hint?: string) => {
    socket?.emit("round:set-word", { word, hint });
    setIsWordModalOpen(false);
  };

  const handleSendMessage = (message: string) => {
    socket?.emit("chat:send", { message });
  };

  const handleNextRoundFromModal = () => {
    setRoundEndData(null);
    onStartGame?.();
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Word Selection Popup for Drawer */}
      <WordModal
        isOpen={isWordModalOpen && isDrawer}
        suggestions={wordSuggestions}
        timeLimitSeconds={wordSelectionTimeLimit}
        onSubmitWord={handleSubmitWord}
      />

      {/* Round End Word Reveal Popup */}
      <RoundEndModal
        isOpen={roundEndData !== null && room.game.status !== "COMPLETED"}
        revealedWord={roundEndData?.word || ""}
        reason={roundEndData?.reason || "Round Finished"}
        isOwner={isOwner}
        players={room.players}
        onNextRound={handleNextRoundFromModal}
      />

      {/* Final Game Over Podium Modal */}
      <GameOverModal
        isOpen={room.game.status === "COMPLETED"}
        players={room.players}
        isOwner={isOwner}
        onPlayAgain={handleNextRoundFromModal}
        onLeaveRoom={onLeaveRoom}
      />

      {/* Top Room Banner */}
      <div className="w-full bg-white rounded-3xl p-6 border border-[#E9E4F7] pastel-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#2E1065]">
              {room.name}
            </h2>
            <span
              className={`px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                room.game.status === "ACTIVE_ROUND"
                  ? "bg-[#D1FAE5] text-[#065F46] animate-pulse"
                  : room.game.status === "COMPLETED"
                    ? "bg-[#FEF3C7] text-[#B45309]"
                    : "bg-[#E9E4F7] text-[#6D28D9]"
              }`}
            >
              {room.game.status === "ACTIVE_ROUND"
                ? `Round ${room.game.roundNumber} • Drawing`
                : room.game.status === "COMPLETED"
                  ? "Match Completed"
                  : "Waiting for Host"}
            </span>
          </div>
          <p className="text-sm font-semibold text-[#6B7280] mt-1">
            Draw, guess, and rack up points!
          </p>
        </div>

        <button
          onClick={handleCopyCode}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[#F3E8FF] hover:bg-[#E9D5FF] text-[#6B21A8] text-xs font-extrabold btn-squishy cursor-pointer transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          <span>{copied ? "Copied!" : `Code: ${room.id.slice(0, 8)}`}</span>
        </button>
      </div>

      {/* Live Word & Timer Banner (During Active Round) */}
      {room.game.status === "ACTIVE_ROUND" && (
        <WordBanner
          isDrawer={isDrawer}
          word={assignedWord}
          blanks={maskedBlanks}
          letterCount={letterCount}
          hint={currentHint}
          timeLeft={timeLeft}
        />
      )}

      {/* Main Canvas + Chat Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left 2 Cols: Drawing Canvas */}
        <div className="lg:col-span-2 space-y-4">
          <DrawingCanvas
            socket={socket}
            roomId={room.id}
            isDrawer={
              room.game.status === "ACTIVE_ROUND"
                ? isDrawer
                : room.game.status === "WAITING" && isOwner
            }
            drawerName={
              room.players.find(
                (p) => p.id === (room.game.currentDrawerId || room.ownerId),
              )?.username || "Host"
            }
          />
        </div>

        {/* Right 1 Col: Live Guess Chat */}
        <div className="lg:col-span-1">
          <ChatBox
            messages={messages}
            onSendMessage={handleSendMessage}
            closeGuessAlert={closeGuessAlert}
            disabled={isDrawer}
          />
        </div>
      </div>

      {/* Players List Section */}
      <div className="w-full bg-white rounded-3xl p-6 border border-[#E9E4F7] pastel-card space-y-6">
        <div className="space-y-3">
          <h3 className="text-lg font-extrabold text-[#2E1065] flex items-center gap-2">
            <Palette className="w-5 h-5 text-[#7C3AED]" />
            Players & Scores ({activePlayers.length}/15)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {activePlayers.map((player, idx) => {
              const isThisPlayerOwner = player.id === room.ownerId;
              const isCurrent = player.id === currentSocketId;
              const isDrawingNow = player.id === room.game.currentDrawerId;
              const cardStyle = PASTEL_CARD_BG[idx % PASTEL_CARD_BG.length];

              return (
                <div
                  key={player.id}
                  className={`p-3.5 rounded-2xl border-2 ${cardStyle} flex items-center justify-between gap-2 shadow-xs transition-transform hover:scale-[1.02]`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-white/80 border border-white flex items-center justify-center text-lg font-bold shadow-xs">
                      {isThisPlayerOwner ? "👑" : isDrawingNow ? "✏️" : "🎨"}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold truncate flex items-center gap-1">
                        {player.username} {isCurrent && "(You)"}
                      </div>
                      <div className="text-xs font-black text-[#7C3AED]">
                        {player.score || 0} pts
                      </div>
                    </div>
                  </div>

                  {isThisPlayerOwner && (
                    <Crown className="w-4 h-4 text-[#F59E0B] shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Spectators List */}
          {spectators.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-[#F3F4F6]">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#6B7280]">
                <Eye className="w-3.5 h-3.5 text-[#4F46E5]" />
                Spectators ({spectators.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {spectators.map((spec) => (
                  <span
                    key={spec.id}
                    className="px-3 py-1 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-xs font-bold text-[#4B5563]"
                  >
                    👁️ {spec.username} {spec.id === currentSocketId && "(You)"}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Controls Bar */}
        <div className="pt-6 border-t border-[#F3F4F6] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onLeaveRoom}
              className="px-5 py-3 rounded-2xl bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] text-sm font-extrabold flex items-center gap-2 btn-squishy cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Leave Room
            </button>

            {isOwner && (
              <>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onDeleteRoom}
                      className="px-4 py-3 rounded-2xl bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-extrabold flex items-center gap-1.5 btn-squishy cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-3 py-3 rounded-2xl bg-[#F3F4F6] text-[#4B5563] text-xs font-bold hover:bg-[#E5E7EB] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-3 rounded-2xl bg-[#FEE2E2] hover:bg-[#FECACA] text-[#991B1B] text-sm font-bold flex items-center gap-2 btn-squishy cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Room
                  </button>
                )}
              </>
            )}
          </div>

          {/* Host Start Game Button */}
          {isOwner && room.game.status === "WAITING" && (
            <button
              onClick={onStartGame}
              disabled={activePlayers.length < 2}
              className="px-8 py-3.5 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#D1D5DB] disabled:cursor-not-allowed text-white text-base font-extrabold shadow-md btn-squishy flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Play className="w-5 h-5 fill-white" />
              Start Game Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
