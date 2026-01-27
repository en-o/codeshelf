import { useState, useEffect, useRef } from "react";
import { ChevronDown, X } from "lucide-react";

interface FloatingCategoryBallProps {
  categories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

export function FloatingCategoryBall({
  categories,
  activeCategory,
  onCategoryChange,
}: FloatingCategoryBallProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - 100, y: window.innerHeight - 150 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const ballRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allCategories = ["全部", ...categories];
  const maxVisible = 6;
  const itemHeight = 44; // 每个分类项的高度（px-3 py-2 + gap）

  // 创建循环列表：前后各添加一些项以实现无缝循环
  const getCircularList = () => {
    if (allCategories.length <= maxVisible) return allCategories;

    // 创建一个足够长的循环列表
    const repeatCount = Math.ceil(maxVisible / allCategories.length) + 2;
    const circularList = [];
    for (let i = 0; i < repeatCount; i++) {
      circularList.push(...allCategories);
    }
    return circularList;
  };

  const circularList = getCircularList();

  // 鼠标滚轮控制滚动
  useEffect(() => {
    if (!isExpanded || allCategories.length <= maxVisible) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      setIsTransitioning(true);

      // 向下滚动增加偏移，向上滚动减少偏移
      if (e.deltaY > 0) {
        setScrollOffset((prev) => prev + 1);
      } else {
        setScrollOffset((prev) => prev - 1);
      }
    };

    const listElement = listRef.current;
    if (listElement) {
      listElement.addEventListener("wheel", handleWheel, { passive: false });
      return () => listElement.removeEventListener("wheel", handleWheel);
    }
  }, [isExpanded, allCategories.length, maxVisible]);

  // 处理循环滚动的边界
  useEffect(() => {
    if (!isExpanded || allCategories.length <= maxVisible) return;

    // 当滚动到边界时，重置到中间位置（无缝循环）
    const checkBoundary = () => {
      const currentIndex = scrollOffset % allCategories.length;

      // 如果滚动超过一定范围，重置到中间
      if (Math.abs(scrollOffset) > allCategories.length * 2) {
        setIsTransitioning(false);
        setScrollOffset(currentIndex);

        // 下一帧恢复过渡效果
        requestAnimationFrame(() => {
          setIsTransitioning(true);
        });
      }
    };

    checkBoundary();
  }, [scrollOffset, allCategories.length, isExpanded, maxVisible]);

  // 拖动处理
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // 点击外部关闭浮动球
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (ballRef.current && !ballRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };

    // 延迟添加监听器，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isExpanded) return; // 展开时不允许拖动

    const rect = ballRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setIsDragging(true);
    }
  };

  const handleCategoryClick = (category: string) => {
    onCategoryChange(category);
    setIsExpanded(false);
  };

  // 计算当前显示的起始索引
  const getStartIndex = () => {
    if (allCategories.length <= maxVisible) return 0;

    // 从中间位置开始
    const middleIndex = Math.floor(circularList.length / 2);
    return middleIndex + scrollOffset;
  };

  const startIndex = getStartIndex();

  return (
    <div
      ref={ballRef}
      className="fixed z-50 transition-all duration-300"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? "grabbing" : isExpanded ? "default" : "grab",
      }}
    >
      {!isExpanded ? (
        // 收起状态：显示分类球
        <div
          className="relative"
          onMouseDown={handleMouseDown}
          onClick={(e) => {
            if (!isDragging) {
              e.stopPropagation();
              setIsExpanded(true);
              setScrollOffset(0);
            }
          }}
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg hover:shadow-xl transition-all flex items-center justify-center text-white font-bold text-sm cursor-pointer hover:scale-110 active:scale-95">
            <div className="text-center">
              <div className="text-xs opacity-90">分类</div>
              <div className="text-lg">{allCategories.length}</div>
            </div>
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full shadow-md flex items-center justify-center">
            <ChevronDown size={14} className="text-blue-600" />
          </div>
        </div>
      ) : (
        // 展开状态：显示分类列表（轮盘效果）
        <div className="bg-white rounded-2xl shadow-2xl p-4 min-w-[240px] animate-scale-in">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">选择分类</span>
            <button
              onClick={() => setIsExpanded(false)}
              className="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
            >
              <X size={14} className="text-gray-500" />
            </button>
          </div>

          <div
            ref={listRef}
            className="relative overflow-hidden"
            style={{ height: `${itemHeight * maxVisible}px` }}
          >
            <div
              className="absolute w-full"
              style={{
                transform: `translateY(-${scrollOffset * itemHeight}px)`,
                transition: isTransitioning ? "transform 0.3s ease-out" : "none",
              }}
            >
              {circularList.map((category, index) => {
                const isVisible = index >= startIndex && index < startIndex + maxVisible;
                return (
                  <button
                    key={`${category}-${index}`}
                    onClick={() => handleCategoryClick(category)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1 ${
                      category === activeCategory
                        ? "bg-blue-500 text-white shadow-md"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                    style={{
                      opacity: isVisible ? 1 : 0.3,
                    }}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>

          {allCategories.length > maxVisible && (
            <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-center gap-2">
              <span className="text-xs text-gray-500">
                滚动查看更多 ({allCategories.length} 个分类)
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
