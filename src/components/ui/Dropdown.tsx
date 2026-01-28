import { useState, useRef, useEffect } from "react";

interface DropdownItem {
  label: string;
  icon?: string;
  onClick: () => void;
  divider?: boolean;
  danger?: boolean;
}

interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: "left" | "right";
}

export function Dropdown({ trigger, items, align = "right" }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // 处理键盘事件
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>

      {isOpen && (
        <>
          {/* Backdrop for mobile */}
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Menu */}
          <div
            className={`absolute top-full mt-2 min-w-[200px] bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-200 ${
              align === "right" ? "right-0" : "left-0"
            }`}
            style={{
              boxShadow: "0 10px 40px -10px rgba(0, 0, 0, 0.15), 0 4px 12px -4px rgba(0, 0, 0, 0.1)",
            }}
          >
            {items.map((item, index) => (
              <div key={index}>
                {item.divider && (
                  <div className="h-px bg-gray-200 my-2 mx-3" />
                )}
                <button
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                  className={`w-full mx-1 px-3 py-2.5 text-left text-sm rounded-lg transition-all duration-150 flex items-center gap-3 min-w-[calc(100%-8px)] ${
                    item.danger
                      ? "text-red-500 hover:bg-red-50"
                      : "text-gray-900 hover:bg-gray-100"
                  }`}
                >
                  {item.icon && (
                    <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 text-base">
                      {item.icon}
                    </span>
                  )}
                  <span className="font-medium">{item.label}</span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
