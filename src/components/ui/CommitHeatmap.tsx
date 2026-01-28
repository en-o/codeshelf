interface HeatmapProps {
  data: { date: string; count: number }[];
}

export function CommitHeatmap({ data }: HeatmapProps) {
  // Get last 365 days
  const today = new Date();
  const days: { date: Date; count: number }[] = [];

  for (let i = 364; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayData = data.find((d) => d.date === dateStr);
    days.push({
      date,
      count: dayData?.count || 0,
    });
  }

  // Group by weeks
  const weeks: { date: Date; count: number }[][] = [];
  let currentWeek: { date: Date; count: number }[] = [];

  days.forEach((day, index) => {
    currentWeek.push(day);
    if (day.date.getDay() === 6 || index === days.length - 1) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    }
  });

  function getColor(count: number): string {
    if (count === 0) return "bg-gray-100";
    if (count <= 2) return "bg-emerald-200";
    if (count <= 5) return "bg-emerald-400";
    if (count <= 10) return "bg-emerald-600";
    return "bg-emerald-800";
  }

  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-1">
        {/* Weekday labels */}
        <div className="flex flex-col gap-1 pr-2">
          <div className="h-3" /> {/* Spacer for month labels */}
          {weekdays.map((day, i) => (
            <div
              key={i}
              className="h-3 text-xs text-gray-400 flex items-center"
            >
              {i % 2 === 1 ? day : ""}
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex gap-1">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {/* Month label */}
              {weekIndex === 0 || week[0].date.getDate() <= 7 ? (
                <div className="h-3 text-xs text-gray-400">
                  {months[week[0].date.getMonth()]}
                </div>
              ) : (
                <div className="h-3" />
              )}

              {/* Days */}
              {week.map((day, dayIndex) => (
                <div
                  key={dayIndex}
                  className={`w-3 h-3 rounded-sm ${getColor(day.count)} transition-colors hover:ring-2 hover:ring-blue-500 cursor-pointer`}
                  title={`${day.date.toLocaleDateString("zh-CN")}: ${day.count} 次提交`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
        <span>少</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded-sm bg-gray-100" />
          <div className="w-3 h-3 rounded-sm bg-emerald-200" />
          <div className="w-3 h-3 rounded-sm bg-emerald-400" />
          <div className="w-3 h-3 rounded-sm bg-emerald-600" />
          <div className="w-3 h-3 rounded-sm bg-emerald-800" />
        </div>
        <span>多</span>
      </div>
    </div>
  );
}
