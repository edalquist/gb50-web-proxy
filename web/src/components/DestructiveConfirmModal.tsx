import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X, RefreshCw, ShieldAlert } from 'lucide-react';

export interface DestructiveConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string | React.ReactNode;
  itemName: string;
  confirmButtonText?: string;
  confirmInputPlaceholder?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export const DestructiveConfirmModal: React.FC<DestructiveConfirmModalProps> = ({
  isOpen,
  title,
  description,
  itemName,
  confirmButtonText = 'Permanently Delete',
  confirmInputPlaceholder,
  isDestructive = true,
  isLoading = false,
  onConfirm,
  onClose,
}) => {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTypedConfirmation('');
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const normalizedExpected = itemName.trim().toLowerCase();
  const normalizedTyped = typedConfirmation.trim().toLowerCase();
  const isMatch = normalizedTyped === normalizedExpected;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMatch && !isLoading) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-rose-500/40 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden space-y-0">
        {/* Header */}
        <div className="p-6 pb-4 flex items-start justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-500/10 text-rose-400 rounded-2xl border border-rose-500/20">
              {isDestructive ? <AlertTriangle className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">{title}</h3>
              <p className="text-xs text-rose-400/90 font-medium">Explicit 2-Step Verification Required</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
            title="Cancel and Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
            <div>{description}</div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              To proceed, please type <span className="font-mono font-bold text-white bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 select-all">{itemName}</span> below:
            </label>
            <input
              ref={inputRef}
              type="text"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e.target.value)}
              placeholder={confirmInputPlaceholder || `Type "${itemName}" to confirm`}
              disabled={isLoading}
              className="w-full bg-slate-950 border border-slate-700 focus:border-rose-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 font-mono outline-none transition"
              autoComplete="off"
              spellCheck="false"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isMatch || isLoading}
              className={`px-5 py-2 text-white text-xs font-bold rounded-xl transition shadow-lg flex items-center gap-2 ${
                isMatch && !isLoading
                  ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/50 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60'
              }`}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{confirmButtonText}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
