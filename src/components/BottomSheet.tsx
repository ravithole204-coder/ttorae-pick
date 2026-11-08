import { useEffect, type ReactNode } from 'react';

interface Props {
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/** 화면 아래에서 올라오는 시트. 바깥 영역을 누르거나 ESC로 닫혀요. */
export function BottomSheet({ onClose, label, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="handle" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
