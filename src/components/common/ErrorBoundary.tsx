// 错误边界：子树渲染/生命周期抛错时兜底显示重试界面，
// 避免在 transparent 窗口下崩溃后整页变透明（空树 → 透出桌面）。

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui";

interface Props {
  children: ReactNode;
  /** 点击"重试"时额外回调（如重置上层状态）。重试会重新挂载子树。 */
  onReset?: () => void;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary 捕获到异常:", error);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center bg-white dark:bg-gray-900 p-6 text-center">
          <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">
            {this.props.label ?? "页面出错了"}
          </p>
          <p className="mb-4 max-w-md break-all text-xs text-gray-400">
            {this.state.error.message}
          </p>
          <Button onClick={this.reset} variant="secondary" size="sm">
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
